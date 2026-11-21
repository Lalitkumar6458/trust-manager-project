import 'server-only';
import crypto from 'node:crypto';
import { currentTenant, csql, multiTenant } from '../tenant';
import { licenseOf, controlSettings } from '../license';
import { addPayment, controlSecret } from './service';

// ------------------------------------------------------------------
// Sanstha side: "Plan & billing" page + online renewal with the OWNER's Razorpay account.
//   createRenewOrder → Razorpay Checkout → verifyRenew (signature) → addPayment (expiry moves on)
//   /api/license/webhook (payment.captured / order.paid) does the same if the browser closed.
// ------------------------------------------------------------------
const RZP = process.env.RZP_API_BASE || 'https://api.razorpay.com';
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const safeEq = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

async function rzp() {
  const s = await controlSettings();
  const keyId = String(s.rzp_key_id || '');
  const secret = await controlSecret('rzp_key_secret');
  return { keyId, secret, enabled: !!(keyId && secret && s.online_renewal !== false) };
}

const priceOf = (t, plan, months) => {
  if (!plan) return null;
  if (months === 12) return Number(t.price_year ?? plan.price_year ?? 0) || null;
  if (months === 1) return Number(t.price_month ?? plan.price_month ?? 0) || null;
  return null;
};

export async function billingInfo() {
  if (!multiTenant()) return { mode: 'single' };
  const t = await currentTenant();
  if (t.billing === 'fixed') return { mode: 'fixed' }; // one-time deal – nothing to show
  const [lic, plansR, payR, r] = await Promise.all([
    licenseOf(t),
    csql('SELECT * FROM plans WHERE active OR id = $1 ORDER BY sort, name', [t.plan_id]),
    csql('SELECT receipt_no, amount, method, reference, months, period_from, period_to, source, created_at, plan_id FROM payments WHERE tenant_id = $1 AND voided_at IS NULL ORDER BY created_at DESC LIMIT 100', [t.id]),
    rzp(),
  ]);
  const plans = plansR.rows.map((p) => ({
    id: p.id, name: p.name, description: p.description, features: p.features, maxUsers: p.max_users,
    priceYear: p.id === t.plan_id ? priceOf(t, p, 12) : Number(p.price_year) || null,
    priceMonth: p.id === t.plan_id ? priceOf(t, p, 1) : Number(p.price_month) || null,
    current: p.id === t.plan_id,
  }));
  return { mode: 'saas', license: lic, plans, payments: payR.rows, onlineRenewal: r.enabled };
}

export async function createRenewOrder({ planId, months }, user) {
  if (!multiTenant()) throw err('Not available');
  if (user.role !== 'superAdmin') throw err('Only the Super Admin can renew the plan', 403);
  const t = await currentTenant();
  if (t.billing === 'fixed') throw err('Not available', 404);
  const m = Number(months);
  if (![1, 12].includes(m)) throw err('Choose monthly or yearly');
  const pid = planId || t.plan_id;
  const { rows: [plan] } = await csql('SELECT * FROM plans WHERE id = $1 AND (active OR id = $2)', [pid, t.plan_id]);
  if (!plan) throw err('Plan not found');
  const amount = pid === t.plan_id ? priceOf(t, plan, m) : Number(m === 12 ? plan.price_year : plan.price_month) || null;
  if (!amount) throw err('This option has no online price – please contact your software provider');
  const r = await rzp();
  if (!r.enabled) throw err('Online renewal is not set up – please contact your software provider', 503);
  const res = await fetch(`${RZP}/v1/orders`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${r.keyId}:${r.secret}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR', receipt: `${t.slug}-${Date.now()}`.slice(0, 40), notes: { tenant: t.slug, plan: pid, months: String(m), kind: 'subscription' } }),
    signal: AbortSignal.timeout(20000),
  });
  const order = await res.json().catch(() => ({}));
  if (!res.ok || !order.id) throw err(order?.error?.description || 'Payment gateway error – please try again', 502);
  await csql('INSERT INTO renew_orders (order_id, tenant_id, plan_id, months, amount, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [order.id, t.id, pid, m, amount, user.email || user.name || '']);
  const s = await controlSettings();
  return { orderId: order.id, amount, keyId: r.keyId, name: s.brand_name || 'Subscription', description: `${plan.name} – ${m === 12 ? '1 year' : '1 month'}`, prefill: { name: user.name || '', email: user.email || '' } };
}

async function finalizeRenew(orderId, paymentId, source) {
  const { rows: [o] } = await csql('SELECT * FROM renew_orders WHERE order_id = $1', [orderId]);
  if (!o) throw err('Order not found', 404);
  const r = await addPayment(o.tenant_id, {
    amount: o.amount, method: 'Razorpay', reference: paymentId, months: o.months, planId: o.plan_id, source: 'razorpay', orderId, note: `Online renewal (${source})`,
  }, { email: o.created_by || 'online' });
  await csql("UPDATE renew_orders SET status = 'paid', payment_id = $2, paid_at = COALESCE(paid_at, now()) WHERE order_id = $1", [orderId, paymentId]);
  return r;
}

export async function verifyRenew({ orderId, paymentId, signature }) {
  const t = await currentTenant();
  const { rows } = await csql('SELECT 1 FROM renew_orders WHERE order_id = $1 AND tenant_id = $2', [orderId, t.id]);
  if (!rows.length) throw err('Order not found', 404);
  const { secret } = await rzp();
  const expect = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  if (!safeEq(expect, signature)) throw err('Payment could not be verified');
  return finalizeRenew(orderId, paymentId, 'checkout');
}

/** owner's Razorpay webhook → https://<control host or any sanstha>/api/license/webhook */
export async function renewWebhook(raw, signature) {
  const ws = await controlSecret('rzp_webhook_secret');
  if (!ws) throw err('Webhook secret not set', 503);
  const expect = crypto.createHmac('sha256', ws).update(raw).digest('hex');
  if (!safeEq(expect, signature)) throw err('Bad signature', 401);
  const evt = JSON.parse(raw);
  const p = evt?.payload?.payment?.entity;
  if (['payment.captured', 'order.paid'].includes(evt?.event) && p?.order_id) {
    const { rows } = await csql('SELECT 1 FROM renew_orders WHERE order_id = $1', [p.order_id]);
    if (!rows.length) return { ignored: 'not a subscription order' };
    return finalizeRenew(p.order_id, p.id, 'webhook');
  }
  return { ignored: evt?.event };
}

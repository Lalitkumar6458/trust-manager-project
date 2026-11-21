import 'server-only';
import crypto from 'node:crypto';
import { COL } from '@/lib/constants';
import { round2, todayStr, MOBILE_REGEX, PAN_REGEX } from '@/lib/format';
import {
  db, runTransaction, fetchAll, fetchOne, where, docRef, colRef, doc, serverTimestamp, writeBatch,
} from './services/db';
import { createDonation } from './services/donations';
import { getSecrets } from './secrets';
import { autoSendReceipt } from './messaging';
import { verifyTokens } from './services/receiptVerify';
import { getLicense, assertFeature, assertWritable, assertNotLocked } from './license';

// ------------------------------------------------------------------
// Online donations with Razorpay (UPI / card / net-banking).
//  1. /donate page → createOrder()  (Razorpay order + online_payments row "created")
//  2. Razorpay Checkout → verifyCheckout()  (signature check) → finalize()
//  3. Razorpay webhook (payment.captured / order.paid) → finalize()  – backup if the browser closed
// finalize() is idempotent: one approved donation per order, receipt sent automatically.
// ------------------------------------------------------------------

export const SECRET_KEYS = ['rzp_secret', 'rzp_webhook_secret'];
export const ONLINE_USER = { uid: 'online', name: 'Online donation', role: 'superAdmin', email: '' };
const RZP = process.env.RZP_API_BASE || 'https://api.razorpay.com';

export const DEFAULT_ONLINE = {
  enabled: false, keyId: '', accountId: '', categoryIds: [], defaultCategoryId: '', minAmount: 10, maxAmount: 500000,
  suggested: [101, 251, 501, 1100, 2100, 5100], title: '', intro: '', thankYou: 'आपके दान के लिए हार्दिक धन्यवाद! रसीद आपके मोबाइल / ईमेल पर भेज दी गई है।',
};
export const onlineOf = (s = {}) => ({ ...DEFAULT_ONLINE, ...(s.online || {}) });
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/** what the public /donate page may see */
export async function publicConfig() {
  const s = (await fetchOne(COL.settings, 'trust')) || {};
  const o = onlineOf(s);
  const lic = await getLicense();
  if (!o.enabled || !o.keyId || lic.readOnly || !(lic.features || []).includes('online')) return { enabled: false, trust: { name: s.name || '' } };
  const cats = (await fetchAll(COL.donationCategories)).filter((c) => c.active !== false && (o.categoryIds?.length ? o.categoryIds.includes(c.id) : c.showOnReceipt));
  return {
    enabled: true,
    keyId: o.keyId,
    trust: { name: s.name || '', nameEn: s.nameEn || '', address: s.address || '', logoUrl: s.logoUrl || s.leftImageUrl || '', section80G: s.section80G || '', pan: s.pan || '' },
    categories: cats.map((c) => ({ id: c.id, name: c.name, nameHi: c.nameHi || '' })),
    defaultCategoryId: o.defaultCategoryId || cats[0]?.id || '',
    suggested: (o.suggested || []).filter((n) => Number(n) > 0).slice(0, 8),
    minAmount: o.minAmount, maxAmount: o.maxAmount, title: o.title, intro: o.intro, thankYou: o.thankYou,
  };
}

async function rzpAuth() {
  const s = (await fetchOne(COL.settings, 'trust')) || {};
  const o = onlineOf(s);
  const { rzp_secret: secret, rzp_webhook_secret: webhookSecret } = await getSecrets(SECRET_KEYS);
  if (!o.enabled || !o.keyId || !secret) throw bad('Online donation is not available right now', 503);
  return { o, s, secret, webhookSecret, auth: `Basic ${Buffer.from(`${o.keyId}:${secret}`).toString('base64')}` };
}

// very small in-memory rate limit (per IP) for order creation
const hits = new Map();
function rateLimit(ip, max = 12, windowMs = 60_000) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw bad('Too many attempts – please wait a minute', 429);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
}

export async function createOrder(input, ip) {
  rateLimit(ip || 'x');
  await assertWritable(await assertFeature('online'));
  const { o, auth } = await rzpAuth();
  const amount = round2(Number(input?.amount));
  if (!(amount >= Number(o.minAmount || 1)) || amount > Number(o.maxAmount || 500000)) throw bad(`Amount must be between ₹${o.minAmount} and ₹${o.maxAmount}`);
  const name = String(input?.name || '').trim().slice(0, 120);
  const mobile = String(input?.mobile || '').replace(/\D/g, '').slice(-10);
  const email = String(input?.email || '').trim().slice(0, 120);
  const pan = String(input?.pan || '').trim().toUpperCase();
  if (!name) throw bad('Please enter your name');
  if (!MOBILE_REGEX.test(mobile)) throw bad('Please enter a valid 10 digit mobile number');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Email is not valid');
  if (pan && !PAN_REGEX.test(pan)) throw bad('PAN is not valid');
  const cfg = await publicConfig();
  const categoryId = cfg.categories.some((c) => c.id === input?.categoryId) ? input.categoryId : cfg.defaultCategoryId;
  if (!categoryId) throw bad('Online donation is not available right now', 503);
  const ref = doc(colRef(COL.onlinePayments));
  const res = await fetch(`${RZP}/v1/orders`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR', receipt: ref.id, notes: { name, mobile, purpose: String(input?.purpose || '').slice(0, 200) } }),
    signal: AbortSignal.timeout(20000),
  });
  const order = await res.json().catch(() => ({}));
  if (!res.ok || !order.id) throw bad(order?.error?.description || 'Payment gateway error – please try again', 502);
  const b = writeBatch();
  b.set(ref, {
    orderId: order.id, amount, categoryId, purpose: String(input?.purpose || '').slice(0, 200),
    donor: { name, mobile, email, pan, address: String(input?.address || '').trim().slice(0, 300) },
    status: 'created', ip: ip || '', createdAt: serverTimestamp(),
  });
  await b.commit();
  return { orderId: order.id, amount, keyId: o.keyId, name, mobile, email, ref: ref.id };
}

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export async function verifyCheckout({ orderId, paymentId, signature }) {
  await assertNotLocked(); // money is already taken – finish the receipt even on an expired plan
  const { secret } = await rzpAuth();
  const expect = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  if (!safeEq(expect, signature)) throw bad('Payment could not be verified', 400);
  return finalize(orderId, { paymentId, source: 'checkout' });
}

export async function webhook(raw, signature) {
  const { webhookSecret } = await rzpAuth();
  if (!webhookSecret) throw bad('Webhook secret not set', 503);
  const expect = crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');
  if (!safeEq(expect, signature)) throw bad('Bad signature', 401);
  const evt = JSON.parse(raw);
  const p = evt?.payload?.payment?.entity;
  if (['payment.captured', 'order.paid'].includes(evt?.event) && p?.order_id) {
    return finalize(p.order_id, { paymentId: p.id, method: p.method, amountPaise: p.amount, source: 'webhook' });
  }
  if (evt?.event === 'payment.failed' && p?.order_id) {
    const [row] = await fetchAll(COL.onlinePayments, where('orderId', '==', p.order_id));
    if (row && row.status === 'created') {
      const b = writeBatch();
      b.update(docRef(COL.onlinePayments, row.id), { status: 'failed', error: p.error_description || 'failed', updatedAt: serverTimestamp() });
      await b.commit();
    }
  }
  return { ignored: evt?.event };
}

const modeOf = (method) => (method === 'upi' ? 'UPI' : method === 'netbanking' ? 'Bank Transfer' : method ? 'Other' : 'UPI');

/** one approved donation per paid order (safe to call many times) */
export async function finalize(orderId, { paymentId, method, amountPaise, source }) {
  const [row] = await fetchAll(COL.onlinePayments, where('orderId', '==', orderId));
  if (!row) throw bad('Order not found', 404);
  if (amountPaise && Math.round(row.amount * 100) !== Number(amountPaise)) throw bad('Amount mismatch', 400);
  // claim the order (advisory lock → a parallel webhook + checkout cannot both create a donation)
  const claim = await runTransaction(db, async (tx) => {
    await tx.lock(`online:${row.id}`);
    const s = await tx.get(docRef(COL.onlinePayments, row.id));
    const cur = s.data();
    if (cur.donationId) return { done: cur.donationId };
    if (cur.status === 'processing' && cur.processingAt && Date.now() - new Date(cur.processingAt).getTime() < 120_000) return { busy: true };
    tx.update(docRef(COL.onlinePayments, row.id), { status: 'processing', processingAt: new Date().toISOString(), paymentId, method: method || cur.method || null, paidVia: source });
    return { go: true };
  });
  if (claim.done) return { donationId: claim.done, already: true, ...(await receiptLink(claim.done)) };
  if (claim.busy) return { processing: true };

  try {
    const [categories, accounts, settings, funds] = await Promise.all([fetchAll(COL.donationCategories), fetchAll(COL.accounts), fetchOne(COL.settings, 'trust'), fetchAll(COL.funds)]);
    const o = onlineOf(settings || {});
    const account = accounts.find((a) => a.id === o.accountId && a.type === 'bank') || accounts.find((a) => a.type === 'bank' && a.status !== 'inactive');
    if (!account) throw new Error('No bank account set for online donations (Settings → Online donation)');
    const existing = row.donor.mobile ? (await fetchAll(COL.donors, where('mobile', '==', row.donor.mobile))).find((d) => d.status !== 'inactive') : null;
    const cat = categories.find((c) => c.id === row.categoryId);
    const donationId = await createDonation({
      date: todayStr(),
      paymentMode: modeOf(method),
      accountId: account.id,
      utr: paymentId,
      txnDate: todayStr(),
      purpose: row.purpose || '',
      remarks: `Online (Razorpay) ${orderId}`,
      lines: [{ categoryId: row.categoryId, amount: row.amount, fundId: cat?.defaultFundId || null }],
      donorId: existing?.id || null,
      newDonor: existing ? null : { ...row.donor, donorType: 'Individual' },
    }, { user: ONLINE_USER, categories, accounts, settings: settings || {}, funds, submit: true, approveNow: true });
    const b = writeBatch();
    b.update(docRef(COL.onlinePayments, row.id), { status: 'paid', donationId, error: '', paidAt: serverTimestamp() });
    await b.commit();
    autoSendReceipt(donationId);
    return { donationId, ...(await receiptLink(donationId)) };
  } catch (e) {
    const b = writeBatch();
    b.update(docRef(COL.onlinePayments, row.id), { status: 'paid_unrecorded', error: String(e.message || e).slice(0, 300), updatedAt: serverTimestamp() });
    await b.commit();
    // money is received – staff will see it in Online donations and can retry
    return { paidButNotRecorded: true };
  }
}

async function receiptLink(donationId) {
  const d = await fetchOne(COL.donations, donationId);
  const tok = (await verifyTokens([donationId]))[donationId];
  return { receiptNo: d?.receiptNo || '', amount: d?.amount, token: tok };
}

/** staff: retry a paid order whose donation could not be recorded */
export async function retryOrder(id) {
  const row = await fetchOne(COL.onlinePayments, id);
  if (!row) throw bad('Not found');
  if (row.status !== 'paid_unrecorded') throw bad('Only “paid – not recorded” entries can be retried');
  const b = writeBatch();
  b.update(docRef(COL.onlinePayments, id), { status: 'created', processingAt: null });
  await b.commit();
  return finalize(row.orderId, { paymentId: row.paymentId, method: row.method, source: 'retry' });
}

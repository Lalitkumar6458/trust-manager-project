import 'server-only';
import crypto from 'node:crypto';
import pg from 'pg';
import { FEATURE_KEYS } from '@/lib/features';
import { extendExpiry, addMonths, addDays, istToday } from '@/lib/license';
import { fyIdOf } from '@/lib/format';
import {
  csql, controlPool, tenantDbUrl, runAsTenant, clearTenantCache, closeTenantPool, baseDomain, normHost,
} from '../tenant';
import { licenseOf, controlSettings, clearLicenseCache } from '../license';
import { migrateDatabase } from '../migrator';
import { audit } from './auth';

// ------------------------------------------------------------------
// Owner control panel: sansthas, plans, subscription payments, settings, provisioning.
// ------------------------------------------------------------------
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const newId = () => crypto.randomBytes(10).toString('hex');
const RESERVED = new Set(['admin', 'www', 'api', 'control', 'mail', 'app', 'portal', 'donate', 'static', 'cdn', 'test', 'demo']);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const HOST_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const changed = () => { clearTenantCache(); clearLicenseCache(); };

const cleanHosts = (hosts) => [...new Set((Array.isArray(hosts) ? hosts : String(hosts || '').split(/[\s,]+/)).map(normHost).filter(Boolean))].map((h) => {
  if (!HOST_RE.test(h)) throw err(`Web address “${h}” is not valid`);
  return h;
});
const cleanFeatures = (f = {}) => ({
  add: (f.add || []).filter((k) => FEATURE_KEYS.includes(k)),
  remove: (f.remove || []).filter((k) => FEATURE_KEYS.includes(k)),
});
export const tenantUrl = (t) => {
  const h = (t.hosts && t.hosts[0]) || (baseDomain() ? `${t.slug}.${baseDomain()}` : '');
  return h ? `https://${h}` : '';
};
async function hostsFree(hosts, exceptId = null) {
  if (!hosts.length) return;
  const { rows } = await csql('SELECT slug, hosts FROM tenants WHERE deleted_at IS NULL AND id IS DISTINCT FROM $2 AND hosts && $1::text[]', [hosts, exceptId]);
  if (rows.length) throw err(`Address already used by sanstha “${rows[0].slug}”`);
}
/** ticked features → { add, remove } on top of the plan (no plan = all added) */
async function overrideFor(planId, list) {
  const base = planId ? ((await csql('SELECT features FROM plans WHERE id = $1', [planId])).rows[0]?.features || []) : [];
  const sel = list.filter((k) => FEATURE_KEYS.includes(k));
  return { add: sel.filter((k) => !base.includes(k)), remove: base.filter((k) => !sel.includes(k)) };
}

async function tenantRow(id) {
  const { rows } = await csql('SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!rows[0]) throw err('Sanstha not found', 404);
  return rows[0];
}
const view = (t, lic) => ({ ...t, url: tenantUrl(t), license: lic });

// ---------------- dashboard ----------------
export async function dashboard() {
  const settings = await controlSettings();
  const { rows: ts } = await csql('SELECT * FROM tenants WHERE deleted_at IS NULL ORDER BY expires_on NULLS LAST');
  const lics = await Promise.all(ts.map((t) => licenseOf(t, settings)));
  const count = (st) => lics.filter((l) => st.includes(l.state)).length;
  const today = istToday();
  const fy = fyIdOf(today);
  const fyStart = `${fy.slice(0, 4)}-04-01`;
  const { rows: [rev] } = await csql(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date >= date_trunc('month', $1::date)), 0) AS month,
            COALESCE(SUM(amount) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date), 0) AS fy,
            COALESCE(SUM(amount), 0) AS total
       FROM payments WHERE voided_at IS NULL`, [today, fyStart],
  );
  const { rows: recent } = await csql(`SELECT p.*, t.name AS tenant_name, t.slug FROM payments p JOIN tenants t ON t.id = p.tenant_id
    WHERE p.voided_at IS NULL ORDER BY p.created_at DESC LIMIT 8`);
  const soon = ts.map((t, i) => ({ t, l: lics[i] }))
    .filter(({ l }) => ['warning', 'grace', 'readonly'].includes(l.state) || (l.daysLeft !== null && l.daysLeft <= 30))
    .slice(0, 20)
    .map(({ t, l }) => ({ id: t.id, name: t.name, slug: t.slug, expiresOn: t.expires_on, state: l.state, daysLeft: l.daysLeft, mobile: t.contact?.mobile || '', planName: l.planName }));
  // yearly value of all active subscriptions (rough "annual recurring revenue")
  const { rows: plans } = await csql('SELECT * FROM plans');
  const arr = ts.filter((t, i) => !['locked', 'readonly'].includes(lics[i].state) && !t.trial && t.billing !== 'fixed').reduce((s, t) => {
    const p = plans.find((x) => x.id === t.plan_id) || {};
    return s + Number(t.price_year ?? p.price_year ?? (Number(t.price_month ?? p.price_month ?? 0) * 12));
  }, 0);
  return {
    total: ts.length, active: count(['active', 'warning']), expiring: count(['warning']), grace: count(['grace']), readonly: count(['readonly']),
    suspended: count(['locked']), trial: ts.filter((t) => t.trial).length, fixed: ts.filter((t) => t.billing === 'fixed').length, revenue: rev, arr, recent, soon,
  };
}

// ---------------- sansthas ----------------
export async function listTenants() {
  const settings = await controlSettings();
  const { rows } = await csql(`SELECT t.*, (SELECT max(created_at) FROM payments p WHERE p.tenant_id = t.id AND p.voided_at IS NULL) AS last_paid
    FROM tenants t WHERE deleted_at IS NULL ORDER BY t.name`);
  return Promise.all(rows.map(async (t) => view(t, await licenseOf(t, settings))));
}

async function usageOf(t) {
  const c = new pg.Client({ connectionString: tenantDbUrl(t.db_name) });
  try {
    await c.connect();
    const { rows: [u] } = await c.query(`SELECT
      (SELECT count(*) FROM users WHERE COALESCE(data->>'active','true') <> 'false')::int AS users,
      (SELECT count(*) FROM donations)::int AS donations,
      (SELECT count(*) FROM expenses)::int AS expenses,
      (SELECT max(created_at) FROM donations) AS last_entry,
      (SELECT max(last_seen) FROM sessions) AS last_login,
      pg_size_pretty(pg_database_size(current_database())) AS db_size`);
    return u;
  } catch (e) {
    return { error: e.message };
  } finally {
    await c.end().catch(() => {});
  }
}

export async function getTenant(id) {
  const t = await tenantRow(id);
  const [lic, payments, usage] = await Promise.all([
    licenseOf(t),
    csql('SELECT * FROM payments WHERE tenant_id = $1 ORDER BY created_at DESC', [id]).then((r) => r.rows),
    usageOf(t),
  ]);
  return { ...view(t, lic), payments, usage };
}

function tempPassword() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(12), (b) => a[b % a.length]).join('').replace(/^(.{4})(.{4})/, '$1-$2-');
}

/**
 * New sanstha: creates its database, runs all migrations, first-time setup (trust name, categories,
 * cash account, FY) and the Super Admin login with a one-time password (must be changed at first sign-in).
 * existingDb: register a database that already exists (your current client) – nothing is created in it.
 */
export async function createTenant(input, owner) {
  const name = String(input.name || '').trim();
  const slug = String(input.slug || '').trim().toLowerCase();
  if (!name) throw err('Sanstha name is required');
  if (!SLUG_RE.test(slug) || RESERVED.has(slug)) throw err('Short name: 3–32 small letters / numbers / “-” (used in the web address), not a reserved word');
  const { rows: dup } = await csql('SELECT 1 FROM tenants WHERE slug = $1', [slug]);
  if (dup.length) throw err('This short name is already used');
  const hosts = cleanHosts(input.hosts);
  await hostsFree(hosts);
  const existingDb = String(input.existingDb || '').trim();
  if (existingDb && !/^[a-z_][a-z0-9_]{0,62}$/.test(existingDb)) throw err('Database name is not valid');
  const dbName = existingDb || `tm_${slug.replace(/-/g, '_')}`;
  const { rows: dbDup } = await csql('SELECT 1 FROM tenants WHERE db_name = $1', [dbName]);
  if (dbDup.length) throw err('This database already belongs to another sanstha');
  const planId = input.planId || null;
  const billing = input.billing === 'fixed' ? 'fixed' : 'subscription';
  if (billing === 'subscription' && !planId) throw err('Choose a plan (or make it a fixed deal)');
  if (planId) { const { rows } = await csql('SELECT 1 FROM plans WHERE id = $1', [planId]); if (!rows.length) throw err('Plan not found'); }
  const settings = await controlSettings();
  const today = istToday();
  const startsOn = DATE_RE.test(input.startsOn || '') ? input.startsOn : today;
  const trial = !!input.trial;
  const expiresOn = input.noExpiry ? null : (DATE_RE.test(input.expiresOn || '') ? input.expiresOn
    : trial ? addDays(startsOn, Number(input.trialDays) || 14) : addMonths(startsOn, Number(input.months) || 12));
  const admin = input.admin || {};
  const adminEmail = String(admin.email || '').trim().toLowerCase();
  if (!existingDb && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw err('Super Admin email is required');

  let created = false;
  const password = tempPassword();
  try {
    if (!existingDb) {
      const { rows } = await csql('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
      if (rows.length) throw err(`Database ${dbName} already exists – tick “database already exists” to register it`);
      await controlPool().query(`CREATE DATABASE "${dbName}"`);
      created = true;
    }
    if (existingDb) {
      const { rows } = await csql('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
      if (!rows.length) throw err(`Database “${dbName}” was not found on this server. Use the name at the end of DATABASE_URL in .env.local (e.g. “trust”).`);
    }
    await migrateDatabase(tenantDbUrl(dbName));
    const t = {
      id: newId(), slug, name, hosts, db_name: dbName, plan_id: planId, features: Array.isArray(input.featureList) ? await overrideFor(planId, input.featureList) : cleanFeatures(input.features), max_users: num(input.maxUsers), billing,
      price_month: num(input.priceMonth), price_year: num(input.priceYear), status: 'active', trial: billing === 'fixed' ? false : trial, starts_on: startsOn, expires_on: expiresOn,
      grace_days: Number(input.graceDays ?? settings.default_grace_days ?? 7), contact: input.contact || {}, notes: String(input.notes || ''),
    };
    if (!existingDb) {
      const { bootstrapTrust } = await import('../services/setup');
      const { setPassword } = await import('../auth');
      await runAsTenant(t, async () => {
        const uid = await bootstrapTrust({ name: admin.name || name, email: adminEmail, password, mobile: admin.mobile || '', trust: { name } });
        await setPassword(uid, password, { mustChange: true });
      });
    }
    await csql(`INSERT INTO tenants (id, slug, name, hosts, db_name, plan_id, features, max_users, price_month, price_year, status, trial, starts_on, expires_on, grace_days, contact, notes, billing)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [t.id, t.slug, t.name, t.hosts, t.db_name, t.plan_id, t.features, t.max_users, t.price_month, t.price_year, t.status, t.trial, t.starts_on, t.expires_on, t.grace_days, t.contact, t.notes, t.billing]);
    if (Number(input.oneTimeAmount) > 0) {
      await addPayment(t.id, { amount: Number(input.oneTimeAmount), method: input.oneTimeMethod || 'UPI', reference: input.oneTimeReference || '', months: 0, note: billing === 'fixed' ? 'One-time fixed deal' : 'Setup / first payment' }, owner);
    }
    changed();
    await audit(owner, 'create_tenant', t.id, { slug, dbName, existingDb: !!existingDb, planId, expiresOn });
    return { id: t.id, url: tenantUrl(t), admin: existingDb ? null : { email: adminEmail, password } };
  } catch (e) {
    if (created) {
      await closeTenantPool(dbName);
      await controlPool().query(`DROP DATABASE IF EXISTS "${dbName}"`).catch(() => {});
    }
    throw e;
  }
}

export async function updateTenant(id, p, owner) {
  const t = await tenantRow(id);
  const hosts = p.hosts !== undefined ? cleanHosts(p.hosts) : t.hosts;
  await hostsFree(hosts, id);
  if (p.planId) { const { rows } = await csql('SELECT 1 FROM plans WHERE id = $1', [p.planId]); if (!rows.length) throw err('Plan not found'); }
  if (p.expiresOn && !DATE_RE.test(p.expiresOn)) throw err('Expiry date is not valid');
  const next = {
    name: p.name !== undefined ? String(p.name).trim() || t.name : t.name,
    hosts,
    plan_id: p.planId !== undefined ? p.planId || null : t.plan_id,
    features: p.features !== undefined ? cleanFeatures(p.features) : t.features,
    max_users: p.maxUsers !== undefined ? num(p.maxUsers) : t.max_users,
    price_month: p.priceMonth !== undefined ? num(p.priceMonth) : t.price_month,
    price_year: p.priceYear !== undefined ? num(p.priceYear) : t.price_year,
    trial: p.trial !== undefined ? !!p.trial : t.trial,
    expires_on: p.noExpiry ? null : (p.expiresOn !== undefined ? p.expiresOn || t.expires_on : t.expires_on),
    grace_days: p.graceDays !== undefined ? Number(p.graceDays) || 0 : t.grace_days,
    contact: p.contact !== undefined ? p.contact || {} : t.contact,
    notes: p.notes !== undefined ? String(p.notes || '') : t.notes,
    billing: p.billing !== undefined ? (p.billing === 'fixed' ? 'fixed' : 'subscription') : t.billing,
  };
  if (next.billing === 'subscription' && !next.plan_id) throw err('Choose a plan (or make it a fixed deal)');
  if (Array.isArray(p.featureList)) next.features = await overrideFor(next.plan_id, p.featureList);
  if (next.billing === 'fixed') next.trial = false;
  await csql(`UPDATE tenants SET name=$2, hosts=$3, plan_id=$4, features=$5, max_users=$6, price_month=$7, price_year=$8, trial=$9, expires_on=$10,
    grace_days=$11, contact=$12, notes=$13, billing=$14, updated_at=now() WHERE id=$1`,
  [id, next.name, next.hosts, next.plan_id, next.features, next.max_users, next.price_month, next.price_year, next.trial, next.expires_on, next.grace_days, next.contact, next.notes, next.billing]);
  changed();
  const diff = Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(t[k])));
  await audit(owner, 'update_tenant', id, diff);
  return { ok: true };
}

export async function setTenantStatus(id, status, reason, owner) {
  if (!['active', 'suspended'].includes(status)) throw err('Bad status');
  await tenantRow(id);
  await csql('UPDATE tenants SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
  changed();
  await audit(owner, status === 'suspended' ? 'suspend' : 'resume', id, { reason: reason || '' });
  return { ok: true };
}

// ---------------- subscription payments ----------------
async function nextReceiptNo(client) {
  const fy = fyIdOf(istToday());
  const { rows } = await client.query('INSERT INTO counters (key, value) VALUES ($1, 1) ON CONFLICT (key) DO UPDATE SET value = counters.value + 1 RETURNING value', [`pay_${fy}`]);
  return `SUB/${fy}/${String(rows[0].value).padStart(4, '0')}`;
}

/** money received for a sanstha → expiry moves forward (inside one DB transaction) */
export async function addPayment(tenantId, { amount, method, reference, months, planId, note, source = 'manual', orderId = null }, actor) {
  const client = await controlPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: [t] } = await client.query('SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [tenantId]);
    if (!t) throw err('Sanstha not found', 404);
    if (orderId) {
      const { rows } = await client.query('SELECT id FROM payments WHERE order_id = $1', [orderId]);
      if (rows.length) { await client.query('ROLLBACK'); return { duplicate: true, id: rows[0].id }; }
    }
    const m = Number(months) || 0;
    const amt = Number(amount);
    if (!(amt >= 0)) throw err('Amount is not valid');
    const exp = t.expires_on || null;
    let period = { from: null, to: exp };
    if (m > 0) period = extendExpiry({ expiresOn: exp, graceDays: t.grace_days, months: m });
    const id = newId();
    const receiptNo = await nextReceiptNo(client);
    await client.query(`INSERT INTO payments (id, tenant_id, amount, method, reference, plan_id, months, period_from, period_to, note, source, order_id, receipt_no, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, tenantId, amt, String(method || ''), String(reference || ''), planId || t.plan_id, m, period.from, m > 0 ? period.to : null, String(note || ''), source, orderId, receiptNo, actor?.email || actor?.name || '']);
    if (m > 0) {
      await client.query('UPDATE tenants SET expires_on = $2, plan_id = COALESCE($3, plan_id), trial = false, updated_at = now() WHERE id = $1', [tenantId, period.to, planId || null]);
    }
    await client.query('COMMIT');
    changed();
    await audit(actor, 'payment', tenantId, { amount: amt, months: m, source, receiptNo, newExpiry: m > 0 ? period.to : exp });
    return { id, receiptNo, expiresOn: m > 0 ? period.to : exp };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function voidPayment(id, reason, owner) {
  if (!String(reason || '').trim()) throw err('Reason is required');
  const { rowCount } = await csql('UPDATE payments SET voided_at = now(), void_reason = $2 WHERE id = $1 AND voided_at IS NULL', [id, reason]);
  if (!rowCount) throw err('Payment not found');
  await audit(owner, 'void_payment', null, { id, reason });
  return { ok: true };
}

export async function listPayments({ from, to, tenantId } = {}) {
  const { rows } = await csql(`SELECT p.*, t.name AS tenant_name, t.slug FROM payments p JOIN tenants t ON t.id = p.tenant_id
    WHERE ($1::date IS NULL OR (p.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $1::date)
      AND ($2::date IS NULL OR (p.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $2::date)
      AND ($3::text IS NULL OR p.tenant_id = $3)
    ORDER BY p.created_at DESC LIMIT 2000`, [from || null, to || null, tenantId || null]);
  return rows;
}

// ---------------- plans ----------------
export async function listPlans() {
  const { rows } = await csql(`SELECT p.*, (SELECT count(*) FROM tenants t WHERE t.plan_id = p.id AND t.deleted_at IS NULL)::int AS tenants FROM plans p ORDER BY sort, name`);
  return rows;
}
export async function savePlan(id, p, owner) {
  const name = String(p.name || '').trim();
  if (!name) throw err('Plan name is required');
  const pid = id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || newId();
  const vals = [pid, name, String(p.description || ''), num(p.priceMonth), num(p.priceYear), (p.features || []).filter((k) => FEATURE_KEYS.includes(k)), num(p.maxUsers), Number(p.sort) || 0, p.active !== false];
  if (id) {
    await csql('UPDATE plans SET name=$2, description=$3, price_month=$4, price_year=$5, features=$6, max_users=$7, sort=$8, active=$9, updated_at=now() WHERE id=$1', vals);
  } else {
    const { rows } = await csql('SELECT 1 FROM plans WHERE id = $1', [pid]);
    if (rows.length) throw err('A plan with this name already exists');
    await csql('INSERT INTO plans (id, name, description, price_month, price_year, features, max_users, sort, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', vals);
  }
  changed();
  await audit(owner, id ? 'update_plan' : 'create_plan', null, { id: pid });
  return { id: pid };
}

// ---------------- settings ----------------
const SETTING_KEYS = ['brand_name', 'support_phone', 'support_email', 'warn_days', 'default_grace_days', 'online_renewal', 'rzp_key_id', 'company_address', 'company_gst'];
export async function getSettings() {
  const s = await controlSettings();
  const { rows } = await csql("SELECT key FROM control_secrets WHERE key IN ('rzp_key_secret', 'rzp_webhook_secret')");
  return { ...s, secretsSet: rows.map((r) => r.key), base_domain: baseDomain(), control_host: normHost(process.env.CONTROL_HOST || '') };
}
export async function saveSettings(p, owner) {
  for (const k of SETTING_KEYS) {
    if (p[k] === undefined) continue;
    await csql('INSERT INTO control_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, JSON.stringify(p[k])]);
  }
  for (const k of ['rzp_key_secret', 'rzp_webhook_secret']) {
    if (p[k] === undefined || p[k] === null) continue; // undefined = unchanged
    if (p[k] === '') await csql('DELETE FROM control_secrets WHERE key = $1', [k]);
    else await csql('INSERT INTO control_secrets (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, String(p[k])]);
  }
  changed();
  await audit(owner, 'settings', null, { keys: Object.keys(p).filter((k) => !k.includes('secret')) });
  return { ok: true };
}
export async function controlSecret(key) {
  const { rows } = await csql('SELECT value FROM control_secrets WHERE key = $1', [key]);
  return rows[0]?.value || '';
}

export async function auditLog() {
  const { rows } = await csql('SELECT a.*, t.name AS tenant_name FROM control_audit a LEFT JOIN tenants t ON t.id = a.tenant_id ORDER BY a.id DESC LIMIT 500');
  return rows;
}

/** Caddy "on-demand TLS" asks before issuing a certificate: only for addresses that belong to a sanstha */
export async function tlsAllowed(domain) {
  const h = normHost(domain);
  if (!h) return false;
  if (h === normHost(process.env.CONTROL_HOST || '')) return true;
  const base = baseDomain();
  const slug = base && h.endsWith(`.${base}`) ? h.slice(0, -(base.length + 1)) : null;
  const { rows } = await csql('SELECT 1 FROM tenants WHERE deleted_at IS NULL AND ($1 = ANY(hosts) OR slug = $2) LIMIT 1', [h, slug]);
  return rows.length > 0;
}

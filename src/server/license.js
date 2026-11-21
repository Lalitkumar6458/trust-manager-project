import 'server-only';
import { FULL_LICENSE, rpcFeature, READ_SAFE_RPC, collectionFeature, featureLabel } from '@/lib/features';
import { licenseState, effectiveFeatures } from '@/lib/license';
import { multiTenant, currentTenant, csql } from './tenant';

// ------------------------------------------------------------------
// Licence of the current sanstha (plan, features, expiry) – enforced on the server.
// Single install → everything allowed.
// ------------------------------------------------------------------
const g = globalThis;
const cache = g.__tmLicCache || (g.__tmLicCache = new Map());
export const clearLicenseCache = () => cache.clear();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 20_000) return hit.v;
  const v = await fn();
  cache.set(key, { v, at: Date.now() });
  return v;
}

export const controlSettings = () => cached('settings', async () => {
  const { rows } = await csql('SELECT key, value FROM control_settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
});
const planById = (id) => cached(`plan:${id}`, async () => (id ? (await csql('SELECT * FROM plans WHERE id = $1', [id])).rows[0] || null : null));

/** licence object for a tenant row (also used by the control panel) */
export async function licenseOf(t, settings) {
  const s = settings || await controlSettings();
  const plan = await planById(t.plan_id);
  const st = licenseState({ expiresOn: t.expires_on, graceDays: t.grace_days, status: t.status, warnDays: Number(s.warn_days ?? 15) });
  return {
    mode: 'saas',
    slug: t.slug,
    name: t.name,
    planId: t.plan_id,
    planName: t.billing === 'fixed' ? 'Fixed deal' : plan?.name || '—',
    billing: t.billing || 'subscription', // fixed = one-time deal: no plan / billing screen for the sanstha
    features: effectiveFeatures(plan?.features || [], t.features || {}),
    maxUsers: t.max_users ?? plan?.max_users ?? null,
    trial: !!t.trial,
    startsOn: t.starts_on,
    expiresOn: t.expires_on,
    graceDays: t.grace_days,
    ...st,
    support: { name: s.brand_name || '', phone: s.support_phone || '', email: s.support_email || '' },
  };
}

export async function getLicense() {
  if (!multiTenant()) return FULL_LICENSE;
  return licenseOf(await currentTenant());
}

const err = (message, status = 402) => Object.assign(new Error(message), { status });
const expiredMsg = 'Your plan has expired – the panel is read-only. Renew from Plan & billing to add new entries.';
const lockedMsg = 'This account is suspended. Please contact your software provider.';

export async function assertNotLocked(lic) {
  const l = lic || await getLicense();
  if (l.locked) throw err(lockedMsg, 423);
  return l;
}
export async function assertFeature(key, lic) {
  const l = lic || await getLicense();
  if (l.locked) throw err(lockedMsg, 423);
  if (!(l.features || []).includes(key)) throw err(`“${featureLabel(key)}” is not in your plan. Contact your software provider to add it.`, 403);
  return l;
}
export async function assertWritable(lic) {
  const l = lic || await getLicense();
  if (l.locked) throw err(lockedMsg, 423);
  if (l.readOnly) throw err(expiredMsg);
  return l;
}
/** gate for every server action */
export function enforceRpc(name, lic) {
  if (!lic || lic.mode === 'single') return;
  if (lic.locked) throw err(lockedMsg, 423);
  const f = rpcFeature(name);
  if (f && !lic.features.includes(f)) throw err(`“${featureLabel(f)}” is not in your plan. Contact your software provider to add it.`, 403);
  if (lic.readOnly && !READ_SAFE_RPC.has(name)) throw err(expiredMsg);
}
export function enforceCollection(coll, lic) {
  if (!lic || lic.mode === 'single') return;
  const f = collectionFeature(coll);
  if (f && !lic.features.includes(f)) throw err(`“${featureLabel(f)}” is not in your plan.`, 403);
}
export async function hasFeatureNow(key) {
  const l = await getLicense();
  return !l.locked && (l.features || []).includes(key);
}

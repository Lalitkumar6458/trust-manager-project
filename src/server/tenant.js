import 'server-only';
import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

// ------------------------------------------------------------------
// Multi-sanstha (SaaS) mode.
//   • CONTROL_DATABASE_URL set  → one app serves many sansthas; every sanstha has its OWN
//     PostgreSQL database (tm_<slug>), picked from the web address (Host) of the request:
//       shawlaji.yourbrand.in  or a custom domain listed for that sanstha.
//   • not set                   → single install exactly as before (DATABASE_URL).
// The owner control panel lives on CONTROL_HOST (e.g. admin.yourbrand.in).
// ------------------------------------------------------------------

pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// date → 'YYYY-MM-DD' string (no time-zone shifts)
pg.types.setTypeParser(1082, (v) => v);

const g = globalThis;
export const multiTenant = () => !!process.env.CONTROL_DATABASE_URL;
export const normHost = (h) => String(h || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
export const controlHost = () => normHost(process.env.CONTROL_HOST || '');
export const baseDomain = () => normHost(process.env.TENANT_BASE_DOMAIN || '');

const als = g.__tmTenantAls || (g.__tmTenantAls = new AsyncLocalStorage());
/** run code (cron job, provisioning, script) for one sanstha */
export const runAsTenant = (tenant, fn) => als.run({ tenant }, fn);

const poolOpts = (connectionString, max) => ({
  connectionString,
  max,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 15_000,
  statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 30_000),
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

export function controlPool() {
  if (!g.__tmControlPool) {
    g.__tmControlPool = new pg.Pool(poolOpts(process.env.CONTROL_DATABASE_URL, 5));
    g.__tmControlPool.on('error', (e) => console.error('control pool error:', e.message)); // eslint-disable-line no-console
  }
  return g.__tmControlPool;
}
export const csql = (text, params) => controlPool().query(text, params);

/** connection string of a sanstha database (same server / login as the control database) */
export function tenantDbUrl(dbName) {
  const u = new URL(process.env.TENANT_DATABASE_URL || process.env.CONTROL_DATABASE_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

const pools = g.__tmTenantPools || (g.__tmTenantPools = new Map());
export function tenantPool(t) {
  let p = pools.get(t.db_name);
  if (!p) {
    p = new pg.Pool(poolOpts(tenantDbUrl(t.db_name), Number(process.env.TENANT_POOL_MAX || 4)));
    p.on('error', (e) => console.error(`pool ${t.db_name} error:`, e.message)); // eslint-disable-line no-console
    pools.set(t.db_name, p);
  }
  return p;
}
export async function closeTenantPool(dbName) {
  const p = pools.get(dbName);
  pools.delete(dbName);
  if (p) await p.end().catch(() => {});
}

// host → tenant row (short cache; cleared by the control panel on every change)
const cache = g.__tmHostCache || (g.__tmHostCache = new Map());
export const clearTenantCache = () => cache.clear();
const TTL = 20_000;

export async function tenantByHost(host) {
  const h = normHost(host);
  const hit = cache.get(h);
  if (hit && Date.now() - hit.at < TTL) return hit.t;
  const base = baseDomain();
  const slug = base && h.endsWith(`.${base}`) ? h.slice(0, -(base.length + 1)) : null;
  const { rows } = await csql('SELECT * FROM tenants WHERE deleted_at IS NULL AND ($1 = ANY(hosts) OR slug = $2) ORDER BY ($1 = ANY(hosts)) DESC LIMIT 1', [h, slug]);
  const t = rows[0] || null;
  cache.set(h, { t, at: Date.now() });
  if (cache.size > 2000) cache.clear();
  return t;
}

export async function requestHost() {
  const { headers } = await import('next/headers');
  const h = await headers();
  return normHost(h.get('host'));
}

const notFound = () => Object.assign(new Error('No sanstha is set up for this web address. Please check the address or contact your software provider.'), { status: 404 });

/** current sanstha (null in single-install mode) */
export async function currentTenant() {
  if (!multiTenant()) return null;
  const st = als.getStore();
  if (st?.tenant) return st.tenant;
  let host;
  try { host = await requestHost(); } catch { throw new Error('No sanstha in this context (run the code inside runAsTenant)'); }
  if (host && host === controlHost()) throw notFound();
  const t = await tenantByHost(host);
  if (!t) throw notFound();
  return t;
}
/** short key of the current sanstha ('' in single-install mode) – for caches */
export async function tenantKey() {
  const t = await currentTenant();
  return t ? t.slug : '';
}
export async function isControlRequest() {
  if (!multiTenant()) return false;
  try { return (await requestHost()) === controlHost(); } catch { return false; }
}
/** public address of the current sanstha, e.g. https://shawlaji.yourbrand.in */
export async function tenantBaseUrl() {
  const t = await currentTenant();
  if (!t) return '';
  const host = (t.hosts && t.hosts[0]) || (baseDomain() ? `${t.slug}.${baseDomain()}` : '');
  return host ? `https://${host}` : '';
}

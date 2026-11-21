import 'server-only';
import pg from 'pg';
import { multiTenant, currentTenant, tenantPool } from './tenant';

// numeric → JS number (amounts are stored inside jsonb, aggregates come back as numeric)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// bigint (count(*)) → number
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

const g = globalThis;
/** Single install: one connection pool per server process (survives hot reloads in dev) */
function defaultPool() {
  if (!g.__tmPool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set – add it to .env.local');
    g.__tmPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 30_000),
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    g.__tmPool.on('error', (e) => console.error('pg pool error:', e.code || '', e.message)); // eslint-disable-line no-console
  }
  return g.__tmPool;
}

/** Pool of the current sanstha's database (multi-sanstha mode) or the single database */
export async function pool() {
  if (!multiTenant()) return defaultPool();
  return tenantPool(await currentTenant());
}

export const sql = async (text, params) => (await pool()).query(text, params);

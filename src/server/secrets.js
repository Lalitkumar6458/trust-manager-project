import 'server-only';
import { sql } from './pg';
import { tenantKey } from './tenant';

// Server-only secrets (SMTP password, WhatsApp token, Razorpay secret …).
// Stored in the app_secrets table – never readable through /api/query.
const ensured = new Set(); // per sanstha database
async function ensure() {
  const k = await tenantKey();
  if (ensured.has(k)) return;
  await sql(`CREATE TABLE IF NOT EXISTS app_secrets (key text PRIMARY KEY, value text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
  ensured.add(k);
}

export async function getSecret(key) {
  await ensure();
  const { rows } = await sql('SELECT value FROM app_secrets WHERE key = $1', [key]);
  return rows[0]?.value || '';
}

export async function getSecrets(keys) {
  await ensure();
  const { rows } = await sql('SELECT key, value FROM app_secrets WHERE key = ANY($1::text[])', [keys]);
  return Object.fromEntries(keys.map((k) => [k, rows.find((r) => r.key === k)?.value || '']));
}

/** value '' → delete */
export async function setSecret(key, value) {
  await ensure();
  if (!value) await sql('DELETE FROM app_secrets WHERE key = $1', [key]);
  else await sql('INSERT INTO app_secrets (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, String(value)]);
}

/** which of these keys have a value (for "saved ✓" in Settings, never the value itself) */
export async function secretsSet(keys) {
  await ensure();
  const { rows } = await sql('SELECT key FROM app_secrets WHERE key = ANY($1::text[])', [keys]);
  return Object.fromEntries(keys.map((k) => [k, rows.some((r) => r.key === k)]));
}

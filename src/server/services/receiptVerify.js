import 'server-only';
import crypto from 'node:crypto';
import { sql } from '../pg';
import { tenantKey, multiTenant } from '../tenant';
import { COL } from '@/lib/constants';
import { fetchOne } from './db';

// ------------------------------------------------------------------
// Receipt verification links:  https://<site>/r/<donationId>.<signature>
// The signature is an HMAC of the donation id with a server secret, so links
// cannot be guessed or made up. Anyone with the link (QR on the receipt) sees
// a small public page: trust, receipt no., date, amount, status, donor (masked).
// ------------------------------------------------------------------

const cachedBy = new Map(); // per sanstha
async function secret() {
  const k = await tenantKey();
  if (cachedBy.has(k)) return cachedBy.get(k);
  if (!multiTenant() && process.env.RECEIPT_SECRET && process.env.RECEIPT_SECRET.length >= 16) {
    cachedBy.set(k, process.env.RECEIPT_SECRET);
    return process.env.RECEIPT_SECRET;
  }
  // self-healing: works even if `npm run db:migrate` was not run after the update
  await sql(`CREATE TABLE IF NOT EXISTS app_secrets (key text PRIMARY KEY, value text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
  await sql(`INSERT INTO app_secrets (key, value) VALUES ('receipt_verify', $1) ON CONFLICT (key) DO NOTHING`, [crypto.randomBytes(32).toString('base64url')]);
  const { rows } = await sql(`SELECT value FROM app_secrets WHERE key = 'receipt_verify'`);
  cachedBy.set(k, rows[0].value);
  return rows[0].value;
}

const sign = (id, key) => crypto.createHmac('sha256', key).update(`receipt:${id}`).digest('base64url').slice(0, 16);

/** tokens for donation ids → { id: token } */
export async function verifyTokens(ids) {
  const key = await secret();
  return Object.fromEntries(ids.filter((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x)).map((id) => [id, `${id}.${sign(id, key)}`]));
}

/** "Ramesh Kumar Sharma" → "Ra*** Ku*** Sh***" */
export function maskName(name = '') {
  return String(name).trim().split(/\s+/).filter(Boolean).map((w) => {
    const ch = [...w];
    if (['श्री', 'Shri', 'Mr.', 'Mrs.', 'Smt.', 'श्रीमती', 'M/s', 'M/s.'].includes(w)) return w;
    return ch.length <= 2 ? `${ch[0]}*` : `${ch.slice(0, 2).join('')}${'*'.repeat(Math.min(ch.length - 2, 4))}`;
  }).join(' ');
}

/** Public check – returns null when the token is wrong */
export async function verifyReceipt(token) {
  const m = /^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{16})$/.exec(String(token || ''));
  if (!m) return null;
  const key = await secret();
  const expect = sign(m[1], key);
  if (!crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(m[2]))) return null;
  const [d, t] = await Promise.all([fetchOne(COL.donations, m[1]), fetchOne(COL.settings, 'trust')]);
  if (!d) return null;
  return {
    trust: { name: t?.name || '', nameEn: t?.nameEn || '', address: t?.address || '', phones: t?.phones || '', pan: t?.pan || '', section80G: t?.section80G || '' },
    receiptNo: d.receiptNo || '',
    date: d.date,
    amount: d.amount,
    paymentMode: d.paymentMode,
    donor: maskName(d.donor?.organizationName || d.donor?.name),
    status: d.status,
    bounced: !!d.bounced,
    voidReason: d.status === 'void' ? (d.bounced ? 'Cheque / payment bounced' : 'Cancelled') : '',
    categories: [...new Set((d.lines || []).map((l) => l.categoryNameHi || l.categoryName).filter(Boolean))],
  };
}

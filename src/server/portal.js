import 'server-only';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { COL } from '@/lib/constants';
import { MOBILE_REGEX, PAN_REGEX } from '@/lib/format';
import { sql } from './pg';
import { fetchAll, fetchOne, where, writeBatch, docRef, writeAudit, updatedStamp } from './services/db';
import { donorKeywords } from './services/masters';
import { messagingOf, sendWhatsAppTemplate, sendEmail } from './messaging';
import { getSecret } from './secrets';
import { assertFeature, assertWritable } from './license';

// ------------------------------------------------------------------
// Donor portal: donors sign in with an OTP (WhatsApp or email) and see / download
// their own receipts and yearly statements. No password.
// ------------------------------------------------------------------
export const DONOR_COOKIE = 'tm_donor';
const OTP_MINUTES = 10;
const SESSION_DAYS = 7;
const MAX_TRIES = 5;
const PORTAL_USER = (name) => ({ uid: 'donor-portal', name: `Donor portal – ${name}`, role: null });
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function pepper() {
  return (await getSecret('receipt_verify')) || process.env.CRON_SECRET || 'tm';
}

/** mobile (10 digits) or email → normalised key */
export function keyOf(id) {
  const v = String(id || '').trim().toLowerCase();
  const digits = v.replace(/\D/g, '');
  if (MOBILE_REGEX.test(digits.slice(-10)) && !v.includes('@')) return { kind: 'mobile', key: digits.slice(-10) };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { kind: 'email', key: v };
  throw bad('Enter your registered mobile number or email');
}

async function donorsFor({ kind, key }) {
  const list = kind === 'mobile' ? await fetchAll(COL.donors, where('mobile', '==', key)) : (await fetchAll(COL.donors, where('email', '==', key)));
  return list.filter((d) => d.status !== 'inactive');
}

/** always answers the same way (does not reveal whether the number is registered) */
export async function requestOtp(identifier) {
  await assertFeature('portal');
  const k = keyOf(identifier);
  const { rows } = await sql("SELECT count(*)::int AS n FROM donor_otps WHERE channel_key = $1 AND created_at > now() - interval '15 minutes'", [k.key]);
  if (rows[0].n >= 3) throw bad('Too many OTP requests – please try after 15 minutes', 429);
  const donors = await donorsFor(k);
  const settings = (await fetchOne(COL.settings, 'trust')) || {};
  const cfg = messagingOf(settings);
  const canWa = k.kind === 'mobile' && cfg.whatsappEnabled && cfg.waOtpTemplate;
  const email = k.kind === 'email' ? k.key : donors.find((d) => d.email)?.email;
  const canMail = cfg.emailEnabled && !!email && k.kind === 'email';
  if (!canWa && !canMail) {
    if (k.kind === 'mobile' && !cfg.whatsappEnabled) throw bad('OTP on mobile is not available yet – please sign in with your email, or contact the trust office', 503);
    if (k.kind === 'email' && !cfg.emailEnabled) throw bad('Email OTP is not available – please contact the trust office', 503);
  }
  const id = crypto.randomBytes(12).toString('base64url');
  const code = String(crypto.randomInt(100000, 1000000));
  await sql(`INSERT INTO donor_otps (id, channel_key, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '${OTP_MINUTES} minutes')`, [id, k.key, sha(`${await pepper()}:${k.key}:${code}`)]);
  if (Math.random() < 0.1) sql("DELETE FROM donor_otps WHERE expires_at < now() - interval '1 day'").catch(() => {});
  if (donors.length) {
    try {
      if (canWa) await sendWhatsAppTemplate(settings, { to: k.key, template: cfg.waOtpTemplate, params: [code] });
      else if (canMail) await sendEmail(settings, { to: email, subject: `OTP ${code} – ${settings.name || ''}`, text: `आपका OTP / Your OTP: ${code}\n\n${OTP_MINUTES} मिनट तक मान्य / valid for ${OTP_MINUTES} minutes.\n${settings.name || ''}` });
    } catch (e) {
      console.error('portal otp send failed', e.message); // eslint-disable-line no-console
      throw bad('OTP could not be sent – please try again later', 502);
    }
  }
  return { sent: true, via: canWa ? 'whatsapp' : 'email', minutes: OTP_MINUTES };
}

export async function verifyOtp(identifier, code, info = {}) {
  const k = keyOf(identifier);
  const c = String(code || '').replace(/\D/g, '');
  const { rows } = await sql('SELECT id, code_hash, attempts FROM donor_otps WHERE channel_key = $1 AND expires_at > now() ORDER BY created_at DESC LIMIT 1', [k.key]);
  const row = rows[0];
  if (!row || row.attempts >= MAX_TRIES) throw bad('OTP expired – request a new one');
  await sql('UPDATE donor_otps SET attempts = attempts + 1 WHERE id = $1', [row.id]);
  const expect = sha(`${await pepper()}:${k.key}:${c}`);
  if (c.length !== 6 || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(row.code_hash))) throw bad('Wrong OTP');
  await sql('DELETE FROM donor_otps WHERE channel_key = $1', [k.key]);
  const donors = await donorsFor(k);
  if (!donors.length) throw bad('No donor record found for this number / email');
  const token = crypto.randomBytes(32).toString('base64url');
  await sql(`INSERT INTO donor_sessions (token_hash, channel_key, donor_ids, expires_at) VALUES ($1, $2, $3, now() + interval '${SESSION_DAYS} days')`, [sha(token), k.key, JSON.stringify(donors.map((d) => d.id))]);
  const jar = await cookies();
  jar.set(DONOR_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400,
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : !!info.https,
  });
  return { ok: true };
}

export async function currentDonorSession() {
  const jar = await cookies();
  const token = jar.get(DONOR_COOKIE)?.value;
  if (!token) return null;
  const { rows } = await sql('SELECT channel_key, donor_ids FROM donor_sessions WHERE token_hash = $1 AND expires_at > now()', [sha(token)]);
  return rows[0] ? { key: rows[0].channel_key, donorIds: rows[0].donor_ids || [] } : null;
}

export async function requireDonor() {
  await assertFeature('portal');
  const s = await currentDonorSession();
  if (!s || !s.donorIds.length) throw bad('Please sign in again', 401);
  return s;
}

export async function portalLogout() {
  const jar = await cookies();
  const token = jar.get(DONOR_COOKIE)?.value;
  if (token) await sql('DELETE FROM donor_sessions WHERE token_hash = $1', [sha(token)]);
  jar.delete(DONOR_COOKIE);
}

const PUBLIC_DONOR = (d) => ({
  id: d.id, name: d.name, organizationName: d.organizationName || '', donorCode: d.donorCode || '', mobile: d.mobile || '', email: d.email || '',
  address: d.address || '', pan: d.pan || '', dob: d.dob || '', anniversary: d.anniversary || '', totalAmount: d.totalAmount || 0, donationCount: d.donationCount || 0,
});

export async function portalData() {
  const s = await requireDonor();
  const [donors, settings] = await Promise.all([Promise.all(s.donorIds.map((id) => fetchOne(COL.donors, id))), fetchOne(COL.settings, 'trust')]);
  const lists = await Promise.all(s.donorIds.map((id) => fetchAll(COL.donations, where('donorId', '==', id))));
  const donations = lists.flat()
    .filter((d) => ['approved', 'void'].includes(d.status) && d.receiptNo)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map((d) => ({
      id: d.id, receiptNo: d.receiptNo, date: d.date, amount: d.amount, status: d.status, paymentMode: d.paymentMode, financialYearId: d.financialYearId, donorId: d.donorId,
      categories: [...new Set((d.lines || []).map((l) => l.categoryNameHi || l.categoryName))].join(', '),
    }));
  const pledges = (await Promise.all(s.donorIds.map((id) => fetchAll(COL.pledges, where('donorId', '==', id))))).flat()
    .filter((p) => ['active', 'paused'].includes(p.status))
    .map((p) => ({ id: p.id, pledgeNo: p.pledgeNo, amount: p.amount, frequency: p.frequency, nextDue: p.nextDue, categoryName: p.categoryNameHi || p.categoryName, receivedCount: p.receivedCount || 0 }));
  const t = settings || {};
  return {
    trust: { name: t.name || '', nameEn: t.nameEn || '', address: t.address || '', phones: t.phones || '', section80G: t.section80G || '' },
    donors: donors.filter(Boolean).map(PUBLIC_DONOR),
    donations,
    pledges,
    onlineDonation: !!(t.online?.enabled && t.online?.keyId),
  };
}

/** donor can fix email / address / PAN / birthday (audit-logged) */
export async function updateProfile(donorId, input) {
  await assertWritable();
  const s = await requireDonor();
  if (!s.donorIds.includes(donorId)) throw bad('Not allowed', 403);
  const d = await fetchOne(COL.donors, donorId);
  if (!d) throw bad('Not found', 404);
  const patch = {};
  if (input.email !== undefined) {
    const e = String(input.email || '').trim().toLowerCase();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('Email is not valid');
    patch.email = e;
  }
  if (input.address !== undefined) patch.address = String(input.address || '').trim().slice(0, 300);
  if (input.pan !== undefined) {
    const p = String(input.pan || '').trim().toUpperCase();
    if (p && !PAN_REGEX.test(p)) throw bad('PAN is not valid');
    patch.pan = p;
  }
  ['dob', 'anniversary'].forEach((k) => {
    if (input[k] !== undefined) {
      const v = /^\d{4}-\d{2}-\d{2}$/.test(input[k] || '') ? input[k] : '';
      patch[k] = v;
      patch[`${k}MD`] = v ? v.slice(5) : '';
    }
  });
  if (input.noMessages !== undefined) patch.noMessages = !!input.noMessages;
  const user = PORTAL_USER(d.name);
  const b = writeBatch();
  b.update(docRef(COL.donors, donorId), { ...patch, searchKeywords: donorKeywords({ ...d, ...patch }), ...updatedStamp(user) });
  writeAudit(b, user, {
    collection: COL.donors, docId: donorId, ref: d.name, action: 'update', summary: 'Updated by the donor in the donor portal',
    changes: Object.keys(patch).filter((k) => !k.endsWith('MD') && String(d[k] ?? '') !== String(patch[k] ?? '')).map((k) => ({ field: k, old: d[k] ?? null, new: patch[k] })),
  });
  await b.commit();
  return { ok: true };
}

/** donation that belongs to the signed-in donor (for the receipt PDF) */
export async function portalDonation(id) {
  const s = await requireDonor();
  const d = await fetchOne(COL.donations, id);
  if (!d || !s.donorIds.includes(d.donorId) || d.status !== 'approved') throw bad('Not found', 404);
  return d;
}

import 'server-only';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { cookies, headers } from 'next/headers';
import { sql } from './pg';
import { tenantKey } from './tenant';
import { getLicense, assertNotLocked } from './license';

// ------------------------------------------------------------------
// Logins & sessions (replaces Firebase Auth)
//  • passwords: scrypt (salted) in user_credentials – never in the users record
//  • session: random 256-bit token in an httpOnly cookie, only its SHA-256 is stored
//  • 5 wrong passwords → login locked for 15 minutes
// ------------------------------------------------------------------
const scrypt = promisify(crypto.scrypt);
export const COOKIE = 'tm_session';
const SESSION_DAYS = 7; // absolute lifetime
const IDLE_HOURS = 12; // server-side idle limit (the browser also logs out after inactivity)
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

// 2-step login columns (also in migration 003) – added here too so an old database never breaks the login
const schemaOk = new Set(); // per sanstha database
async function ensureAuthSchema() {
  const k = await tenantKey();
  if (schemaOk.has(k)) return;
  await sql(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pending_2fa boolean NOT NULL DEFAULT false;
    ALTER TABLE user_credentials ADD COLUMN IF NOT EXISTS totp_secret text;
    ALTER TABLE user_credentials ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;
    ALTER TABLE user_credentials ADD COLUMN IF NOT EXISTS recovery_codes jsonb NOT NULL DEFAULT '[]'::jsonb;`);
  schemaOk.add(k);
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 16384; const r = 8; const p = 1;
  const key = await scrypt(String(password), salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Passwords moved over from Firebase Authentication keep working:
 * fbscrypt$<rounds>$<memCost>$<saltSeparator>$<signerKey>$<salt>$<hash>  (Firebase's modified scrypt).
 * After the first successful sign-in they are re-hashed with our own scrypt.
 */
async function verifyFirebaseScrypt(password, stored) {
  const [, rounds, mem, sep, signer, salt, hash] = String(stored).split('$');
  const key = await scrypt(Buffer.from(String(password)), Buffer.concat([Buffer.from(salt, 'base64'), Buffer.from(sep, 'base64')]), 32, {
    N: 2 ** Number(mem), r: Number(rounds), p: 1, maxmem: 256 * 1024 * 1024,
  });
  const c = crypto.createCipheriv('aes-256-ctr', key, Buffer.alloc(16, 0));
  const out = Buffer.concat([c.update(Buffer.from(signer, 'base64')), c.final()]);
  const want = Buffer.from(hash, 'base64');
  return want.length === out.length && crypto.timingSafeEqual(want, out);
}

export const isLegacyHash = (stored) => String(stored).startsWith('fbscrypt$');

export async function verifyPassword(password, stored) {
  try {
    if (isLegacyHash(stored)) return await verifyFirebaseScrypt(password, stored);
    const [alg, N, r, p, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const key = await scrypt(String(password), Buffer.from(salt, 'base64'), 64, { N: Number(N), r: Number(r), p: Number(p) });
    const want = Buffer.from(hash, 'base64');
    return want.length === key.length && crypto.timingSafeEqual(want, key);
  } catch {
    return false;
  }
}

export function checkPasswordStrength(pw) {
  if (!pw || String(pw).length < 8) throw new Error('Password must be at least 8 characters');
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function clientInfo() {
  const h = await headers();
  return {
    ip: (h.get('x-forwarded-for') || h.get('x-real-ip') || '').split(',')[0].trim(),
    userAgent: (h.get('user-agent') || '').slice(0, 300),
    https: (h.get('x-forwarded-proto') || '').includes('https'),
  };
}

/** Profile used everywhere on the server: { uid, email, name, role, permissions, … } */
async function loadProfile(uid) {
  const r = await sql('SELECT data FROM users WHERE id = $1', [uid]);
  if (!r.rows[0]) return null;
  const p = r.rows[0].data;
  if (p.active === false) return null;
  // custom role → always use the CURRENT permission list of the role
  if (p.role === 'custom' && p.roleId) {
    const role = await sql('SELECT data FROM roles WHERE id = $1', [p.roleId]);
    if (role.rows[0]) { p.permissions = role.rows[0].data.permissions || []; p.roleName = role.rows[0].data.name; }
  }
  // licence (plan features / expiry) travels with the user: userCan() checks it on server and browser
  return { ...p, uid, id: uid, name: p.name || p.email, license: await getLicense() };
}

/** Email + password → session cookie. Returns the profile. */
export async function login(email, password) {
  await ensureAuthSchema();
  const em = String(email || '').trim().toLowerCase();
  const r = await sql('SELECT * FROM user_credentials WHERE email = $1', [em]);
  const cred = r.rows[0];
  const bad = () => Object.assign(new Error('Wrong email or password'), { status: 401 });
  if (!cred) { await verifyPassword(password, 'scrypt$16384$8$1$AAAA$AAAA'); throw bad(); }
  if (cred.locked_until && new Date(cred.locked_until) > new Date()) {
    throw Object.assign(new Error(`Too many wrong attempts. Try again after ${LOCK_MINUTES} minutes.`), { status: 429 });
  }
  if (!(await verifyPassword(password, cred.password_hash))) {
    // atomic: parallel guesses each count (no lost updates)
    await sql(
      `UPDATE user_credentials
          SET failed_attempts = CASE WHEN failed_attempts + 1 >= ${MAX_FAILED} THEN 0 ELSE failed_attempts + 1 END,
              locked_until = CASE WHEN failed_attempts + 1 >= ${MAX_FAILED} THEN now() + interval '${LOCK_MINUTES} minutes' ELSE locked_until END
        WHERE user_id = $1`,
      [cred.user_id],
    );
    throw bad();
  }
  const profile = await loadProfile(cred.user_id);
  if (!profile) throw Object.assign(new Error('Your account is disabled. Contact the Super Admin.'), { status: 403 });
  await assertNotLocked(profile.license);
  await sql('UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1', [cred.user_id]);
  if (isLegacyHash(cred.password_hash)) {
    // moved from Firebase → store it with our own hash from now on
    await sql('UPDATE user_credentials SET password_hash = $2, updated_at = now() WHERE user_id = $1', [cred.user_id, await hashPassword(password)]);
  }
  if (cred.totp_enabled) {
    // password OK – the session works only after the authenticator code (see complete2fa)
    await startSession(cred.user_id, { pending2fa: true });
    return { needs2fa: true };
  }
  await startSession(cred.user_id);
  return { ...profile, mustChangePassword: cred.must_change };
}

/** second step of the login: 6-digit authenticator code or a one-time recovery code */
export async function complete2fa(code) {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
  const r = await sql("SELECT s.user_id, c.totp_secret, c.recovery_codes, c.locked_until FROM sessions s JOIN user_credentials c ON c.user_id = s.user_id WHERE s.token_hash = $1 AND s.pending_2fa AND s.created_at > now() - interval '10 minutes'", [sha(token)]);
  const row = r.rows[0];
  if (!row) throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
  if (row.locked_until && new Date(row.locked_until) > new Date()) throw Object.assign(new Error(`Too many wrong attempts. Try again after ${LOCK_MINUTES} minutes.`), { status: 429 });
  const { verifyTotp, hashCode } = await import('@/lib/totp');
  const clean = String(code || '').trim();
  let ok = verifyTotp(row.totp_secret, clean);
  if (!ok && /[A-Za-z]/.test(clean)) {
    const h = hashCode(clean);
    const codes = row.recovery_codes || [];
    if (codes.includes(h)) {
      ok = true;
      await sql('UPDATE user_credentials SET recovery_codes = $2 WHERE user_id = $1', [row.user_id, JSON.stringify(codes.filter((x) => x !== h))]);
    }
  }
  if (!ok) {
    await sql(
      `UPDATE user_credentials
          SET failed_attempts = CASE WHEN failed_attempts + 1 >= ${MAX_FAILED} THEN 0 ELSE failed_attempts + 1 END,
              locked_until = CASE WHEN failed_attempts + 1 >= ${MAX_FAILED} THEN now() + interval '${LOCK_MINUTES} minutes' ELSE locked_until END
        WHERE user_id = $1`,
      [row.user_id],
    );
    if ((await sql('SELECT locked_until FROM user_credentials WHERE user_id = $1', [row.user_id])).rows[0]?.locked_until) {
      await sql('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]);
    }
    throw Object.assign(new Error('Wrong code'), { status: 401 });
  }
  await sql('UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1', [row.user_id]);
  await sql('UPDATE sessions SET pending_2fa = false, last_seen = now() WHERE token_hash = $1', [sha(token)]);
  const profile = await loadProfile(row.user_id);
  const mc = await sql('SELECT must_change FROM user_credentials WHERE user_id = $1', [row.user_id]);
  return { ...profile, mustChangePassword: !!mc.rows[0]?.must_change };
}

// ---------------- 2-step login setup (authenticator app) ----------------
export async function totpStatus(uid) {
  const r = await sql('SELECT totp_enabled, jsonb_array_length(recovery_codes) AS left FROM user_credentials WHERE user_id = $1', [uid]);
  return { enabled: !!r.rows[0]?.totp_enabled, recoveryLeft: Number(r.rows[0]?.left || 0) };
}

export async function totpSetup(user, issuer) {
  const { newSecret, otpauthUri } = await import('@/lib/totp');
  const QR = (await import('qrcode')).default;
  const st = await totpStatus(user.uid);
  if (st.enabled) throw Object.assign(new Error('2-step login is already on'), { status: 400 });
  const secret = newSecret();
  await sql('UPDATE user_credentials SET totp_secret = $2 WHERE user_id = $1', [user.uid, secret]);
  const uri = otpauthUri({ secret, account: user.email, issuer: issuer || 'Trust Manager' });
  return { secret, uri, qr: await QR.toDataURL(uri, { margin: 1, width: 220 }) };
}

export async function totpEnable(user, code) {
  const { verifyTotp, recoveryCodes, hashCode } = await import('@/lib/totp');
  const r = await sql('SELECT totp_secret FROM user_credentials WHERE user_id = $1', [user.uid]);
  if (!r.rows[0]?.totp_secret) throw Object.assign(new Error('Start the setup again'), { status: 400 });
  if (!verifyTotp(r.rows[0].totp_secret, code)) throw Object.assign(new Error('Wrong code – check the time on your phone and try again'), { status: 400 });
  const codes = recoveryCodes();
  await sql('UPDATE user_credentials SET totp_enabled = true, recovery_codes = $2 WHERE user_id = $1', [user.uid, JSON.stringify(codes.map(hashCode))]);
  return { recoveryCodes: codes };
}

export async function totpDisable(user, password) {
  const r = await sql('SELECT password_hash FROM user_credentials WHERE user_id = $1', [user.uid]);
  if (!r.rows[0] || !(await verifyPassword(password, r.rows[0].password_hash))) throw Object.assign(new Error('Wrong password'), { status: 400 });
  await sql("UPDATE user_credentials SET totp_enabled = false, totp_secret = NULL, recovery_codes = '[]'::jsonb WHERE user_id = $1", [user.uid]);
}

/** Super Admin: user lost the phone */
export async function totpReset(uid) {
  await sql("UPDATE user_credentials SET totp_enabled = false, totp_secret = NULL, recovery_codes = '[]'::jsonb WHERE user_id = $1", [uid]);
}

export async function startSession(uid, { pending2fa = false } = {}) {
  const info = await clientInfo();
  const token = crypto.randomBytes(32).toString('base64url');
  await sql(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent, pending_2fa) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days', $3, $4, $5)`,
    [sha(token), uid, info.ip, info.userAgent, pending2fa],
  );
  // occasionally clean up expired sessions
  if (Math.random() < 0.05) sql("DELETE FROM sessions WHERE expires_at < now() OR last_seen < now() - interval '30 days'").catch(() => {});
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : info.https,
    path: '/',
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

/** Current signed-in user (or null) */
export async function currentUser() {
  await ensureAuthSchema();
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const r = await sql(
    `SELECT user_id, last_seen FROM sessions WHERE token_hash = $1 AND NOT pending_2fa AND expires_at > now() AND last_seen > now() - interval '${IDLE_HOURS} hours'`,
    [sha(token)],
  );
  const s = r.rows[0];
  if (!s) return null;
  if (Date.now() - new Date(s.last_seen).getTime() > 5 * 60_000) {
    sql('UPDATE sessions SET last_seen = now() WHERE token_hash = $1', [sha(token)]).catch(() => {});
  }
  return loadProfile(s.user_id);
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
  return u;
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await sql('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]);
  jar.delete(COOKIE);
}

/** Ends every session of a user (password reset, disabled login) – optionally keeping the current one */
export async function endSessionsOf(uid, { keepCurrent = false } = {}) {
  if (!keepCurrent) { await sql('DELETE FROM sessions WHERE user_id = $1', [uid]); return; }
  const token = (await cookies()).get(COOKIE)?.value;
  await sql('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [uid, token ? sha(token) : '']);
}

export async function setPassword(uid, password, { mustChange = false } = {}) {
  checkPasswordStrength(password);
  await sql('UPDATE user_credentials SET password_hash = $2, must_change = $3, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE user_id = $1', [uid, await hashPassword(password), mustChange]);
}

export async function changeOwnPassword(user, current, next) {
  const r = await sql('SELECT password_hash FROM user_credentials WHERE user_id = $1', [user.uid]);
  if (!r.rows[0] || !(await verifyPassword(current, r.rows[0].password_hash))) throw new Error('Current password is wrong');
  await setPassword(user.uid, next);
  await endSessionsOf(user.uid, { keepCurrent: true });
}

export { clientInfo };

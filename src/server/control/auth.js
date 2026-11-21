import 'server-only';
import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { hashPassword, verifyPassword } from '../auth';
import { csql, multiTenant, controlHost, normHost } from '../tenant';

// ------------------------------------------------------------------
// Owner (software provider) login for the control panel – separate from sanstha staff logins.
// Works only on CONTROL_HOST. Session: random token in httpOnly cookie, SHA-256 stored.
// ------------------------------------------------------------------
export const OWNER_COOKIE = 'tm_owner';
const SESSION_HOURS = 12;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const err = (m, status = 400) => Object.assign(new Error(m), { status });

export async function assertControlHost() {
  if (!multiTenant() || !controlHost()) throw err('Not found', 404);
  const h = await headers();
  if (normHost(h.get('host')) !== controlHost()) throw err('Not found', 404);
  return h;
}

export async function ownerLogin(email, password) {
  const h = await assertControlHost();
  const em = String(email || '').trim().toLowerCase();
  const { rows } = await csql('SELECT * FROM owners WHERE email = $1', [em]);
  const o = rows[0];
  const bad = () => err('Wrong email or password', 401);
  if (!o) { await verifyPassword(password, 'scrypt$16384$8$1$AAAA$AAAA'); throw bad(); }
  if (o.locked_until && new Date(o.locked_until) > new Date()) throw err('Too many wrong attempts. Try again after 15 minutes.', 429);
  if (!(await verifyPassword(password, o.password_hash))) {
    await csql(`UPDATE owners SET failed_attempts = CASE WHEN failed_attempts + 1 >= 5 THEN 0 ELSE failed_attempts + 1 END,
      locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = $1`, [o.id]);
    throw bad();
  }
  await csql('UPDATE owners SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [o.id]);
  const token = crypto.randomBytes(32).toString('base64url');
  await csql(`INSERT INTO owner_sessions (token_hash, owner_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_HOURS} hours')`, [sha(token), o.id]);
  await csql("DELETE FROM owner_sessions WHERE expires_at < now()");
  const jar = await cookies();
  jar.set(OWNER_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : (h.get('x-forwarded-proto') || '').includes('https'),
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });
  await audit({ email: o.email }, 'login');
  return { id: o.id, email: o.email, name: o.name };
}

export async function currentOwner() {
  await assertControlHost();
  const token = (await cookies()).get(OWNER_COOKIE)?.value;
  if (!token) return null;
  const { rows } = await csql(
    'SELECT o.id, o.email, o.name FROM owner_sessions s JOIN owners o ON o.id = s.owner_id WHERE s.token_hash = $1 AND s.expires_at > now()',
    [sha(token)],
  );
  return rows[0] || null;
}

export async function requireOwner() {
  const o = await currentOwner();
  if (!o) throw err('Please sign in again', 401);
  return o;
}

export async function ownerLogout() {
  const jar = await cookies();
  const token = jar.get(OWNER_COOKIE)?.value;
  if (token) await csql('DELETE FROM owner_sessions WHERE token_hash = $1', [sha(token)]);
  jar.delete(OWNER_COOKIE);
}

export async function changeOwnerPassword(owner, current, next) {
  if (!next || String(next).length < 10) throw err('New password must be at least 10 characters');
  const { rows } = await csql('SELECT password_hash FROM owners WHERE id = $1', [owner.id]);
  if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) throw err('Current password is wrong');
  await csql('UPDATE owners SET password_hash = $2 WHERE id = $1', [owner.id, await hashPassword(next)]);
  await audit(owner, 'change_password');
  return { ok: true };
}

export async function audit(owner, action, tenantId = null, detail = {}) {
  await csql('INSERT INTO control_audit (actor, action, tenant_id, detail) VALUES ($1, $2, $3, $4)', [owner?.email || 'system', action, tenantId, detail]).catch(() => {});
}

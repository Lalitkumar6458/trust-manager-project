import 'server-only';
import { COL, ROLES } from '@/lib/constants';
import { sql, pool } from '../pg';
import { hashPassword, checkPasswordStrength, setPassword, endSessionsOf } from '../auth';
import {
  docRef, writeBatch, db, updatedStamp, writeAudit, fetchOne, newId, serverTimestamp,
} from './db';

const BUILT_IN = Object.values(ROLES);

async function roleFields(role) {
  if (typeof role === 'string' && role.startsWith('custom:')) {
    const r = await fetchOne(COL.roles, role.slice(7));
    if (!r) throw new Error('Role not found');
    return { role: 'custom', roleId: r.id, roleName: r.name, permissions: r.permissions || [] };
  }
  if (BUILT_IN.includes(role)) return { role, roleId: null, roleName: null, permissions: [] };
  throw new Error('Invalid role');
}

/** Creates a staff login + profile (Super Admin only) */
export async function createStaffUser({ name, email, password, role, mobile }, me) {
  if (!name || !email || !password) throw new Error('Name, email and password are required');
  checkPasswordStrength(password);
  const em = String(email).trim().toLowerCase();
  const fields = await roleFields(role);
  const exists = await sql('SELECT 1 FROM user_credentials WHERE email = $1', [em]);
  if (exists.rows.length) throw new Error('A login with this email already exists');
  const uid = newId();
  const hash = await hashPassword(password);
  const client = await (await pool()).connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO users (id, data) VALUES ($1, $2)', [uid, {
      name, email: em, mobile: mobile || '', ...fields, active: true,
      createdAt: new Date().toISOString(), createdBy: me.uid, createdByName: me.name || '',
    }]);
    // the Super Admin sets a TEMPORARY password – the user must choose his own at first sign-in
    await client.query('INSERT INTO user_credentials (user_id, email, password_hash, must_change) VALUES ($1, $2, $3, true)', [uid, em, hash]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const b = writeBatch(db);
  writeAudit(b, me, { collection: COL.users, docId: uid, ref: em, action: 'create', summary: `create user ${em}`, changes: [{ field: 'role', old: null, new: fields.roleName || fields.role }] });
  await b.commit();
  return { uid };
}

/** Enable / disable login and / or reset password (Super Admin only) */
export async function updateStaffLogin({ uid, disabled, password }, me) {
  if (!uid) throw new Error('uid required');
  if (uid === me.uid && disabled) throw new Error('You cannot disable your own login');
  const target = await fetchOne(COL.users, uid);
  if (!target) throw new Error('User not found');
  if (password) {
    await setPassword(uid, password, { mustChange: uid !== me.uid });
    await endSessionsOf(uid, { keepCurrent: uid === me.uid });
  }
  const b = writeBatch(db);
  if (typeof disabled === 'boolean') {
    b.update(docRef(COL.users, uid), { active: !disabled, ...updatedStamp(me) });
    if (disabled) await endSessionsOf(uid);
  }
  writeAudit(b, me, { collection: COL.users, docId: uid, ref: target.email || uid, action: password ? 'reset_password' : (disabled ? 'disable' : 'enable'), summary: `${password ? 'reset password of' : (disabled ? 'disable' : 'enable')} user ${target.email || ''}` });
  await b.commit();
  return { ok: true };
}

export async function updateUserProfile(uid, patch, me) {
  const old = await fetchOne(COL.users, uid);
  if (!old) throw new Error('User not found');
  const allowed = {};
  ['name', 'mobile'].forEach((k) => { if (patch[k] !== undefined) allowed[k] = patch[k]; });
  const b = writeBatch(db);
  b.update(docRef(COL.users, uid), { ...allowed, ...updatedStamp(me) });
  writeAudit(b, me, {
    collection: COL.users, docId: uid, ref: old.email || uid, action: 'update',
    changes: Object.keys(allowed).map((k) => ({ field: k, old: old[k] ?? null, new: allowed[k] })),
  });
  await b.commit();
}

export { serverTimestamp };

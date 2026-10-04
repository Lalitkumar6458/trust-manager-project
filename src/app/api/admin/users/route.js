import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES = ['superAdmin', 'accountant', 'operator', 'auditor'];

async function requireSuperAdmin(req) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw Object.assign(new Error('Not signed in'), { status: 401 });
  const decoded = await adminAuth().verifyIdToken(token);
  const me = await adminDb().collection('users').doc(decoded.uid).get();
  if (!me.exists || me.data().role !== 'superAdmin' || me.data().active === false) {
    throw Object.assign(new Error('Only the Super Admin can manage users'), { status: 403 });
  }
  return { uid: decoded.uid, ...me.data() };
}

function fail(e) {
  const msg = String(e.message || e);
  const hint = /credential|private key|project id|Could not load the default/i.test(msg)
    ? ' – Firebase Admin credentials are not configured. Set FIREBASE_ADMIN_* variables in .env.local (see README).'
    : '';
  return NextResponse.json({ error: msg + hint }, { status: e.status || 400 });
}

async function audit(me, action, target, changes, req) {
  await adminDb().collection('auditLogs').add({
    collection: 'users',
    docId: target.uid,
    ref: target.email || target.uid,
    action,
    summary: `${action} user ${target.email || ''}`,
    changes,
    reason: '',
    userId: me.uid,
    userName: me.name || me.email || '',
    role: me.role,
    device: (req.headers.get('user-agent') || '').slice(0, 180),
    ip: req.headers.get('x-forwarded-for') || '',
    at: FieldValue.serverTimestamp(),
  });
}

/** Create a staff login */
export async function POST(req) {
  try {
    const me = await requireSuperAdmin(req);
    const { name, email, password, role, mobile } = await req.json();
    if (!name || !email || !password) throw new Error('Name, email and password are required');
    if (password.length < 8) throw new Error('Password must be at least 8 characters');
    let roleFields;
    if (typeof role === 'string' && role.startsWith('custom:')) {
      // custom role → copy its permission list onto the user (security rules read it from there)
      const r = await adminDb().collection('roles').doc(role.slice(7)).get();
      if (!r.exists) throw new Error('Role not found');
      roleFields = { role: 'custom', roleId: r.id, roleName: r.data().name, permissions: r.data().permissions || [] };
    } else if (ROLES.includes(role)) {
      roleFields = { role, roleId: null, roleName: null, permissions: [] };
    } else {
      throw new Error('Invalid role');
    }
    const u = await adminAuth().createUser({ email, password, displayName: name });
    await adminDb().collection('users').doc(u.uid).set({
      name, email, mobile: mobile || '', ...roleFields, active: true,
      createdAt: FieldValue.serverTimestamp(), createdBy: me.uid, createdByName: me.name || '',
    });
    await audit(me, 'create', { uid: u.uid, email }, [{ field: 'role', old: null, new: roleFields.roleName || roleFields.role }], req);
    return NextResponse.json({ uid: u.uid });
  } catch (e) {
    return fail(e);
  }
}

/** Enable / disable login, reset password */
export async function PATCH(req) {
  try {
    const me = await requireSuperAdmin(req);
    const { uid, disabled, password } = await req.json();
    if (!uid) throw new Error('uid required');
    if (uid === me.uid && disabled) throw new Error('You cannot disable your own login');
    const patch = {};
    if (typeof disabled === 'boolean') patch.disabled = disabled;
    if (password) {
      if (password.length < 8) throw new Error('Password must be at least 8 characters');
      patch.password = password;
    }
    const target = await adminAuth().updateUser(uid, patch);
    if (typeof disabled === 'boolean') {
      await adminDb().collection('users').doc(uid).update({ active: !disabled, updatedAt: FieldValue.serverTimestamp(), updatedBy: me.uid });
      if (disabled) await adminAuth().revokeRefreshTokens(uid);
    }
    await audit(me, password ? 'reset_password' : (disabled ? 'disable' : 'enable'), { uid, email: target.email }, [], req);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

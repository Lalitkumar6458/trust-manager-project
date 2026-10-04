'use client';

import { COL } from '@/lib/constants';
import { CUSTOM_ROLE, normalizePerms } from '@/lib/permissions';
import {
  db, docRef, colRef, writeBatch, doc, createdStamp, updatedStamp, writeAudit, fetchAll, where,
} from './db';

/**
 * Custom roles (Super Admin only).
 * roles/{id}: { name, description, permissions[] }
 * The permission list is also copied onto every user holding the role
 * (users/{uid}.permissions) because the security rules read it from there.
 */
export async function saveRole({ id, name, description, permissions }, user, old = null) {
  const perms = normalizePerms(permissions);
  if (!name?.trim()) throw new Error('Role name is required');
  if (!perms.length) throw new Error('Select at least one screen');
  const ref = id ? docRef(COL.roles, id) : doc(colRef(COL.roles));
  const data = { name: name.trim(), description: description || '', permissions: perms };

  const holders = id ? await fetchAll(COL.users, where('roleId', '==', id)) : [];
  const b = writeBatch(db);
  if (id) b.update(ref, { ...data, ...updatedStamp(user) });
  else b.set(ref, { ...data, ...createdStamp(user) });
  holders.forEach((u) => b.update(docRef(COL.users, u.id), { permissions: perms, roleName: data.name, ...updatedStamp(user) }));
  writeAudit(b, user, {
    collection: COL.roles, docId: ref.id, ref: data.name, action: id ? 'update' : 'create',
    summary: `${id ? 'Updated' : 'Created'} custom role “${data.name}” (${perms.length} permissions${holders.length ? `, ${holders.length} user(s) updated` : ''})`,
    changes: old ? [
      { field: 'name', old: old.name, new: data.name },
      { field: 'permissions', old: (old.permissions || []).join(', '), new: perms.join(', ') },
    ].filter((c) => c.old !== c.new) : [],
  });
  await b.commit();
  return ref.id;
}

export async function deleteRole(role, user) {
  const holders = await fetchAll(COL.users, where('roleId', '==', role.id));
  if (holders.length) throw new Error('This role is assigned to users. Change their role first.');
  const b = writeBatch(db);
  b.delete(docRef(COL.roles, role.id));
  writeAudit(b, user, { collection: COL.roles, docId: role.id, ref: role.name, action: 'delete', summary: `Deleted custom role “${role.name}”` });
  await b.commit();
}

/** Select value ↔ role fields: built-in role key, or "custom:<roleId>" */
export const roleValueOf = (u) => (u?.role === CUSTOM_ROLE ? `custom:${u.roleId}` : u?.role);

export function roleFieldsFor(value, roles) {
  if (value?.startsWith('custom:')) {
    const r = roles.find((x) => x.id === value.slice(7));
    if (!r) throw new Error('Role not found');
    return { role: CUSTOM_ROLE, roleId: r.id, roleName: r.name, permissions: r.permissions || [] };
  }
  return { role: value, roleId: null, roleName: null, permissions: [] };
}

export async function assignRole(target, value, roles, user) {
  const patch = roleFieldsFor(value, roles);
  const b = writeBatch(db);
  b.update(docRef(COL.users, target.id), { ...patch, ...updatedStamp(user) });
  writeAudit(b, user, {
    collection: COL.users, docId: target.id, ref: target.email || target.id, action: 'update',
    summary: `Role changed for ${target.email || target.name}`,
    changes: [{ field: 'role', old: target.roleName || target.role || null, new: patch.roleName || patch.role }],
  });
  await b.commit();
}

'use client';

// Browser side: every change is sent to the server (src/server/rpc.js), which checks
// the permission and runs the business logic inside a PostgreSQL transaction.
import { rpc, rpcRead } from '@/lib/api';
import { CUSTOM_ROLE } from '@/lib/permissions';

export const saveRole = ({ id, name, description, permissions }) => rpc('roles.save', { id, name, description, permissions });
export const deleteRole = (role) => rpc('roles.delete', role.id);
export const assignRole = (target, value) => rpc('roles.assign', target.id, value);
/** Select value ↔ role fields: built-in role key, or "custom:<roleId>" */
export const roleValueOf = (u) => (u?.role === CUSTOM_ROLE ? `custom:${u.roleId}` : u?.role);
export { rpcRead };

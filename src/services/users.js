'use client';

// Browser side: every change is sent to the server (src/server/rpc.js), which checks
// the permission and runs the business logic inside a PostgreSQL transaction.
import { rpc, rpcRead } from '@/lib/api';

/** Creates a staff login + profile (Super Admin only) */
export const createStaffUser = (data) => rpc('users.create', data);
/** Enable/disable login and/or reset password */
export const updateStaffLogin = (data) => rpc('users.updateLogin', data);
export const updateUserProfile = (uid, patch) => rpc('users.updateProfile', uid, patch);
export const changeOwnPassword = (current, next) => rpc('users.changeOwnPassword', current, next);
export { rpcRead };

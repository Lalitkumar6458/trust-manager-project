'use client';

import { auth } from '@/lib/firebase';
import { COL } from '@/lib/constants';
import { docRef, writeBatch, db, updatedStamp, writeAudit } from './db';

async function api(method, body) {
  const token = await auth.currentUser?.getIdToken();
  // never spin forever: give up after 60 s with a clear message
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  let res;
  try {
    res = await fetch('/api/admin/users', {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The server did not respond in 60 seconds. Check the terminal running “npm run dev” for the error (usually Firebase Admin credentials in .env.local).');
    throw new Error('Could not reach the server. Is “npm run dev” still running?');
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

/** Creates a Firebase Auth login + users/{uid} profile (server side, Super Admin only) */
export const createStaffUser = (data) => api('POST', data);

/** Enable/disable login and/or reset password (server side) */
export const updateStaffLogin = (data) => api('PATCH', data);

export async function updateUserProfile(uid, patch, user, old = {}) {
  const b = writeBatch(db);
  b.update(docRef(COL.users, uid), { ...patch, ...updatedStamp(user) });
  writeAudit(b, user, {
    collection: COL.users, docId: uid, ref: old.email || uid, action: 'update',
    changes: Object.keys(patch).map((k) => ({ field: k, old: old[k] ?? null, new: patch[k] })),
  });
  await b.commit();
}

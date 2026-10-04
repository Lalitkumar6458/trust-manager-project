'use client';

import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit, serverTimestamp,
  runTransaction, writeBatch, increment, Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COL } from '@/lib/constants';
import { padNo } from '@/lib/format';

export { db, collection, doc, getDoc, getDocs, query, where, orderBy, limit, serverTimestamp, runTransaction, writeBatch, increment, Timestamp };

export const colRef = (name) => collection(db, name);
export const docRef = (name, id) => doc(db, name, id);
export const newId = (name) => doc(collection(db, name)).id;

export const snapToList = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export async function fetchAll(name, ...constraints) {
  const snap = await getDocs(constraints.length ? query(colRef(name), ...constraints) : colRef(name));
  return snapToList(snap);
}

export async function fetchOne(name, id) {
  const s = await getDoc(docRef(name, id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

/** Actor metadata stamped on every record */
export const actor = (user) => ({ uid: user?.uid || null, name: user?.name || user?.email || 'Unknown', role: user?.role || null });

export const createdStamp = (user) => ({
  createdBy: user?.uid || null,
  createdByName: user?.name || '',
  createdAt: serverTimestamp(),
  updatedBy: user?.uid || null,
  updatedByName: user?.name || '',
  updatedAt: serverTimestamp(),
});

export const updatedStamp = (user) => ({
  updatedBy: user?.uid || null,
  updatedByName: user?.name || '',
  updatedAt: serverTimestamp(),
});

// ------------------------------------------------------------------
// Audit trail
// ------------------------------------------------------------------
const IGNORE_DIFF = new Set(['updatedAt', 'updatedBy', 'updatedByName', 'createdAt', 'searchKeywords', 'workflow']);

const norm = (v) => {
  if (v === undefined || v === '') return null;
  if (v?.toDate) return v.toDate().toISOString();
  return v;
};

/** Field-level differences between two plain objects */
export function diffObjects(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changes = [];
  keys.forEach((k) => {
    if (IGNORE_DIFF.has(k)) return;
    const a = norm(before?.[k]);
    const b = norm(after?.[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ field: k, old: a === undefined ? null : a, new: b === undefined ? null : b });
    }
  });
  return changes;
}

/**
 * Writes an audit log entry using a transaction or batch (`writer.set`).
 * Audit logs are append-only (enforced in firestore.rules).
 */
export function writeAudit(writer, user, { collection: coll, docId, action, ref, changes = [], reason = '', summary = '' }) {
  const logRef = doc(colRef(COL.auditLogs));
  writer.set(logRef, {
    collection: coll,
    docId: docId || null,
    ref: ref || null, // human readable reference e.g. receipt number
    action,
    summary,
    changes: JSON.parse(JSON.stringify(changes ?? [])),
    reason: reason || '',
    userId: user?.uid || null,
    userName: user?.name || user?.email || '',
    role: (user?.role === 'custom' ? user?.roleName : user?.role) || null,
    device: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 180) : '',
    at: serverTimestamp(),
  });
  return logRef.id;
}

// ------------------------------------------------------------------
// Atomic sequential numbering (receipt / voucher / donor code …)
// Must be called inside runTransaction BEFORE any write.
// ------------------------------------------------------------------
export async function readCounter(tx, key) {
  const ref = docRef(COL.counters, key);
  const snap = await tx.get(ref);
  const next = snap.exists() ? (snap.data().next || 1) : 1;
  return { ref, next };
}

export function commitCounter(tx, counter) {
  tx.set(counter.ref, { next: counter.next + 1, updatedAt: serverTimestamp() }, { merge: true });
}

export const formatSeq = (prefix, fyId, n) => (fyId ? `${prefix}/${fyId}/${padNo(n)}` : `${prefix}-${padNo(n)}`);

// ------------------------------------------------------------------
// Notifications (in-app bell)
// ------------------------------------------------------------------
/** Permission that makes a custom-role user receive a notification type */
export const NOTIFY_PERM = {
  donation_new: 'donations.verify',
  donation_verified: 'donations.approve',
  expense_pending: 'expenses.approve',
  large_expense: 'expenses.approve',
  expense_approved: 'expenses.pay',
  adjustment: 'ledger.view',
  month_closed: 'closing.view',
  fy_closed: 'fy.view',
  audit_pending: 'audit.view',
};

export function writeNotification(writer, { type, title, message, link, roles, perm }) {
  const ref = doc(colRef(COL.notifications));
  const p = perm || NOTIFY_PERM[type];
  writer.set(ref, {
    type,
    title,
    message: message || '',
    link: link || null,
    // built-in roles + "perm:<key>" so custom roles holding that permission see it too
    roles: [...(roles || ['superAdmin', 'accountant']), ...(p ? [`perm:${p}`] : [])],
    readBy: [],
    createdAt: serverTimestamp(),
  });
}

/** Commit many set operations in chunks of 450 (Firestore batch limit is 500) */
export async function chunkedBatch(ops) {
  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db);
    ops.slice(i, i + 450).forEach((fn) => fn(batch));
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
  }
}

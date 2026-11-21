import 'server-only';
import {
  db, runTransaction, docRef, colRef, doc, createdStamp, updatedStamp, writeAudit, diffObjects, readCounter, commitCounter,
} from './db';
import { buildKeywords } from '@/lib/keywords';
import { padNo } from '@/lib/format';

// ------------------------------------------------------------------
// Small helper used by the newer modules (cash count, pledges, bookings,
// seva, inventory, assets, staff …): create / update one record with
// created / updated stamps, search keywords, an optional running number
// and an audit-log entry – all in one SQL transaction.
// ------------------------------------------------------------------

export const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/** trims strings, drops undefined, keeps only `fields` */
export function pickFields(input = {}, fields = []) {
  const out = {};
  fields.forEach((f) => {
    const v = input[f];
    if (v === undefined) return;
    out[f] = typeof v === 'string' ? v.trim() : v;
  });
  return out;
}

/**
 * @param coll       collection name
 * @param id         null → create
 * @param data       fields to store (already validated)
 * @param user
 * @param opts.number { key: 'BK', prefix: 'BK/' , field: 'bookingNo', width: 5 } → running number on create
 * @param opts.keywords { names: [...], exact: [...] }
 * @param opts.ref   readable reference for the audit log
 * @param opts.extra async (tx, before, next) => void  – more writes in the same transaction
 * @returns id
 */
export async function saveRecord(coll, id, data, user, opts = {}) {
  return runTransaction(db, async (tx) => {
    const ref = id ? docRef(coll, id) : doc(colRef(coll));
    let before = null;
    if (id) {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw bad('Record not found');
      before = snap.data();
    }
    let counter = null;
    if (!id && opts.number) counter = await readCounter(tx, opts.number.key);
    const next = { ...(before || {}), ...data };
    if (counter) next[opts.number.field] = `${opts.number.prefix || ''}${padNo(counter.next, opts.number.width || 5)}`;
    if (opts.keywords) next.searchKeywords = buildKeywords(typeof opts.keywords === 'function' ? opts.keywords(next) : opts.keywords);
    if (opts.validate) await opts.validate(tx, next, before);
    if (opts.extra) await opts.extra(tx, before, next, ref.id);
    if (counter) commitCounter(tx, counter);
    if (id) tx.update(ref, { ...data, ...(next.searchKeywords ? { searchKeywords: next.searchKeywords } : {}), ...updatedStamp(user) });
    else tx.set(ref, { ...next, ...createdStamp(user) });
    writeAudit(tx, user, {
      collection: coll,
      docId: ref.id,
      action: id ? 'update' : 'create',
      ref: (typeof opts.ref === 'function' ? opts.ref(next) : opts.ref) || next[opts.number?.field] || next.name || ref.id,
      changes: id ? diffObjects(before, next) : [],
      summary: opts.summary ? opts.summary(next, before) : '',
    });
    return ref.id;
  });
}

/** money: 2 decimals, > 0 unless allowZero */
export function amountOf(v, { allowZero = false, label = 'Amount' } = {}) {
  const n = Math.round(Number(v) * 100) / 100;
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw bad(`${label} is not valid`);
  if (n > 1e10) throw bad(`${label} is too large`);
  return n;
}

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
export function dateOf(s, label = 'Date') {
  if (!isDate(s)) throw bad(`${label} is not valid`);
  return s;
}

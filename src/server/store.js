import 'server-only';
import crypto from 'node:crypto';
import { pool, sql } from './pg';
import {
  tableOf, selectSql, countSql, sumSql,
} from './sql';
import { where, orderBy, limit, offset, Timestamp } from '@/lib/q';

// ------------------------------------------------------------------
// Small document-store API on top of PostgreSQL.
// The business logic (donations, ledger, closing …) was written against a
// document API (get / set / update inside transactions); this module gives it
// the same calls, backed by real SQL transactions with row locks:
//   • tx.get(ref)  → SELECT … FOR UPDATE (the row stays locked until COMMIT)
//   • writes are buffered and applied at commit, in order
//   • conflicts / deadlocks / duplicate inserts → the whole transaction is retried
// ------------------------------------------------------------------

export { where, orderBy, limit, offset, Timestamp };
export const db = Object.freeze({ kind: 'postgres' });

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function newId() {
  const b = crypto.randomBytes(20);
  let s = '';
  for (let i = 0; i < 20; i += 1) s += ID_CHARS[b[i] % ID_CHARS.length];
  return s;
}

// ---------------- references ----------------
export const collection = (_db, name) => ({ kind: 'col', coll: name });
export const colRef = (name) => ({ kind: 'col', coll: name });
const mkRef = (coll, id) => ({ kind: 'doc', coll, id: String(id), path: `${coll}/${id}` });
/** doc(colRef(x)) → new id · doc(db, coll, id) · doc(colRef(x), id) */
export function doc(a, b, c) {
  if (a?.kind === 'col') return mkRef(a.coll, b ?? newId());
  return mkRef(b, c ?? newId());
}
export const docRef = (coll, id) => mkRef(coll, id);
export const query = (col, ...constraints) => ({ kind: 'query', coll: col.coll, constraints: [...(col.constraints || []), ...constraints] });

// ---------------- field values ----------------
const S = '__tmSentinel';
export const increment = (n) => ({ [S]: 'inc', n: Number(n) || 0 });
export const serverTimestamp = () => ({ [S]: 'ts' });
export const arrayUnion = (...v) => ({ [S]: 'union', v });
export const arrayRemove = (...v) => ({ [S]: 'remove', v });
export const deleteField = () => ({ [S]: 'delete' });
export const sum = (field) => ({ agg: 'sum', field });
export const count = () => ({ agg: 'count' });

const BAD_KEY = new Set(['__proto__', 'constructor', 'prototype']);
const badKey = (k) => BAD_KEY.has(k);
const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !v[S];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const addNum = (a, b) => Math.round(((Number(a) || 0) + b) * 1e6) / 1e6;

function resolve(v, old, now) {
  if (v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString();
  if (v && v[S]) {
    switch (v[S]) {
      case 'inc': return addNum(typeof old === 'number' ? old : 0, v.n);
      case 'ts': return now;
      case 'union': { const a = Array.isArray(old) ? [...old] : []; v.v.forEach((x) => { if (!a.some((y) => same(x, y))) a.push(x); }); return a; }
      case 'remove': return (Array.isArray(old) ? old : []).filter((y) => !v.v.some((x) => same(x, y)));
      case 'delete': return undefined;
      default: return undefined;
    }
  }
  if (Array.isArray(v)) return v.map((x) => resolve(x, undefined, now)).filter((x) => x !== undefined);
  if (isPlain(v)) {
    const out = {};
    Object.entries(v).forEach(([k, x]) => { if (badKey(k)) return; const r = resolve(x, undefined, now); if (r !== undefined) out[k] = r; });
    return out;
  }
  return v;
}

/** set(…, { merge: true }) – nested maps are merged, other values replaced */
function mergeInto(base, patch, now) {
  const out = isPlain(base) ? { ...base } : {};
  Object.entries(patch).forEach(([k, v]) => {
    if (v === undefined || badKey(k)) return;
    if (v && v[S] === 'delete') { delete out[k]; return; }
    if (isPlain(v)) { out[k] = mergeInto(out[k], v, now); return; }
    out[k] = resolve(v, out[k], now);
  });
  return out;
}

/** update(…, { 'a.b.c': v }) – keys are field paths */
function applyUpdate(base, patch, now) {
  const out = structuredClone(base || {});
  Object.entries(patch).forEach(([path, v]) => {
    if (v === undefined) return;
    const segs = path.split('.');
    if (segs.some(badKey)) throw Object.assign(new Error('Bad field name'), { status: 400 });
    let o = out;
    for (let i = 0; i < segs.length - 1; i += 1) {
      if (!isPlain(o[segs[i]])) o[segs[i]] = {};
      o = o[segs[i]];
    }
    const last = segs[segs.length - 1];
    const r = resolve(v, o[last], now);
    if (r === undefined) delete o[last]; else o[last] = r;
  });
  return out;
}

const snap = (ref, data) => ({
  id: ref.id,
  ref,
  exists: () => data !== null && data !== undefined,
  data: () => (data == null ? undefined : structuredClone(data)),
  get: (f) => (data == null ? undefined : f.split('.').reduce((o, k) => o?.[k], data)),
});

// ---------------- transactions ----------------
class Tx {
  constructor(client) {
    this.client = client;
    this.cache = new Map(); // path → { ref, data, existed, dirty }
    this.ops = [];
    this.now = new Date().toISOString();
  }

  async load(ref) {
    let e = this.cache.get(ref.path);
    if (e) return e;
    const r = await this.client.query(`SELECT data FROM ${tableOf(ref.coll)} WHERE id = $1 FOR UPDATE`, [ref.id]);
    e = { ref, data: r.rows[0] ? r.rows[0].data : null, existed: !!r.rows[0], dirty: false };
    this.cache.set(ref.path, e);
    return e;
  }

  async get(ref) {
    const e = await this.load(ref);
    return snap(ref, e.data);
  }

  /** Transaction-scoped advisory lock (shared: many postings together; exclusive: closing a period) */
  async lock(key, shared = false) {
    await this.client.query(`SELECT ${shared ? 'pg_advisory_xact_lock_shared' : 'pg_advisory_xact_lock'}(hashtext($1))`, [key]);
  }

  set(ref, data, opts = {}) { this.ops.push({ k: 'set', ref, data, merge: !!opts.merge }); return this; }

  update(ref, patch) { this.ops.push({ k: 'update', ref, patch }); return this; }

  delete(ref) { this.ops.push({ k: 'delete', ref }); return this; }

  async flush() {
    for (const op of this.ops) {
      // eslint-disable-next-line no-await-in-loop
      const e = await this.load(op.ref);
      if (op.k === 'set') e.data = op.merge ? mergeInto(e.data, op.data, this.now) : resolve(op.data, undefined, this.now);
      else if (op.k === 'update') {
        if (e.data == null) throw new Error(`No document to update: ${op.ref.path}`);
        e.data = applyUpdate(e.data, op.patch, this.now);
      } else e.data = null;
      e.dirty = true;
    }
    for (const e of this.cache.values()) {
      if (!e.dirty) continue;
      const t = tableOf(e.ref.coll);
      if (e.data == null) {
        // eslint-disable-next-line no-await-in-loop
        if (e.existed) await this.client.query(`DELETE FROM ${t} WHERE id = $1`, [e.ref.id]);
      } else if (e.existed) {
        // eslint-disable-next-line no-await-in-loop
        await this.client.query(`UPDATE ${t} SET data = $2 WHERE id = $1`, [e.ref.id, e.data]);
      } else {
        // plain INSERT: if another transaction created the same row meanwhile, this fails and we retry
        // eslint-disable-next-line no-await-in-loop
        await this.client.query(`INSERT INTO ${t} (id, data) VALUES ($1, $2)`, [e.ref.id, e.data]);
      }
    }
    this.ops = [];
  }
}

// serialization failure, deadlock, and a duplicate PRIMARY KEY (two transactions created the same row) are retried
const retryable = (e) => e.code === '40001' || e.code === '40P01' || (e.code === '23505' && /_pkey$/.test(e.constraint || ''));

/** runTransaction(db, async (tx) => { … }) – retried automatically on conflicts */
export async function runTransaction(_db, fn, { retries = 5 } = {}) {
  let attempt = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const client = await (await pool()).connect();
    let broken = null;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '10s'");
      const tx = new Tx(client);
      const result = await fn(tx);
      await tx.flush();
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch((re) => { broken = re; });
      if (!(retryable(e) && attempt < retries)) throw e;
    } finally {
      client.release(broken || undefined); // a dead connection is discarded, not returned to the pool
    }
    attempt += 1;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 20 * attempt + Math.random() * 40); });
  }
}

/** writeBatch(db) – the writes are applied atomically in one SQL transaction */
export function writeBatch() {
  const ops = [];
  const b = {
    set(ref, data, opts) { ops.push(['set', ref, data, opts]); return b; },
    update(ref, patch) { ops.push(['update', ref, patch]); return b; },
    delete(ref) { ops.push(['delete', ref]); return b; },
    commit: () => runTransaction(db, async (tx) => {
      ops.forEach(([k, ...a]) => tx[k](...a));
    }),
  };
  return b;
}

// ---------------- plain reads / writes ----------------
export async function getDoc(ref) {
  const r = await sql(`SELECT data FROM ${tableOf(ref.coll)} WHERE id = $1`, [ref.id]);
  return snap(ref, r.rows[0] ? r.rows[0].data : null);
}

export async function getDocs(q) {
  const { coll, constraints = [] } = q.kind === 'col' ? { coll: q.coll } : q;
  const s = selectSql(coll, constraints);
  const r = await sql(s.text, s.params);
  const docs = r.rows.map((row) => snap(mkRef(coll, row.id), row.data));
  return { docs, size: docs.length, empty: !docs.length };
}

export const setDoc = (ref, data, opts) => writeBatch().set(ref, data, opts).commit();
export const updateDoc = (ref, patch) => writeBatch().update(ref, patch).commit();
export const deleteDoc = (ref) => writeBatch().delete(ref).commit();
export async function addDoc(col, data) {
  const ref = doc(col);
  await setDoc(ref, data);
  return ref;
}

export async function getCountFromServer(q) {
  const s = countSql(q.coll, q.constraints || []);
  const r = await sql(s.text, s.params);
  const n = r.rows[0].n;
  return { data: () => ({ count: n }) };
}

export async function getAggregateFromServer(q, spec) {
  const keys = Object.keys(spec);
  const fields = keys.map((k) => spec[k].field);
  const s = sumSql(q.coll, q.constraints || [], fields);
  const r = await sql(s.text, s.params);
  const out = {};
  keys.forEach((k, i) => { out[k] = Number(r.rows[0][`s${i}`]) || 0; });
  return { data: () => out };
}

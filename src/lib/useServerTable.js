'use client';

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { query, onDataChanged } from '@/lib/api';
import { orderBy as qOrderBy, limit as qLimit, offset as qOffset } from '@/lib/q';

export const PAGE_SIZE = 100;

/**
 * Server-side table: EVERYTHING happens in PostgreSQL.
 *  • `constraints` (where …) are the filters – built by the page from its filter bar
 *  • results are sorted on the server (`order` = [field, 'asc'|'desc'] or a list of them)
 *  • only ONE page of `pageSize` rows is downloaded at a time (First / Previous / Next / Last)
 *  • `total` = server-side count of all matching rows
 *  • `sumOf()` = server-side sums
 *  • `fetchAll()` = every matching row – used only by Export / Print
 * The page refreshes after every change made in this browser and every 30 s.
 * `key` must change whenever the constraints change (it resets to page 1).
 */
export function useServerTable(coll, constraints, { order = ['date', 'desc'], pageSize = PAGE_SIZE, key = '', enabled = true } = {}) {
  // order: ['date', 'desc']  or  [['date', 'desc'], ['createdAt', 'desc']]
  const orders = Array.isArray(order[0]) ? order : [order];
  const qKey = `${coll}|${key}|${JSON.stringify(orders)}`;
  const [nav, setNav] = useState({ qKey, page: 0 });
  const page = nav.qKey === qKey ? nav.page : 0;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(null);
  const [tick, setTick] = useState(0);
  const consRef = useRef(constraints);
  consRef.current = constraints;

  const ordered = useCallback(
    (...extra) => [...consRef.current, ...extra, ...orders.map(([f, d]) => qOrderBy(f, d))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qKey],
  );

  useEffect(() => (enabled ? onDataChanged(() => setTick((t) => t + 1)) : undefined), [enabled]);

  useEffect(() => {
    if (!enabled) { setRows([]); setTotal(0); setLoading(false); return undefined; }
    let alive = true;
    if (nav.qKey !== qKey) setTotal(null);
    setLoading((l) => l || tick === 0);
    Promise.all([
      query({ coll, cons: [...ordered(), qLimit(pageSize), qOffset(page * pageSize)], mode: 'list' }),
      query({ coll, cons: consRef.current, mode: 'count' }),
    ]).then(([list, cnt]) => {
      if (!alive) return;
      setRows(list.rows);
      setTotal(cnt.count);
      setError(null);
      // the last page may have become empty (rows voided / filtered) → step back
      if (!list.rows.length && page > 0 && cnt.count <= page * pageSize) setNav({ qKey, page: Math.max(0, Math.ceil(cnt.count / pageSize) - 1) });
    }).catch((e) => {
      if (!alive) return;
      // eslint-disable-next-line no-console
      if (e?.status !== 403) console.error(coll, e);
      setError(e);
      setRows([]);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, qKey, page, pageSize, tick]);

  const pageCount = total === null ? null : Math.max(1, Math.ceil(total / pageSize));
  const hasPrev = page > 0;
  const hasNext = pageCount === null ? rows.length === pageSize : page < pageCount - 1;
  const go = (p) => { setLoading(true); setNav({ qKey, page: p }); };

  /** every matching row – for Export / Print only */
  const fetchAll = useCallback(async () => (await query({ coll, cons: ordered(), mode: 'list' })).rows, [coll, ordered]);

  /** server-side sums over the matching rows: sumOf(['amount'], [where(…)]) → { amount } */
  const sumOf = useCallback(async (fields, extra = []) => (await query({ coll, cons: [...consRef.current, ...extra], mode: 'sum', fields })).sums, [coll]);

  return useMemo(() => ({
    rows, loading, error, total, page, pageCount, pageSize, hasPrev, hasNext, fetchAll, sumOf, order, tick,
    next: () => { if (hasNext) go(page + 1); },
    prev: () => { if (hasPrev) go(page - 1); },
    first: () => go(0),
    last: () => { if (pageCount) go(pageCount - 1); },
    from: total === 0 || !rows.length ? 0 : page * pageSize + 1,
    to: page * pageSize + rows.length,
  }), [rows, loading, error, total, page, pageCount, pageSize, hasPrev, hasNext, fetchAll, sumOf, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Debounced value – search boxes query the server only after typing pauses */
export function useDebounced(value, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => { const h = setTimeout(() => setV(value), ms); return () => clearTimeout(h); }, [value, ms]);
  return v;
}

/** Re-runs `fn` (async) whenever deps change; returns its latest result */
export function useAsyncValue(fn, deps, initial = null) {
  const [v, setV] = useState(initial);
  useEffect(() => {
    let alive = true;
    Promise.resolve(fn()).then((r) => { if (alive) setV(r); }).catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
      if (alive) setV(initial);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

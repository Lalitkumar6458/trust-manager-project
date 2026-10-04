'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  where, orderBy, limit, getCountFromServer, query, collection,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useLiveQuery } from '@/lib/hooks';
import { fetchAll } from '@/services/db';
import { normalizeSearch } from '@/lib/keywords';

export const PAGE_SIZE = 100;

/**
 * Server-side list for big collections (donations / expenses / ledger).
 *
 *  • Filters run ON THE SERVER over the whole financial year (not only the rows on screen):
 *      financial year  +  ONE "indexed" filter (status tab, account, category, fund, mode …)
 *      +  optional date range, newest first.
 *    Any further filters are applied to that result; when 2+ filters are combined (or an amount
 *    range is used) every matching row is loaded automatically, so nothing is missed.
 *  • 100 rows at a time ("Load more" / "Load all"); total count comes from the server.
 *  • Text search (3+ characters) searches the whole year on the server (receipt / voucher no.,
 *    name, mobile, PAN, UTR …).
 *  • fetchAllMatching() returns EVERY matching row – used by Export, so exports are complete.
 *
 * @param coll       collection name
 * @param fy         selected financial year
 * @param server     ordered list of candidate server filters: [{ field, op, value }] – inactive ones have value null/undefined
 * @param from,to    optional date range (YYYY-MM-DD)
 * @param text       search text
 * @param clientFilter (rows) => rows   filters that always run on the loaded rows (amount range, text in loaded rows …)
 * @param forceAll   load every match (e.g. amount range set)
 */
export function useServerList(coll, fy, { server = [], from, to, text, clientFilter = (r) => r, forceAll = false } = {}) {
  const fyId = fy?.id || '-';
  const active = server.filter((f) => f.value !== undefined && f.value !== null && f.value !== '');
  const primary = active[0] || null;
  const extra = active.slice(1);
  const term = normalizeSearch(text || '');
  const searching = term.length >= 3;
  const [n, setN] = useState(PAGE_SIZE);
  const [all, setAll] = useState(false);
  const loadAll = all || forceAll || extra.length > 0;

  const baseCons = useMemo(() => {
    const c = [where('financialYearId', '==', fyId)];
    if (primary) c.push(where(primary.field, primary.op, primary.value));
    if (from) c.push(where('date', '>=', from));
    if (to) c.push(where('date', '<=', to));
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fyId, primary?.field, primary?.op, JSON.stringify(primary?.value), from, to]);

  const key = JSON.stringify([fyId, primary, from, to, loadAll ? 'all' : n, searching ? term : '']);
  const cons = searching
    ? [where('searchKeywords', 'array-contains', term), limit(200)]
    : [...baseCons, orderBy('date', 'desc'), ...(loadAll ? [] : [limit(n)])];
  const { data, loading } = useLiveQuery(fy ? coll : null, cons, [key]);

  // reset paging whenever the server query changes
  const qKey = JSON.stringify([fyId, primary, from, to]);
  useEffect(() => { setN(PAGE_SIZE); setAll(false); }, [qKey]);

  // server-side count of everything that matches (cheap: 1 read per 1000 index entries)
  const [total, setTotal] = useState(null);
  useEffect(() => {
    if (!fy) return;
    let alive = true;
    getCountFromServer(query(collection(db, coll), ...baseCons))
      .then((r) => { if (alive) setTotal(r.data().count); })
      .catch(() => { if (alive) setTotal(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coll, qKey]);

  const applyExtra = useCallback((rows) => rows.filter((r) => extra.every((f) => {
    const v = r[f.field];
    if (f.op === 'array-contains') return Array.isArray(v) && v.includes(f.value);
    return v === f.value;
  })), [JSON.stringify(extra)]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    let list = data;
    if (searching) {
      // search hits: same year + same filters + date range
      list = list.filter((r) => r.financialYearId === fy?.id
        && (!primary || (primary.op === 'array-contains' ? (r[primary.field] || []).includes(primary.value) : r[primary.field] === primary.value))
        && (!from || r.date >= from) && (!to || r.date <= to));
    }
    return clientFilter(applyExtra(list));
  }, [data, searching, fy?.id, primary, from, to, applyExtra, clientFilter]);

  const loadedAll = searching || loadAll || (total !== null && data.length >= total);

  /** Every row matching the current filters (whole year / range) – for Export & Print */
  const fetchAllMatching = useCallback(async () => {
    if (searching || loadedAll) return rows;
    const res = await fetchAll(coll, ...baseCons, orderBy('date', 'desc'));
    return clientFilter(applyExtra(res));
  }, [searching, loadedAll, rows, coll, baseCons, applyExtra, clientFilter]);

  return {
    rows,
    loading,
    total: searching ? rows.length : total,
    loadedAll,
    searching,
    hasMore: !loadedAll,
    loadMore: () => setN((x) => x + PAGE_SIZE),
    loadAll: () => setAll(true),
    fetchAllMatching,
  };
}

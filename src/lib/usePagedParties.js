'use client';

import { useEffect, useState } from 'react';
import {
  where, orderBy, limit, getCountFromServer, getAggregateFromServer, query, collection, sum as fsSum,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useLiveQuery } from '@/lib/hooks';
import { fetchAll } from '@/services/db';
import { normalizeSearch } from '@/lib/keywords';

export const PAGE = 100;

/**
 * Donors / beneficiaries list that never downloads the whole collection:
 *  - biggest first (totalAmount desc), PAGE rows at a time ("Load more")
 *  - search (2+ characters) runs on the server over ALL records (name prefix, mobile, PAN, code)
 *  - record count and lifetime total come from server-side aggregation
 */
export function usePagedParties(coll, { text, equals, inField, inValues, orderField = 'totalAmount', positiveField } = {}) {
  const [n, setN] = useState(PAGE);
  const term = normalizeSearch(text || '');
  const searching = term.length >= 2;
  let cons;
  if (searching) cons = [where('searchKeywords', 'array-contains', term), limit(100)];
  else if (positiveField) cons = [where(positiveField, '>', 0), orderBy(positiveField, 'desc'), limit(n)];
  else {
    cons = [];
    if (equals) cons.push(where(equals[0], '==', equals[1]));
    if (inField && inValues?.length) cons.push(where(inField, 'in', inValues));
    cons.push(orderBy(orderField, 'desc'), limit(n));
  }
  const key = JSON.stringify([term, equals, inField, inValues, positiveField, searching ? 0 : n]);
  const { data, loading } = useLiveQuery(coll, cons, [key]);

  const [agg, setAgg] = useState({});
  const aggKey = JSON.stringify([equals, inField, inValues]);
  useEffect(() => {
    const cs = [];
    if (equals) cs.push(where(equals[0], '==', equals[1]));
    if (inField && inValues?.length) cs.push(where(inField, 'in', inValues));
    const q = query(collection(db, coll), ...cs);
    Promise.all([getCountFromServer(q), getAggregateFromServer(q, { total: fsSum('totalAmount') })])
      .then(([c, s]) => setAgg({ count: c.data().count, total: s.data().total || 0 }))
      .catch(() => setAgg({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coll, aggKey]);

  useEffect(() => { setN(PAGE); }, [aggKey, positiveField]);
  const hasMore = !searching && data.length >= n;
  /** every record matching the filters (for Export) */
  const fetchAllMatching = async () => {
    if (searching || !hasMore) return data;
    return fetchAll(coll, ...cons.slice(0, -1)); // same query without the limit
  };
  return { data, loading, hasMore, loadMore: () => setN((x) => x + PAGE), searching, count: agg.count, total: agg.total, fetchAllMatching };
}

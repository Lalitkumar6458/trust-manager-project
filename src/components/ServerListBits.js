'use client';

import { useEffect, useState } from 'react';
import { Button, Space } from 'antd';
import { getCountFromServer, query, collection, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useLang } from '@/i18n/LangContext';

/** Number of entries per status for the whole year (server counts, refreshed when the list changes) */
export function useStatusCounts(coll, fy, statuses, refreshKey) {
  const [counts, setCounts] = useState({});
  useEffect(() => {
    if (!fy) return undefined;
    let alive = true;
    Promise.all(statuses.map((st) => getCountFromServer(query(collection(db, coll), where('financialYearId', '==', fy.id), where('status', '==', st)))
      .then((r) => [st, r.data().count]).catch(() => [st, undefined])))
      .then((pairs) => { if (alive) setCounts(Object.fromEntries(pairs)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coll, fy?.id, refreshKey, statuses.join(',')]);
  return counts;
}

/** "Showing 100 of 3,214 matching entries" line under the filters */
export function ListStatus({ list }) {
  const { t: tr } = useLang();
  let text;
  if (list.searching) text = tr('Search results from the whole year: {n}', { n: list.rows.length });
  else if (list.loadedAll) text = tr('All {n} matching entries are loaded – filters, totals and export cover everything.', { n: list.rows.length });
  else text = tr('Showing the newest {v0} of {v1} matching entries. Filters and search run on the server over the whole year; Export always includes all {v1}.', { v0: list.rows.length, v1: list.total ?? '…' });
  return <div className="muted" style={{ fontSize: 12, margin: '-4px 0 8px' }}>{text}</div>;
}

/** Table footer with Load more / Load all */
export function LoadMoreBar({ list }) {
  const { t: tr } = useLang();
  if (!list.hasMore) return null;
  return (
    <Space wrap>
      <span className="muted">{tr('{v0} of {v1} loaded', { v0: list.rows.length, v1: list.total ?? '…' })}</span>
      <Button size="small" onClick={list.loadMore} loading={list.loading}>{tr('Load more (100)')}</Button>
      <Button size="small" onClick={list.loadAll} loading={list.loading}>{tr('Load all')}</Button>
    </Space>
  );
}

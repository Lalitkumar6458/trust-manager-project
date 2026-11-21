'use client';

import { useEffect, useState } from 'react';
import { countDocs } from '@/lib/api';
import { where } from '@/lib/q';

/** Number of entries per status for the whole year (server counts, refreshed when the list changes) */
export function useStatusCounts(coll, fy, statuses, refreshKey) {
  const [counts, setCounts] = useState({});
  useEffect(() => {
    if (!fy) return undefined;
    let alive = true;
    Promise.all(statuses.map((st) => countDocs(coll, [where('financialYearId', '==', fy.id), where('status', '==', st)])
      .then((n) => [st, n]).catch(() => [st, undefined])))
      .then((pairs) => { if (alive) setCounts(Object.fromEntries(pairs)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coll, fy?.id, refreshKey, statuses.join(',')]);
  return counts;
}

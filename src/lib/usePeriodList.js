'use client';

import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { where, limit } from 'firebase/firestore';
import { useLiveQuery } from '@/lib/hooks';
import { fetchAll } from '@/services/db';
import { normalizeSearch } from '@/lib/keywords';

/** Default list window: previous month + this month (clamped to the financial year) */
export function defaultRange(fy) {
  if (!fy) return { from: null, to: null };
  const today = dayjs().format('YYYY-MM-DD');
  const end = fy.endDate < today ? fy.endDate : today;
  const startCand = dayjs(end).subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
  return { from: startCand < fy.startDate ? fy.startDate : startCand, to: end < fy.startDate ? fy.endDate : end };
}

/**
 * Loads only what the screen shows:
 *  - a status tab (e.g. "Submitted") → every entry of the year with that status
 *  - otherwise → entries of the chosen date range (no range = whole year)
 *  - a search text of 3+ characters also searches the WHOLE year on the server
 *    (receipt / voucher no., name, mobile, PAN, UTR …), so nothing is hidden by the range.
 */
export function usePeriodList(coll, fy, { from, to, status, text } = {}) {
  const fyId = fy?.id || '-';
  const cons = status
    ? [where('financialYearId', '==', fyId), where('status', '==', status)]
    : from && to
      ? [where('date', '>=', from), where('date', '<=', to)]
      : [where('financialYearId', '==', fyId)];
  const { data, loading } = useLiveQuery(fy ? coll : null, cons, [fyId, status || '', status ? '' : from || '', status ? '' : to || '']);

  const [found, setFound] = useState([]);
  const term = normalizeSearch(text || '');
  useEffect(() => {
    if (!fy || term.length < 3) { setFound([]); return undefined; }
    const h = setTimeout(() => {
      fetchAll(coll, where('searchKeywords', 'array-contains', term), limit(50))
        .then((r) => setFound(r.filter((x) => x.financialYearId === fy.id)))
        .catch(() => setFound([]));
    }, 350);
    return () => clearTimeout(h);
  }, [coll, fy?.id, term]);

  const rows = useMemo(() => {
    const inYear = data.filter((x) => !fy || x.financialYearId === undefined || x.financialYearId === fy.id);
    if (!found.length) return inYear;
    const ids = new Set(inYear.map((x) => x.id));
    return [...inYear, ...found.filter((x) => !ids.has(x.id))];
  }, [data, found, fy]);

  return { data: rows, loading, fullYear: !status && !(from && to), searched: found.length };
}

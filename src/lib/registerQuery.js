'use client';

import { where } from '@/lib/q';
import { normalizeSearch } from '@/lib/keywords';
import { useAsyncValue } from '@/lib/useServerTable';

/**
 * Every filter combines with every other one (PostgreSQL runs them all in one query),
 * so the filter bar has no "cannot combine" rules any more.
 */
export const DONATION_RULES = {};
export const EXPENSE_RULES = {};

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/**
 * Builds the server query for the donation / expense registers.
 * kind: 'donations' | 'expenses'
 * Returns { cons, order, key, mode } – mode = 'search' | 'filters'
 */
export function registerQuery(kind, fyId, status, f) {
  const cons = [where('financialYearId', '==', fyId || '-')];
  if (status && status !== 'all') cons.push(where('status', '==', status));
  const term = normalizeSearch(f.text || '');
  const min = num(f.min);
  const max = num(f.max);
  if (term.length >= 2) cons.push(where('searchKeywords', 'array-contains', term));
  if (min !== null) cons.push(where('amount', '>=', min));
  if (max !== null) cons.push(where('amount', '<=', max));
  if (f.accountId) cons.push(where('accountId', '==', f.accountId));
  if (f.mode) cons.push(where('paymentMode', '==', f.mode));
  if (kind === 'donations') {
    if (f.categoryId) cons.push(where('categoryIds', 'array-contains', f.categoryId));
    if (f.fundId) cons.push(where('fundIds', 'array-contains', f.fundId));
  } else {
    if (f.categoryId) cons.push(where('categoryId', '==', f.categoryId));
    if (f.fundId) cons.push(where('fundId', '==', f.fundId));
  }
  if (f.from) cons.push(where('date', '>=', f.from));
  if (f.to) cons.push(where('date', '<=', f.to));
  const key = JSON.stringify([kind, fyId, status, term.length >= 2 ? term : '', min, max, f.accountId, f.mode, f.categoryId, f.fundId, f.from, f.to]);
  return { cons, order: [['date', 'desc'], ['createdAt', 'desc']], key, mode: term.length >= 2 ? 'search' : 'filters' };
}

/** Total amount of ALL matching entries (server-side sum, void entries excluded) */
export function useMatchingTotal(table, status, key) {
  return useAsyncValue(async () => {
    const all = (await table.sumOf(['amount'])).amount || 0;
    if (status && status !== 'all') return status === 'void' ? 0 : all;
    const v = (await table.sumOf(['amount'], [where('status', '==', 'void')])).amount || 0;
    return Math.round((all - v) * 100) / 100;
  }, [key, table.rows], null);
}

'use client';

import { useMemo } from 'react';
import { COL } from '@/lib/constants';
import { round2 } from '@/lib/format';
import { fyOpeningFor } from '@/lib/ledgerMath';
import { sumDocs } from '@/lib/api';
import { where, before } from '@/lib/q';
import { useAsyncValue } from '@/lib/useServerTable';

/** Ledger lines are always listed by date, then entry time (then id) – the balance walk uses the same order */
export const BOOK_ORDER_FIELDS = ['date', 'createdAt'];
export const bookOrder = (dir) => BOOK_ORDER_FIELDS.map((f) => [f, dir]);

/** Net movement (credit − debit) of one account in a financial year, server-side */
async function netOf(fyId, accountId, extra) {
  const r = await sumDocs(COL.transactions, [where('financialYearId', '==', fyId), where('accountId', '==', accountId), ...extra], ['credit', 'debit']);
  return round2((r.credit || 0) - (r.debit || 0));
}

/** Balance of an account at the START of a date (FY opening + every entry before that date) */
export async function balanceBefore(fy, account, date) {
  const op = fyOpeningFor(fy, account);
  if (!date || date <= fy.startDate) return op;
  return round2(op + await netOf(fy.id, account.id, [where('date', '<', date)]));
}

/**
 * Running balance for ONE page of a server-paged ledger table (useServerTable on
 * `transactions` filtered by financialYearId + accountId, ordered by date).
 * The balance before the page = FY opening + server-side SUM of every older line of the
 * year (date, entry time, id – the same order the table uses); then the page is walked line by line.
 *  dir: 'asc' (oldest first – cash / bank book) | 'desc' (newest first – ledger)
 */
export function useBookBalance(table, { fy, account, enabled = true, dir = 'desc' }) {
  const anchor = dir === 'asc' ? table.rows[0] : table.rows[table.rows.length - 1];
  const beforeBal = useAsyncValue(async () => {
    if (!enabled || !fy || !account || !anchor) return null;
    return round2(fyOpeningFor(fy, account) + await netOf(fy.id, account.id, [before(BOOK_ORDER_FIELDS, anchor)]));
  }, [enabled, fy?.id, account?.id, anchor?.id, table.rows], null);

  return useMemo(() => {
    if (!enabled || beforeBal === null) return table.rows;
    const list = dir === 'asc' ? table.rows : [...table.rows].reverse();
    let bal = beforeBal;
    const out = list.map((t) => {
      bal = round2(bal + (t.credit || 0) - (t.debit || 0));
      return { ...t, balance: bal };
    });
    return dir === 'asc' ? out : out.reverse();
  }, [enabled, beforeBal, table.rows, dir]);
}

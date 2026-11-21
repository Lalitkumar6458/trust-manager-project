// Pure ledger helpers (no database) – shared by the browser and the server.
import { round2, todayStr } from '@/lib/format';
import { tsMillis } from '@/lib/q';

/** Analysis fields a reversal copies from the original line (fund, category, mode …) */
export const reversalFields = (t = {}) => ({
  fundId: t.fundId || null,
  fundIds: t.fundIds || (t.fundId ? [t.fundId] : []),
  categoryName: t.categoryName || '',
  paymentMode: t.paymentMode || '',
  utr: t.utr || '',
  chequeNo: t.chequeNo || '',
});

/** A reversal is dated today, but never before the entry it reverses */
export const reversalDate = (originalDate) => {
  const today = todayStr();
  return originalDate && originalDate > today ? originalDate : today;
};

/**
 * Sorts ledger lines and adds running balance.
 * @param {Array} txns  ledger lines (any order)
 * @param {number} opening  opening balance
 */
export function withRunningBalance(txns, opening = 0) {
  const sorted = [...txns].sort((a, b) => (a.date === b.date
    ? tsMillis(a.createdAt) - tsMillis(b.createdAt)
    : a.date.localeCompare(b.date)));
  let bal = round2(opening);
  return sorted.map((t) => {
    bal = round2(bal + (t.credit || 0) - (t.debit || 0));
    return { ...t, balance: bal };
  });
}

/** Opening balance of each account for a FY (from FY doc, fallback to account opening) */
export function fyOpeningFor(fy, account) {
  if (fy?.openingBalances && fy.openingBalances[account.id] !== undefined) return Number(fy.openingBalances[account.id]) || 0;
  // account created inside this FY
  if (account.openingFyId === fy?.id) return Number(account.openingBalance) || 0;
  return 0;
}

/**
 * Balance per account as on a date: FY opening + all lines in FY up to (and incl.) date.
 */
export function balancesAsOn({ fy, accounts, txns, uptoDate }) {
  const out = {};
  accounts.forEach((a) => { out[a.id] = fyOpeningFor(fy, a); });
  txns.forEach((t) => {
    if (uptoDate && t.date > uptoDate) return;
    if (out[t.accountId] === undefined) out[t.accountId] = 0;
    out[t.accountId] = round2(out[t.accountId] + (t.credit || 0) - (t.debit || 0));
  });
  return out;
}

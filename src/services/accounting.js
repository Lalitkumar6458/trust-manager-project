// Pure accounting helpers (no Firestore) – used by dashboard, reports and closings.
import dayjs from 'dayjs';
import { round2, fyMonths, fyRange } from '@/lib/format';
import { fyOpeningFor } from './ledger';

/** Classifies a ledger line. Reversals are classified by the type they reverse. */
export function classOf(t) {
  const type = t.type === 'reversal' ? t.originalType : t.type;
  switch (type) {
    case 'donation': return 'donation';
    case 'expense': return 'expense';
    case 'interest':
    case 'other_income': return 'otherIncome';
    case 'bank_charges': return 'bankCharges';
    case 'adjustment': return 'adjustment';
    case 'transfer':
    case 'cash_deposit':
    case 'cash_withdrawal': return 'internal';
    default: return 'other';
  }
}

export const net = (t) => round2((t.credit || 0) - (t.debit || 0));

/**
 * Summary of ledger movements in [from, to] for given accounts.
 * Opening = FY opening + movements before `from`.
 */
export function periodSummary({ fy, accounts, txns, from, to }) {
  const opening = {};
  const closing = {};
  const inflow = {};
  const outflow = {};
  accounts.forEach((a) => {
    opening[a.id] = fyOpeningFor(fy, a);
    inflow[a.id] = 0;
    outflow[a.id] = 0;
  });
  const totals = { donation: 0, expense: 0, otherIncome: 0, bankCharges: 0, adjustment: 0, internal: 0, other: 0 };
  txns.forEach((t) => {
    if (opening[t.accountId] === undefined) {
      opening[t.accountId] = 0; inflow[t.accountId] = 0; outflow[t.accountId] = 0;
    }
    if (from && t.date < from) {
      opening[t.accountId] = round2(opening[t.accountId] + net(t));
      return;
    }
    if (to && t.date > to) return;
    inflow[t.accountId] = round2(inflow[t.accountId] + (t.credit || 0));
    outflow[t.accountId] = round2(outflow[t.accountId] + (t.debit || 0));
    const c = classOf(t);
    if (c === 'expense' || c === 'bankCharges') totals[c] = round2(totals[c] - net(t));
    else totals[c] = round2(totals[c] + net(t));
  });
  Object.keys(opening).forEach((id) => { closing[id] = round2(opening[id] + inflow[id] - outflow[id]); });
  const byType = (type) => accounts.filter((a) => a.type === type).map((a) => a.id);
  const total = (map, ids) => round2(ids.reduce((s, id) => s + (map[id] || 0), 0));
  const bankIds = byType('bank');
  const cashIds = byType('cash');
  const allIds = Object.keys(opening);
  return {
    opening, closing, inflow, outflow, totals,
    openingBank: total(opening, bankIds),
    openingCash: total(opening, cashIds),
    openingTotal: total(opening, allIds),
    closingBank: total(closing, bankIds),
    closingCash: total(closing, cashIds),
    closingTotal: total(closing, allIds),
    totalIncome: round2(totals.donation + totals.otherIncome + Math.max(totals.adjustment, 0)),
    totalExpense: round2(totals.expense + totals.bankCharges + Math.max(-totals.adjustment, 0)),
  };
}

/** Month-wise breakdown for a FY: donation, expense, closing bank/cash balance */
export function monthlySeries({ fy, accounts, txns }) {
  const months = fyMonths(fy.id);
  return months.map((m) => {
    const from = `${m}-01`;
    const to = dayjs(from).endOf('month').format('YYYY-MM-DD');
    const s = periodSummary({ fy, accounts, txns, from, to });
    const future = dayjs(from).isAfter(dayjs(), 'month');
    return {
      monthKey: m,
      label: dayjs(from).format('MMM YY'),
      donation: s.totals.donation,
      expense: round2(s.totals.expense + s.totals.bankCharges),
      otherIncome: s.totals.otherIncome,
      bankBalance: future ? null : s.closingBank,
      cashBalance: future ? null : s.closingCash,
      closingTotal: future ? null : s.closingTotal,
    };
  });
}

/** Group & sum helper */
export function groupSum(rows, keyFn, valFn = (r) => r.amount) {
  const map = new Map();
  rows.forEach((r) => {
    const keys = [].concat(keyFn(r));
    keys.forEach((k) => {
      const key = k ?? '—';
      const cur = map.get(key) || { key, amount: 0, count: 0 };
      cur.amount = round2(cur.amount + (Number(valFn(r, key)) || 0));
      cur.count += 1;
      map.set(key, cur);
    });
  });
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

/** Donation lines flattened (one row per category line) */
export function donationLines(donations) {
  return donations.flatMap((d) => (d.lines || []).map((l, i) => ({ ...d, _line: i, lineCategory: l.categoryName, lineCategoryHi: l.categoryNameHi, lineCategoryId: l.categoryId, lineFundId: l.fundId, lineAmount: l.amount })));
}

export const isFyDate = (fyId, date) => {
  const { start, end } = fyRange(fyId);
  return date >= start && date <= end;
};

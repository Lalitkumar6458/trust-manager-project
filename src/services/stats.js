'use client';

// ------------------------------------------------------------------
// Year summary ("stats/fy_<fyId>") – ONE small document per financial year,
// kept up to date inside every ledger posting (postEntry). Dashboard, Monthly
// Closing, Audit and the cash / bank book openings read this document instead
// of downloading thousands of entries, so screens stay fast with 5,000+ entries.
//
//   m.<YYYY-MM>.<class>   donation | expense | otherIncome | bankCharges | adjustment | internal | other
//                         (expense & bank charges stored as positive outflow, like periodSummary)
//   a.<accountId>.<YYYY-MM>   net movement (credit − debit) of an account in that month
//   c.<YYYY-MM>.donation / .expense   number of postings (reversals subtract)
//   cd.<categoryId> / ce.<categoryId>  donation / expense amount by category
//
// "Rebuild" recomputes it from the entries (one-time full read) – used the first
// time, or if it ever needs correcting.
// ------------------------------------------------------------------
import { COL } from '@/lib/constants';
import { fyMonths, fyRange, round2 } from '@/lib/format';
import {
  db, docRef, increment, serverTimestamp, fetchAll, where, writeBatch,
} from './db';
import { classOf, net } from './accounting';
import { fyOpeningFor } from './ledger';
import { postedDonationLines, postedExpenses } from '@/reports/definitions';

export const statsRef = (fyId) => docRef(COL.stats, `fy_${fyId}`);

const signedFor = (cls, n) => (cls === 'expense' || cls === 'bankCharges' ? -n : n);
const kindOf = (t) => (t.type === 'reversal' ? t.originalType : t.type);

/** Called by postEntry (inside the same transaction) for every ledger line */
export function statsOnPost(tx, { fyId, monthKey, accountId, credit, debit, type, originalType, cats }) {
  const n = round2((credit || 0) - (debit || 0));
  if (!n) return;
  const cls = classOf({ type, originalType });
  const kind = kindOf({ type, originalType });
  const patch = {
    m: { [monthKey]: { [cls]: increment(signedFor(cls, n)) } },
    a: { [accountId]: { [monthKey]: increment(n) } },
    updatedAt: serverTimestamp(),
  };
  if (kind === 'donation' || kind === 'expense') {
    patch.c = { [monthKey]: { [kind]: increment(type === 'reversal' ? -1 : 1) } };
  }
  if (cats?.length) {
    const key = kind === 'donation' ? 'cd' : 'ce';
    const sign = type === 'reversal' ? -1 : 1;
    patch[key] = {};
    cats.forEach(({ id, amount }) => {
      if (!id) return;
      patch[key][id] = increment(round2(sign * amount));
    });
  }
  tx.set(statsRef(fyId), patch, { merge: true });
}

/** Full recomputation from the entries of a year (Super Admin / finance users) */
export async function rebuildStats(fy) {
  const { start, end } = fyRange(fy.id);
  const [txns, donsFy, expsFy, donsVoid, expsVoid, expsPaid] = await Promise.all([
    fetchAll(COL.transactions, where('financialYearId', '==', fy.id)),
    fetchAll(COL.donations, where('financialYearId', '==', fy.id)),
    fetchAll(COL.expenses, where('financialYearId', '==', fy.id)),
    fetchAll(COL.donations, where('voidDate', '>=', start), where('voidDate', '<=', end)),
    fetchAll(COL.expenses, where('voidDate', '>=', start), where('voidDate', '<=', end)),
    fetchAll(COL.expenses, where('paidDate', '>=', start), where('paidDate', '<=', end)),
  ]);
  const uniq = (...lists) => [...new Map(lists.flat().map((x) => [x.id, x])).values()];
  const m = {};
  const a = {};
  const c = {};
  txns.forEach((t) => {
    const n = net(t);
    if (!n) return;
    const cls = classOf(t);
    m[t.monthKey] = m[t.monthKey] || {};
    m[t.monthKey][cls] = round2((m[t.monthKey][cls] || 0) + signedFor(cls, n));
    a[t.accountId] = a[t.accountId] || {};
    a[t.accountId][t.monthKey] = round2((a[t.accountId][t.monthKey] || 0) + n);
    const kind = kindOf(t);
    if (kind === 'donation' || kind === 'expense') {
      c[t.monthKey] = c[t.monthKey] || {};
      c[t.monthKey][kind] = (c[t.monthKey][kind] || 0) + (t.type === 'reversal' ? -1 : 1);
    }
  });
  const cd = {};
  postedDonationLines(uniq(donsFy, donsVoid), start, end).forEach((l) => { if (l.categoryId) cd[l.categoryId] = round2((cd[l.categoryId] || 0) + l.amount); });
  const ce = {};
  postedExpenses(uniq(expsFy, expsVoid, expsPaid), start, end).forEach((e) => { if (e.categoryId) ce[e.categoryId] = round2((ce[e.categoryId] || 0) + e.signed); });
  const b = writeBatch(db);
  b.set(statsRef(fy.id), { m, a, c, cd, ce, rebuiltAt: serverTimestamp(), updatedAt: serverTimestamp(), entries: txns.length });
  await b.commit();
  return { entries: txns.length };
}

/**
 * Month-wise figures + year totals from the summary document
 * (same numbers periodSummary / monthlySeries give from the raw entries).
 */
export function seriesFromStats({ fy, accounts, stats }) {
  const months = fyMonths(fy.id);
  const opening = {};
  accounts.forEach((acc) => { opening[acc.id] = fyOpeningFor(fy, acc); });
  Object.keys(stats?.a || {}).forEach((id) => { if (opening[id] === undefined) opening[id] = 0; });
  const bal = { ...opening };
  const typeOf = (id) => accounts.find((x) => x.id === id)?.type;
  const sumBy = (map, type) => round2(Object.entries(map).reduce((s, [id, v]) => s + (!type || typeOf(id) === type ? v : 0), 0));
  const totals = { donation: 0, expense: 0, otherIncome: 0, bankCharges: 0, adjustment: 0, internal: 0, other: 0 };
  const today = new Date().toISOString().slice(0, 7);
  const rows = months.map((mk) => {
    const mm = stats?.m?.[mk] || {};
    const openBank = sumBy(bal, 'bank');
    const openCash = sumBy(bal, 'cash');
    const openTotal = sumBy(bal);
    Object.keys(bal).forEach((id) => { bal[id] = round2(bal[id] + (stats?.a?.[id]?.[mk] || 0)); });
    Object.keys(totals).forEach((k) => { totals[k] = round2(totals[k] + (mm[k] || 0)); });
    const future = mk > today;
    return {
      monthKey: mk,
      donation: round2(mm.donation || 0),
      expense: round2((mm.expense || 0) + (mm.bankCharges || 0)),
      expenseOnly: round2(mm.expense || 0),
      bankCharges: round2(mm.bankCharges || 0),
      otherIncome: round2(mm.otherIncome || 0),
      adjustment: round2(mm.adjustment || 0),
      donationCount: stats?.c?.[mk]?.donation || 0,
      expenseCount: stats?.c?.[mk]?.expense || 0,
      openingBank: openBank,
      openingCash: openCash,
      openingTotal: openTotal,
      closingBank: sumBy(bal, 'bank'),
      closingCash: sumBy(bal, 'cash'),
      closingTotal: sumBy(bal),
      bankBalance: future ? null : sumBy(bal, 'bank'),
      cashBalance: future ? null : sumBy(bal, 'cash'),
    };
  });
  const openingTotal = sumBy(opening);
  const closingTotal = sumBy(bal);
  return {
    months: rows,
    totals,
    openingTotal,
    closingTotal,
    closingBank: sumBy(bal, 'bank'),
    closingCash: sumBy(bal, 'cash'),
    closing: bal,
    donationCount: rows.reduce((s, r) => s + r.donationCount, 0),
    expenseCount: rows.reduce((s, r) => s + r.expenseCount, 0),
    totalIncome: round2(totals.donation + totals.otherIncome + Math.max(totals.adjustment, 0)),
    totalExpense: round2(totals.expense + totals.bankCharges + Math.max(-totals.adjustment, 0)),
  };
}

/** Opening balance of one account at the start of a month (FY opening + earlier months) */
export function accountOpeningAtMonth({ fy, account, stats, monthKey }) {
  let v = fyOpeningFor(fy, account);
  fyMonths(fy.id).forEach((mk) => { if (mk < monthKey) v = round2(v + (stats?.a?.[account.id]?.[mk] || 0)); });
  return v;
}

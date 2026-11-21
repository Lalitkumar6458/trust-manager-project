// Pure year-summary helpers (no database) – shared by the browser and the server.
import { fyMonths, round2 } from '@/lib/format';
import { fyOpeningFor } from '@/lib/ledgerMath';

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

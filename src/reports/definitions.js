// ------------------------------------------------------------------
// Report catalogue. Each report declares the data it needs and a
// `build(data, ctx)` that returns { sections:[{title, columns, rows, totals}], cards? }.
// Columns use the export-column format: { title, key, value?, money?, width? }.
// ------------------------------------------------------------------
import dayjs from 'dayjs';
import { PAYEE_TYPES, TXN_TYPES } from '@/lib/constants';
import { fmtDate, fmtDateTime, round2, sum, maskAccount, monthLabel } from '@/lib/format';
import { groupSum, periodSummary, classOf, net } from '@/services/accounting';
import { withRunningBalance, fyOpeningFor } from '@/services/ledger';

// ---------- helpers ----------
const pct = (v, total) => (total ? `${((v / total) * 100).toFixed(1)}%` : '');

function grouped(rows, keyFn, keyTitle, valFn) {
  const g = groupSum(rows, keyFn, valFn);
  const total = sum(g, (x) => x.amount);
  return {
    columns: [
      { title: keyTitle, key: 'key', width: 2.5 },
      { title: 'Count', key: 'count' },
      { title: 'Amount', key: 'amount', money: true },
      { title: 'Share', key: 'share', value: (r) => pct(r.amount, total) },
    ],
    rows: g,
    totals: { key: 'Total', count: sum(g, (x) => x.count), amount: total, share: total ? '100%' : '' },
  };
}

const byPeriod = (period) => (r) => {
  if (period === 'day') return fmtDate(r.date);
  if (period === 'month') return dayjs(r.date).format('MMM YYYY');
  return `FY ${r.financialYearId}`;
};

/** Donation lines including reversals (signed) – consistent with the ledger */
export function postedDonationLines(donations, from, to) {
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  const out = [];
  donations.forEach((d) => {
    const wasPosted = d.posted || d.reversalTxnId;
    if (!wasPosted) return;
    if (inRange(d.date)) d.lines.forEach((l) => out.push({ ...l, donation: d, amount: l.amount, date: d.date }));
    if (d.status === 'void' && d.reversalTxnId && d.voidDate && inRange(d.voidDate)) {
      d.lines.forEach((l) => out.push({ ...l, donation: d, amount: -l.amount, date: d.voidDate }));
    }
  });
  return out;
}

export function postedExpenses(expenses, from, to) {
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  const out = [];
  expenses.forEach((e) => {
    const wasPosted = e.posted || e.reversalTxnId;
    if (!wasPosted) return;
    // cash basis: an expense hits the books on the day it was PAID
    const paidOn = e.paidDate || e.date;
    if (inRange(paidOn)) out.push({ ...e, signed: e.amount, date: paidOn });
    if (e.status === 'void' && e.reversalTxnId && e.voidDate && inRange(e.voidDate)) out.push({ ...e, signed: -e.amount, date: e.voidDate });
  });
  return out;
}

const DON_COLS = [
  { title: 'Date', key: 'date', value: (r) => fmtDate(r.date) },
  { title: 'Receipt No.', key: 'receiptNo' },
  { title: 'Donor', key: 'donor', value: (r) => r.donor?.name, width: 2 },
  { title: 'PAN', key: 'pan', value: (r) => r.donor?.pan },
  { title: 'Address', key: 'addr', value: (r) => r.donor?.address, width: 2 },
  { title: 'Category', key: 'cat', value: (r) => (r.lines || []).map((l) => l.categoryName).join(', '), width: 1.6 },
  { title: 'Mode', key: 'paymentMode' },
  { title: 'Ref (UTR/Chq)', key: 'ref', value: (r) => r.utr || r.chequeNo || '' },
  { title: 'Amount', key: 'amount', money: true },
];

const EXP_COLS = [
  { title: 'Date', key: 'date', value: (r) => fmtDate(r.date) },
  { title: 'Voucher No.', key: 'voucherNo' },
  { title: 'Paid To', key: 'payee', value: (r) => r.payee?.name, width: 2 },
  { title: 'Category', key: 'categoryName' },
  { title: 'Purpose', key: 'purpose', width: 2 },
  { title: 'Mode', key: 'paymentMode' },
  { title: 'Ref', key: 'ref', value: (r) => r.utr || r.chequeNo || r.cashRef || '' },
  { title: 'Approved By', key: 'approvedByName' },
  { title: 'Amount', key: 'amount', money: true },
];

const LEDGER_COLS = [
  { title: 'Date', key: 'date', value: (r) => fmtDate(r.date) },
  { title: 'Type', key: 'type', value: (r) => TXN_TYPES[r.type] || r.type || '' },
  { title: 'Reference', key: 'reference' },
  { title: 'Party', key: 'partyName', width: 1.5 },
  { title: 'Description', key: 'description', width: 2.5 },
  { title: 'Credit (In)', key: 'credit', money: true },
  { title: 'Debit (Out)', key: 'debit', money: true },
  { title: 'Balance', key: 'balance', money: true },
];

function listSection(rows, columns, totalKeyCol, title) {
  return { title, columns, rows, totals: { [totalKeyCol]: `Total (${rows.length})`, amount: sum(rows, (r) => r.amount) } };
}

function accountBookSections(accounts, txns, ctx) {
  const { from, to, fy } = ctx;
  return accounts.map((a) => {
    const all = withRunningBalance(txns.filter((t) => t.accountId === a.id), fyOpeningFor(fy, a));
    const before = all.filter((t) => from && t.date < from);
    const open = before.length ? before[before.length - 1].balance : fyOpeningFor(fy, a);
    const rows = all.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
    const close = rows.length ? rows[rows.length - 1].balance : open;
    return {
      title: `${a.name}${a.accountNumber ? ` (${maskAccount(a.accountNumber)})` : ''}`,
      columns: LEDGER_COLS,
      rows: [{ date: from || fy.startDate, description: 'Opening balance', balance: open }, ...rows],
      totals: { description: 'Total / Closing balance', credit: sum(rows, (r) => r.credit), debit: sum(rows, (r) => r.debit), balance: close },
    };
  });
}

// ---------- catalogue ----------
export const REPORT_GROUPS = [
  { key: 'donation', title: 'Donation reports' },
  { key: 'expense', title: 'Expense reports' },
  { key: 'accounting', title: 'Accounting reports' },
  { key: 'audit', title: 'Audit / registers' },
];

const donationFilters = ['dates', 'donationCategory', 'mode', 'account', 'fund', 'amount', 'status', 'donor'];
const expenseFilters = ['dates', 'expenseCategory', 'mode', 'account', 'fund', 'amount', 'status', 'payee'];

export const REPORTS = [
  // ===================== DONATION =====================
  {
    key: 'donation-register', group: 'donation', title: 'Donation Register', needs: ['donations'], filters: donationFilters,
    build: ({ donations }) => ({ sections: [listSection(donations, DON_COLS, 'donor')] }),
  },
  {
    key: 'daily-donation', group: 'donation', title: 'Daily Donation', needs: ['donations'], filters: donationFilters,
    build: ({ donations }) => {
      const g = grouped(donations, (r) => r.date, 'Date');
      return { sections: [{ ...g, rows: g.rows.sort((a, b) => a.key.localeCompare(b.key)).map((r) => ({ ...r, key: fmtDate(r.key) })) }] };
    },
  },
  {
    key: 'monthly-donation', group: 'donation', title: 'Monthly Donation', needs: ['donations'], filters: donationFilters,
    build: ({ donations }) => {
      const g = grouped(donations, (r) => r.monthKey, 'Month');
      return { sections: [{ ...g, rows: g.rows.sort((a, b) => a.key.localeCompare(b.key)).map((r) => ({ ...r, key: monthLabel(r.key) })) }] };
    },
  },
  {
    key: 'yearly-donation', group: 'donation', title: 'Yearly Donation (all FYs)', needs: ['donations'], allYears: true, filters: ['donationCategory', 'mode', 'status'],
    build: ({ donations }) => {
      const g = grouped(donations, byPeriod('fy'), 'Financial year');
      return { sections: [{ ...g, rows: g.rows.sort((a, b) => a.key.localeCompare(b.key)) }] };
    },
  },
  {
    key: 'donor-wise', group: 'donation', title: 'Donor-wise Donation', needs: ['donations'], filters: donationFilters,
    build: ({ donations }) => ({ sections: [grouped(donations, (d) => `${d.donor?.name}${d.donor?.donorCode ? ` (${d.donor.donorCode})` : ''}${d.donor?.pan ? ` – ${d.donor.pan}` : ''}`, 'Donor')] }),
  },
  {
    key: 'category-wise-donation', group: 'donation', title: 'Category-wise Donation', needs: ['donations'], filters: donationFilters,
    build: ({ donations }, ctx) => ({ sections: [grouped(donations.flatMap((d) => d.lines), (l) => ctx.pick(l.categoryName, l.categoryNameHi), 'Category')] }),
  },
  {
    key: 'mode-wise-donation', group: 'donation', title: 'Payment-mode-wise Donation', needs: ['donations'], filters: donationFilters,
    build: ({ donations }) => ({ sections: [grouped(donations, (d) => d.paymentMode, 'Payment mode')] }),
  },
  {
    key: 'bank-wise-donation', group: 'donation', title: 'Bank / Account-wise Donation', needs: ['donations'], filters: donationFilters,
    build: ({ donations }) => ({ sections: [grouped(donations, (d) => d.accountName, 'Account')] }),
  },
  {
    key: 'project-wise-donation', group: 'donation', title: 'Project / Fund-wise Donation', needs: ['donations'], filters: donationFilters,
    build: ({ donations }, ctx) => ({ sections: [grouped(donations.flatMap((d) => d.lines), (l) => ctx.fundName(l.fundId) || 'General (no fund)', 'Fund / Project')] }),
  },
  {
    key: 'corpus-donation', group: 'donation', title: 'Corpus Donation Report', needs: ['donations'], filters: donationFilters,
    build: ({ donations }) => {
      const rows = donations.filter((d) => d.lines.some((l) => l.isCorpus)).map((d) => ({ ...d, amount: sum(d.lines.filter((l) => l.isCorpus), (l) => l.amount) }));
      return { sections: [listSection(rows, DON_COLS, 'donor')] };
    },
  },
  {
    key: 'donor-pan-80g', group: 'donation', title: 'Donor PAN Summary (for Form 10BD data)', needs: ['donations'], filters: donationFilters,
    build: ({ donations }) => {
      const g = new Map();
      donations.forEach((d) => {
        const k = d.donorId;
        const cur = g.get(k) || { name: d.donor?.name, pan: d.donor?.pan || '', address: d.donor?.address || '', modes: new Set(), corpus: 0, other: 0, count: 0 };
        d.lines.forEach((l) => { if (l.isCorpus) cur.corpus += l.amount; else cur.other += l.amount; });
        cur.modes.add(d.paymentMode);
        cur.count += 1;
        g.set(k, cur);
      });
      const rows = Array.from(g.values()).map((r) => ({ ...r, modes: [...r.modes].join(', '), amount: round2(r.corpus + r.other), corpus: round2(r.corpus), other: round2(r.other) }));
      return {
        sections: [{
          columns: [
            { title: 'Donor', key: 'name', width: 2 }, { title: 'PAN', key: 'pan' }, { title: 'Address', key: 'address', width: 2.5 },
            { title: 'Modes', key: 'modes' }, { title: 'Receipts', key: 'count' }, { title: 'Corpus', key: 'corpus', money: true },
            { title: 'Specific / General', key: 'other', money: true }, { title: 'Total', key: 'amount', money: true },
          ],
          rows,
          totals: { name: 'Total', corpus: sum(rows, (r) => r.corpus), other: sum(rows, (r) => r.other), amount: sum(rows, (r) => r.amount) },
        }],
        note: 'Exact Form 10BD format and eligibility must be confirmed with your CA. Donations without PAN are listed with blank PAN.',
      };
    },
  },

  // ===================== EXPENSE =====================
  {
    key: 'expense-register', group: 'expense', title: 'Expense Register', needs: ['expenses'], filters: expenseFilters,
    build: ({ expenses }) => ({ sections: [listSection(expenses, EXP_COLS, 'payee')] }),
  },
  {
    key: 'payment-register', group: 'expense', title: 'Payment Register', needs: ['expenses'], filters: expenseFilters,
    build: ({ expenses }) => {
      const cols = [
        { title: 'Paid On', key: 'date', value: (r) => fmtDate(r.paidDate || r.date) },
        { title: 'Voucher', key: 'voucherNo' },
        { title: 'Payee', key: 'payee', value: (r) => r.payee?.name, width: 2 },
        { title: 'PAN / GST', key: 'pan', value: (r) => [r.payee?.pan, r.payee?.gstin].filter(Boolean).join(' / ') },
        { title: 'From Account', key: 'accountName', width: 1.5 },
        { title: 'Mode', key: 'paymentMode' },
        { title: 'UTR / Cheque', key: 'ref', value: (r) => r.utr || r.chequeNo || r.cashRef || '' },
        { title: 'Bill', key: 'billNo' },
        { title: 'Amount', key: 'amount', money: true },
      ];
      return { sections: [listSection(expenses.filter((e) => e.status === 'paid'), cols, 'payee')] };
    },
  },
  {
    key: 'daily-expense', group: 'expense', title: 'Daily Expense', needs: ['expenses'], filters: expenseFilters,
    build: ({ expenses }) => {
      const g = grouped(expenses, (r) => r.date, 'Date');
      return { sections: [{ ...g, rows: g.rows.sort((a, b) => a.key.localeCompare(b.key)).map((r) => ({ ...r, key: fmtDate(r.key) })) }] };
    },
  },
  {
    key: 'monthly-expense', group: 'expense', title: 'Monthly Expense', needs: ['expenses'], filters: expenseFilters,
    build: ({ expenses }) => {
      const g = grouped(expenses, (r) => r.monthKey, 'Month');
      return { sections: [{ ...g, rows: g.rows.sort((a, b) => a.key.localeCompare(b.key)).map((r) => ({ ...r, key: monthLabel(r.key) })) }] };
    },
  },
  {
    key: 'yearly-expense', group: 'expense', title: 'Yearly Expense (all FYs)', needs: ['expenses'], allYears: true, filters: ['expenseCategory', 'mode', 'status'],
    build: ({ expenses }) => {
      const g = grouped(expenses, byPeriod('fy'), 'Financial year');
      return { sections: [{ ...g, rows: g.rows.sort((a, b) => a.key.localeCompare(b.key)) }] };
    },
  },
  {
    key: 'category-wise-expense', group: 'expense', title: 'Category-wise Expense', needs: ['expenses'], filters: expenseFilters,
    build: ({ expenses }, ctx) => ({ sections: [grouped(expenses, (e) => ctx.pick(e.categoryName, e.categoryNameHi), 'Category')] }),
  },
  {
    key: 'beneficiary-wise', group: 'expense', title: 'Beneficiary-wise Expense', needs: ['expenses'], filters: expenseFilters,
    build: ({ expenses }) => ({ sections: [grouped(expenses.filter((e) => e.payee?.type !== 'vendor'), (e) => `${e.payee?.name}${e.payee?.code ? ` (${e.payee.code})` : ''}`, 'Beneficiary')] }),
  },
  {
    key: 'vendor-wise', group: 'expense', title: 'Vendor / Payee-wise Expense', needs: ['expenses'], filters: expenseFilters,
    build: ({ expenses }) => ({ sections: [grouped(expenses.filter((e) => e.payee?.type === 'vendor'), (e) => `${e.payee?.name}${e.payee?.gstin ? ` – ${e.payee.gstin}` : ''}`, 'Vendor')] }),
  },
  {
    key: 'project-wise-expense', group: 'expense', title: 'Project / Fund-wise Expense', needs: ['expenses'], filters: expenseFilters,
    build: ({ expenses }) => ({ sections: [grouped(expenses, (e) => e.fundName || e.projectName || 'General (no fund)', 'Fund / Project')] }),
  },
  {
    key: 'mode-wise-expense', group: 'expense', title: 'Payment-mode-wise Expense', needs: ['expenses'], filters: expenseFilters,
    build: ({ expenses }) => ({ sections: [grouped(expenses, (e) => e.paymentMode || '—', 'Payment mode')] }),
  },

  // ===================== ACCOUNTING =====================
  {
    key: 'cash-book', group: 'accounting', title: 'Cash Book', needs: ['txns'], filters: ['dates'],
    build: ({ txns }, ctx) => ({ sections: accountBookSections(ctx.accounts.filter((a) => a.type === 'cash'), txns, ctx) }),
  },
  {
    key: 'bank-book', group: 'accounting', title: 'Bank Book', needs: ['txns'], filters: ['dates', 'account'],
    build: ({ txns }, ctx) => ({ sections: accountBookSections(ctx.accounts.filter((a) => a.type === 'bank' && (!ctx.filters.accountId || a.id === ctx.filters.accountId)), txns, ctx) }),
  },
  {
    key: 'ledger', group: 'accounting', title: 'General Ledger (all accounts)', needs: ['txns'], filters: ['dates', 'account'],
    build: ({ txns }, ctx) => ({ sections: accountBookSections(ctx.accounts.filter((a) => !ctx.filters.accountId || a.id === ctx.filters.accountId), txns, ctx) }),
  },
  {
    key: 'transaction-report', group: 'accounting', title: 'Transaction Report', needs: ['txns'], filters: ['dates', 'account', 'fund'],
    build: ({ txns }, ctx) => {
      const { from, to, filters } = ctx;
      const rows = txns.filter((t) => (!from || t.date >= from) && (!to || t.date <= to)
        && (!filters.accountId || t.accountId === filters.accountId) && (!filters.fundId || t.fundId === filters.fundId))
        .sort((a, b) => a.date.localeCompare(b.date));
      const cols = [{ title: 'Account', key: 'accountName', width: 1.5 }, ...LEDGER_COLS.filter((c) => c.key !== 'balance')];
      return { sections: [{ columns: cols, rows, totals: { description: `Total (${rows.length})`, credit: sum(rows, (r) => r.credit), debit: sum(rows, (r) => r.debit) } }] };
    },
  },
  {
    key: 'receipt-payment', group: 'accounting', title: 'Receipt & Payment Statement', needs: ['txns', 'donations', 'expenses'], rawStatus: true, filters: ['dates'],
    build: ({ txns, donations, expenses }, ctx) => {
      const { from, to, fy, accounts } = ctx;
      const s = periodSummary({ fy, accounts, txns, from, to });
      const dl = postedDonationLines(donations, from, to);
      const ex = postedExpenses(expenses, from, to);
      const recCats = groupSum(dl, (l) => ctx.pick(l.categoryName, l.categoryNameHi), (l) => l.amount).sort((a, b) => a.key.localeCompare(b.key));
      const payCats = groupSum(ex, (e) => ctx.pick(e.categoryName, e.categoryNameHi), (e) => e.signed).sort((a, b) => a.key.localeCompare(b.key));
      const other = txns.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
      const oi = sum(other.filter((t) => classOf(t) === 'otherIncome'), net);
      const bc = -sum(other.filter((t) => classOf(t) === 'bankCharges'), net);
      const adj = sum(other.filter((t) => classOf(t) === 'adjustment'), net);
      const cols = [{ title: 'Particulars', key: 'p', width: 3 }, { title: 'Amount', key: 'amount', money: true }];
      const receipts = [
        { p: ctx.t('Opening balance – Cash'), amount: s.openingCash },
        { p: ctx.t('Opening balance – Bank'), amount: s.openingBank },
        ...recCats.filter((c) => Math.abs(c.amount) > 0.001).map((c) => ({ p: `${ctx.t('Donation')} – ${c.key}`, amount: c.amount })),
        { p: ctx.t('Interest / other income'), amount: oi },
        ...(adj > 0 ? [{ p: ctx.t('Adjustments (net in)'), amount: adj }] : []),
      ];
      const payments = [
        ...payCats.filter((c) => Math.abs(c.amount) > 0.001).map((c) => ({ p: `${c.key}`, amount: c.amount })),
        { p: ctx.t('Bank charges'), amount: bc },
        ...(adj < 0 ? [{ p: ctx.t('Adjustments (net out)'), amount: -adj }] : []),
        { p: ctx.t('Closing balance – Cash'), amount: s.closingCash },
        { p: ctx.t('Closing balance – Bank'), amount: s.closingBank },
      ];
      return {
        sections: [
          { title: 'RECEIPTS', columns: cols, rows: receipts, totals: { p: ctx.t('Total receipts'), amount: sum(receipts, (r) => r.amount) } },
          { title: 'PAYMENTS', columns: cols, rows: payments, totals: { p: ctx.t('Total payments'), amount: sum(payments, (r) => r.amount) } },
        ],
        landscape: false,
      };
    },
  },
  {
    key: 'income-expenditure', group: 'accounting', title: 'Income & Expenditure Statement', needs: ['txns', 'donations', 'expenses'], rawStatus: true, filters: ['dates'],
    build: ({ txns, donations, expenses }, ctx) => {
      const { from, to } = ctx;
      const dl = postedDonationLines(donations, from, to);
      const ex = postedExpenses(expenses, from, to);
      const inc = groupSum(dl.filter((l) => !l.isCorpus), (l) => ctx.pick(l.categoryName, l.categoryNameHi), (l) => l.amount);
      const exp = groupSum(ex.filter((e) => !e.isCapital), (e) => ctx.pick(e.categoryName, e.categoryNameHi), (e) => e.signed);
      const period = txns.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
      const oi = sum(period.filter((t) => classOf(t) === 'otherIncome'), net);
      const bc = -sum(period.filter((t) => classOf(t) === 'bankCharges'), net);
      const income = [...inc.filter((c) => Math.abs(c.amount) > 0.001).map((c) => ({ p: `${ctx.t('Donation')} – ${c.key}`, amount: c.amount })), { p: ctx.t('Interest / other income'), amount: oi }];
      const expenditure = [...exp.filter((c) => Math.abs(c.amount) > 0.001).map((c) => ({ p: c.key, amount: c.amount })), { p: ctx.t('Bank charges'), amount: bc }];
      const ti = sum(income, (r) => r.amount);
      const te = sum(expenditure, (r) => r.amount);
      const cols = [{ title: 'Particulars', key: 'p', width: 3 }, { title: 'Amount', key: 'amount', money: true }];
      const corpus = sum(dl.filter((l) => l.isCorpus), (l) => l.amount);
      const capital = sum(ex.filter((e) => e.isCapital), (e) => e.signed);
      return {
        sections: [
          { title: 'INCOME', columns: cols, rows: income, totals: { p: ctx.t('Total income'), amount: ti } },
          { title: 'EXPENDITURE', columns: cols, rows: expenditure, totals: { p: ctx.t('Total expenditure'), amount: te } },
          {
            title: 'RESULT',
            columns: cols,
            rows: [
              { p: ctx.t(ti >= te ? 'Excess of income over expenditure (surplus)' : 'Excess of expenditure over income (deficit)'), amount: round2(ti - te) },
              { p: ctx.t('Corpus donations (credited to Corpus Fund – balance sheet)'), amount: corpus },
              { p: ctx.t('Capital expenditure (asset purchase – balance sheet)'), amount: capital },
            ],
          },
        ],
        landscape: false,
        note: 'Cash-basis statement generated from the books. Final statutory format (accrual entries, depreciation, Schedule) to be finalised with your CA.',
      };
    },
  },
  {
    key: 'opening-closing', group: 'accounting', title: 'Opening / Closing Balance', needs: ['txns'], filters: ['dates'],
    build: ({ txns }, ctx) => {
      const s = periodSummary({ fy: ctx.fy, accounts: ctx.accounts, txns, from: ctx.from, to: ctx.to });
      const rows = ctx.accounts.map((a) => ({ name: a.name, type: a.type === 'cash' ? 'Cash' : 'Bank', opening: s.opening[a.id] || 0, inflow: s.inflow[a.id] || 0, outflow: s.outflow[a.id] || 0, closing: s.closing[a.id] || 0 }));
      return {
        sections: [{
          columns: [
            { title: 'Account', key: 'name', width: 2 }, { title: 'Type', key: 'type' },
            { title: 'Opening', key: 'opening', money: true }, { title: 'Total In', key: 'inflow', money: true },
            { title: 'Total Out', key: 'outflow', money: true }, { title: 'Closing', key: 'closing', money: true },
          ],
          rows,
          totals: { name: 'Total', opening: sum(rows, (r) => r.opening), inflow: sum(rows, (r) => r.inflow), outflow: sum(rows, (r) => r.outflow), closing: sum(rows, (r) => r.closing) },
        }],
      };
    },
  },
  {
    key: 'monthly-financial', group: 'accounting', title: 'Monthly Financial Report', needs: ['txns', 'donations', 'expenses'], rawStatus: true, filters: ['month'],
    build: ({ txns, donations, expenses }, ctx) => {
      const month = ctx.filters.month || dayjs().format('YYYY-MM');
      const from = `${month}-01`;
      const to = dayjs(from).endOf('month').format('YYYY-MM-DD');
      const s = periodSummary({ fy: ctx.fy, accounts: ctx.accounts, txns, from, to });
      // ledger-consistent: postings of the month incl. reversals of voided items (signed)
      const dl = postedDonationLines(donations, from, to);
      const md = [...new Map(dl.filter((l) => l.amount > 0).map((l) => [l.donation.id, l.donation])).values()];
      const me = postedExpenses(expenses, from, to);
      const two = [{ title: 'Particulars', key: 'p', width: 3 }, { title: 'Amount', key: 'amount', money: true }];
      const g = (rows, keyFn, valFn) => groupSum(rows, keyFn, valFn).filter((x) => Math.abs(x.amount) > 0.001).map((x) => ({ p: `${x.key} (${x.count})`, amount: x.amount }));
      return {
        title: `${ctx.t('Monthly Financial Report')} – ${monthLabel(month)}`,
        cards: [
          { title: 'Opening balance', value: s.openingTotal },
          { title: 'Total income', value: s.totalIncome },
          { title: 'Total expense', value: s.totalExpense },
          { title: 'Closing balance', value: s.closingTotal },
        ],
        sections: [
          { title: ctx.t('INCOME – {n} donation(s)', { n: md.length }), columns: two, rows: [{ p: ctx.t('Total donation'), amount: sum(dl, (l) => l.amount) }, { p: ctx.t('Other income'), amount: s.totals.otherIncome }], totals: null },
          { title: 'Category-wise donation', columns: two, rows: g(dl, (l) => ctx.pick(l.categoryName, l.categoryNameHi), (l) => l.amount) },
          { title: 'Payment-mode-wise donation', columns: two, rows: g(dl, (l) => l.donation.paymentMode, (l) => l.amount) },
          { title: ctx.t('EXPENSE – {n} payment(s)', { n: me.filter((e) => e.signed > 0).length }), columns: two, rows: [{ p: ctx.t('Total expense'), amount: sum(me, (e) => e.signed) }, { p: ctx.t('Bank charges'), amount: s.totals.bankCharges }] },
          { title: 'Category-wise expense', columns: two, rows: g(me, (e) => ctx.pick(e.categoryName, e.categoryNameHi), (e) => e.signed) },
          { title: 'Payment-mode-wise expense', columns: two, rows: g(me, (e) => e.paymentMode, (e) => e.signed) },
          {
            title: 'BALANCE',
            columns: two,
            rows: [
              { p: ctx.t('Opening balance (bank + cash)'), amount: s.openingTotal },
              { p: ctx.t('+ Total income'), amount: s.totalIncome },
              { p: ctx.t('− Total expense'), amount: s.totalExpense },
              { p: ctx.t('= Closing balance'), amount: s.closingTotal },
              { p: ctx.t('   of which Bank'), amount: s.closingBank },
              { p: ctx.t('   of which Cash'), amount: s.closingCash },
            ],
          },
        ],
        landscape: false,
      };
    },
  },
  {
    key: 'fy-summary', group: 'accounting', title: 'Financial Year Summary', needs: ['txns', 'donations', 'expenses'], rawStatus: true, filters: [],
    build: ({ txns, donations, expenses }, ctx) => {
      const { fy, accounts } = ctx;
      const s = periodSummary({ fy, accounts, txns });
      const two = [{ title: 'Particulars', key: 'p', width: 3 }, { title: 'Amount', key: 'amount', money: true }];
      const assets = (fy.assets || []).map((a) => ({ p: a.name, amount: a.amount }));
      const liabilities = (fy.liabilities || []).map((a) => ({ p: a.name, amount: a.amount }));
      const months = Array.from({ length: 12 }, (_, i) => dayjs(fy.startDate).add(i, 'month'));
      const monthRows = months.map((m) => {
        const ms = periodSummary({ fy, accounts, txns, from: m.startOf('month').format('YYYY-MM-DD'), to: m.endOf('month').format('YYYY-MM-DD') });
        return { m: m.format('MMM YYYY'), opening: ms.openingTotal, donation: ms.totals.donation, other: ms.totals.otherIncome, expense: round2(ms.totals.expense + ms.totals.bankCharges), adj: ms.totals.adjustment, closing: ms.closingTotal };
      });
      return {
        cards: [
          { title: 'Opening balance', value: s.openingTotal },
          { title: 'Total donations', value: s.totals.donation },
          { title: 'Total expenses', value: round2(s.totals.expense + s.totals.bankCharges) },
          { title: 'Closing balance', value: s.closingTotal },
        ],
        sections: [
          {
            title: 'Summary',
            columns: two,
            rows: [
              { p: ctx.t('Opening balance – Bank'), amount: s.openingBank },
              { p: ctx.t('Opening balance – Cash'), amount: s.openingCash },
              { p: ctx.t('Donations ({n} approved)', { n: donations.filter((d) => d.status === 'approved').length }), amount: s.totals.donation },
              { p: ctx.t('Other income'), amount: s.totals.otherIncome },
              { p: ctx.t('Expenses ({n} paid)', { n: expenses.filter((e) => e.status === 'paid').length }), amount: s.totals.expense },
              { p: ctx.t('Bank charges'), amount: s.totals.bankCharges },
              { p: ctx.t('Adjustments (net)'), amount: s.totals.adjustment },
              { p: ctx.t('Closing balance – Bank'), amount: s.closingBank },
              { p: ctx.t('Closing balance – Cash'), amount: s.closingCash },
            ],
          },
          {
            title: 'Month-wise',
            columns: [
              { title: 'Month', key: 'm' }, { title: 'Opening', key: 'opening', money: true }, { title: 'Donation', key: 'donation', money: true },
              { title: 'Other income', key: 'other', money: true }, { title: 'Expense', key: 'expense', money: true }, { title: 'Adjustment', key: 'adj', money: true }, { title: 'Closing', key: 'closing', money: true },
            ],
            rows: monthRows,
            totals: { m: 'Total', donation: sum(monthRows, (r) => r.donation), other: sum(monthRows, (r) => r.other), expense: sum(monthRows, (r) => r.expense), adj: sum(monthRows, (r) => r.adj) },
          },
          { title: 'Assets (as recorded for audit)', columns: two, rows: assets, totals: { p: ctx.t('Total assets'), amount: sum(assets, (r) => r.amount) } },
          { title: 'Liabilities', columns: two, rows: liabilities, totals: { p: ctx.t('Total liabilities'), amount: sum(liabilities, (r) => r.amount) } },
        ],
      };
    },
  },
  {
    key: 'bank-reconciliation', group: 'accounting', title: 'Bank Reconciliation Summary', needs: ['statements', 'txns'], filters: ['account'],
    build: ({ statements, txns }, ctx) => {
      const rows = statements.filter((s) => !ctx.filters.accountId || s.accountId === ctx.filters.accountId).map((st) => {
        const acc = ctx.accounts.find((a) => a.id === st.accountId);
        const sys = withRunningBalance(txns.filter((t) => t.accountId === st.accountId && t.date <= st.periodTo), fyOpeningFor(ctx.fy, acc || { id: st.accountId }));
        const systemBal = sys.length ? sys[sys.length - 1].balance : fyOpeningFor(ctx.fy, acc || { id: st.accountId });
        return {
          account: st.accountName, period: `${fmtDate(st.periodFrom)} – ${fmtDate(st.periodTo)}`, file: st.fileName,
          lines: st.lineCount, matched: st.matchedCount || 0, ignored: st.ignoredCount || 0,
          unmatched: (st.lineCount || 0) - (st.matchedCount || 0) - (st.ignoredCount || 0),
          systemBal, bankBal: st.closingBalance, diff: st.closingBalance === null || st.closingBalance === undefined ? null : round2(systemBal - st.closingBalance),
        };
      });
      return {
        sections: [{
          columns: [
            { title: 'Account', key: 'account', width: 1.5 }, { title: 'Period', key: 'period', width: 1.5 }, { title: 'File', key: 'file', width: 1.5 },
            { title: 'Lines', key: 'lines' }, { title: 'Matched', key: 'matched' }, { title: 'Ignored', key: 'ignored' }, { title: 'Unmatched', key: 'unmatched' },
            { title: 'System balance', key: 'systemBal', money: true }, { title: 'Statement balance', key: 'bankBal', money: true }, { title: 'Difference', key: 'diff', money: true },
          ],
          rows,
        }],
      };
    },
  },

  // ===================== AUDIT / REGISTERS =====================
  {
    key: 'donor-register', group: 'audit', title: 'Donor Register', needs: ['donors'], filters: [],
    build: ({ donors }, ctx) => {
      const k = ctx.fy.id.replace('-', '_');
      const rows = [...donors].sort((a, b) => (a.donorCode || '').localeCompare(b.donorCode || '')).map((d) => ({ ...d, fyAmount: d.fyTotals?.[k] || 0 }));
      return {
        sections: [{
          columns: [
            { title: 'Donor ID', key: 'donorCode' }, { title: 'Name', key: 'name', width: 2 }, { title: 'Type', key: 'donorType' },
            { title: 'Mobile', key: 'mobile' }, { title: 'PAN', key: 'pan' }, { title: 'Address', key: 'address', width: 2.5 },
            { title: 'Donations', key: 'donationCount' }, { title: `FY ${ctx.fy.id}`, key: 'fyAmount', money: true }, { title: 'Lifetime', key: 'totalAmount', money: true },
          ],
          rows,
          totals: { name: `Total (${rows.length})`, fyAmount: sum(rows, (r) => r.fyAmount), totalAmount: sum(rows, (r) => r.totalAmount) },
        }],
      };
    },
  },
  {
    key: 'beneficiary-register', group: 'audit', title: 'Beneficiary / Payee Register', needs: ['payees'], filters: ['payeeType'],
    build: ({ payees }, ctx) => {
      const rows = payees.filter((p) => !ctx.filters.payeeType || p.type === ctx.filters.payeeType).sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      return {
        sections: [{
          columns: [
            { title: 'ID', key: 'code' }, { title: 'Name', key: 'name', width: 2 }, { title: 'Type', key: 'type', value: (r) => PAYEE_TYPES.find((t) => t.value === r.type)?.label },
            { title: 'Mobile', key: 'mobile' }, { title: 'PAN', key: 'pan' }, { title: 'Bank A/c', key: 'bank', value: (r) => maskAccount(r.bankAccountNo) },
            { title: 'IFSC', key: 'ifsc' }, { title: 'Payments', key: 'paymentCount' }, { title: 'Total received', key: 'totalAmount', money: true },
          ],
          rows,
          totals: { name: `Total (${rows.length})`, totalAmount: sum(rows, (r) => r.totalAmount) },
        }],
      };
    },
  },
  {
    key: 'documents-register', group: 'audit', title: 'Supporting Documents Register', needs: ['documents'], filters: ['docType'],
    build: ({ documents }, ctx) => {
      const rows = documents.filter((d) => d.status !== 'archived' && (!ctx.filters.docType || d.docType === ctx.filters.docType))
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
      return {
        sections: [{
          columns: [
            { title: 'Uploaded', key: 'at', value: (r) => fmtDateTime(r.createdAt) }, { title: 'Type', key: 'docType' }, { title: 'File', key: 'name', width: 2 },
            { title: 'Linked to', key: 'link', value: (r) => `${r.linkedType} ${r.linkedRef || ''}` }, { title: 'By', key: 'createdByName' }, { title: 'URL', key: 'url', width: 2 },
          ],
          rows,
        }],
      };
    },
  },
  {
    key: 'audit-trail', group: 'audit', title: 'Audit Trail', needs: ['auditLogs'], filters: ['dates'],
    build: ({ auditLogs }) => ({
      sections: [{
        columns: [
          { title: 'When', key: 'at', value: (r) => fmtDateTime(r.at) }, { title: 'User', key: 'userName' }, { title: 'Role', key: 'role' },
          { title: 'Module', key: 'collection' }, { title: 'Ref', key: 'ref' }, { title: 'Action', key: 'action' },
          { title: 'Changes', key: 'ch', width: 3, value: (r) => (r.changes || []).map((c) => `${c.field}: ${JSON.stringify(c.old)} → ${JSON.stringify(c.new)}`).join('; ') },
          { title: 'Reason / summary', key: 'reason', width: 2, value: (r) => [r.summary, r.reason].filter(Boolean).join(' – ') },
        ],
        rows: auditLogs,
      }],
    }),
  },
];

export const reportByKey = (key) => REPORTS.find((r) => r.key === key);

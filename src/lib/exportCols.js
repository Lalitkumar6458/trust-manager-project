import { fmtDate } from './format';

export const donationExportCols = [
  { title: 'Date', key: 'date', value: (r) => fmtDate(r.date) },
  { title: 'Receipt No.', key: 'receiptNo' },
  { title: 'Donor', key: 'donor', value: (r) => r.donor?.name, width: 2 },
  { title: 'Donor Type', key: 'donorType', value: (r) => r.donor?.donorType },
  { title: 'Mobile', key: 'mobile', value: (r) => r.donor?.mobile },
  { title: 'PAN', key: 'pan', value: (r) => r.donor?.pan },
  { title: 'Category', key: 'cats', value: (r) => (r.lines || []).map((l) => l.categoryName).join(', '), width: 2 },
  { title: 'Purpose', key: 'purpose' },
  { title: 'Mode', key: 'paymentMode' },
  { title: 'Account', key: 'accountName' },
  { title: 'UTR / Cheque', key: 'ref', value: (r) => r.utr || r.chequeNo || '' },
  { title: 'Status', key: 'status' },
  { title: 'Amount', key: 'amount', money: true },
];

export const expenseExportCols = [
  { title: 'Date', key: 'date', value: (r) => fmtDate(r.date) },
  { title: 'Voucher No.', key: 'voucherNo' },
  { title: 'Paid To', key: 'payee', value: (r) => r.payee?.name, width: 2 },
  { title: 'Payee Type', key: 'payeeType', value: (r) => r.payee?.type },
  { title: 'PAN / GST', key: 'pan', value: (r) => [r.payee?.pan, r.payee?.gstin].filter(Boolean).join(' / ') },
  { title: 'Category', key: 'categoryName' },
  { title: 'Purpose', key: 'purpose', width: 2 },
  { title: 'Fund / Project', key: 'projectName' },
  { title: 'Mode', key: 'paymentMode' },
  { title: 'Account', key: 'accountName' },
  { title: 'UTR / Cheque', key: 'ref', value: (r) => r.utr || r.chequeNo || r.cashRef || '' },
  { title: 'Bill No.', key: 'billNo' },
  { title: 'Status', key: 'status' },
  { title: 'Amount', key: 'amount', money: true },
];

export const ledgerExportCols = [
  { title: 'Date', key: 'date', value: (r) => fmtDate(r.date) },
  { title: 'Account', key: 'accountName' },
  { title: 'Type', key: 'type' },
  { title: 'Reference', key: 'reference' },
  { title: 'Party', key: 'partyName' },
  { title: 'Description', key: 'description', width: 2.5 },
  { title: 'Credit (In)', key: 'credit', money: true },
  { title: 'Debit (Out)', key: 'debit', money: true },
  { title: 'Balance', key: 'balance', money: true },
];

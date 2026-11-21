'use client';

import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import Papa from 'papaparse';
import { COL } from '@/lib/constants';
import { fyIdOf, round2 } from '@/lib/format';
import { rpc } from '@/lib/api';

dayjs.extend(customParseFormat);

// ---------------- File parsing ----------------
export async function parseStatementFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = await file.text();
    const res = Papa.parse(text, { skipEmptyLines: true });
    return res.data.map((r) => r.map((c) => String(c ?? '').trim()));
  }
  if (name.endsWith('.xlsx')) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      for (let i = 1; i <= ws.columnCount; i += 1) {
        const v = row.getCell(i).value;
        if (v instanceof Date) vals.push(dayjs(v).format('YYYY-MM-DD'));
        else if (v && typeof v === 'object' && 'result' in v) vals.push(String(v.result ?? ''));
        else if (v && typeof v === 'object' && 'text' in v) vals.push(String(v.text ?? ''));
        else vals.push(String(v ?? '').trim());
      }
      rows.push(vals);
    });
    return rows;
  }
  throw new Error('Upload a .csv or .xlsx file (convert .xls to .xlsx first)');
}

// Indian bank exports are day-first. MM/DD is deliberately NOT guessed.
const DATE_FORMATS = ['DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'DD/MM/YY', 'DD-MM-YY', 'YYYY-MM-DD', 'DD MMM YYYY', 'DD-MMM-YYYY', 'DD-MMM-YY', 'DD MMM YY', 'D/M/YYYY', 'D-M-YYYY'];

export function parseDate(s) {
  if (!s) return null;
  // drop a time part: "05-04-2026 10:31:22", "2026-04-05T10:31", "05/04/2026 10:31 AM"
  const str = String(s).trim().replace(/[T\s]+\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(AM|PM)?(Z|[+-]\d{2}:?\d{2})?$/i, '').trim();
  // eslint-disable-next-line no-restricted-syntax
  for (const f of DATE_FORMATS) {
    const d = dayjs(str, f, true);
    if (d.isValid()) return d.format('YYYY-MM-DD');
  }
  return null;
}

export const parseAmount = (s) => {
  if (s === null || s === undefined) return 0;
  const str = String(s).replace(/[₹,\s]/g, '').replace(/(Cr|Dr)$/i, '');
  const n = parseFloat(str);
  return Number.isFinite(n) ? Math.abs(round2(n)) : 0;
};

/** Guess column indexes from header row (exact names first, then whole words – "cr" must not match "description") */
export function guessMapping(header = []) {
  const h = header.map((x) => String(x).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim());
  const taken = new Set();
  const find = (...keys) => {
    const pick = (fn) => {
      // eslint-disable-next-line no-restricted-syntax
      for (const k of keys) {
        const i = h.findIndex((c, idx) => !taken.has(idx) && fn(c, k));
        if (i >= 0) { taken.add(i); return i; }
      }
      return -1;
    };
    const words = (c, k) => new RegExp(`(^| )${k}( |$)`).test(c);
    let i = pick((c, k) => c === k);
    if (i < 0) i = pick(words);
    if (i < 0) i = pick((c, k) => k.length > 3 && c.includes(k));
    return i;
  };
  const date = find('txn date', 'tran date', 'transaction date', 'date', 'posting date', 'value date');
  const description = find('narration', 'description', 'particulars', 'particular', 'remarks', 'details');
  const debit = find('withdrawal amt', 'withdrawal amount', 'withdrawal', 'withdrawals', 'debit amount', 'debit', 'dr amount', 'dr');
  const credit = find('deposit amt', 'deposit amount', 'deposit', 'deposits', 'credit amount', 'credit', 'cr amount', 'cr');
  const balance = find('closing balance', 'balance', 'bal');
  const reference = find('chq ref no', 'ref no cheque no', 'cheque no', 'chq no', 'ref no', 'reference', 'utr', 'chq', 'cheque', 'ref');
  return { date, description, reference, debit, credit, balance };
}

export function mapRows(rows, mapping, headerRowIndex = 0) {
  return rows.slice(headerRowIndex + 1).map((r) => ({
    date: parseDate(r[mapping.date]),
    description: r[mapping.description] || '',
    reference: mapping.reference >= 0 ? r[mapping.reference] || '' : '',
    debit: mapping.debit >= 0 ? parseAmount(r[mapping.debit]) : 0,
    credit: mapping.credit >= 0 ? parseAmount(r[mapping.credit]) : 0,
    balance: mapping.balance >= 0 ? parseAmount(r[mapping.balance]) : null,
  })).filter((r) => r.date && (r.debit || r.credit));
}

// ---------------- Save + match (server) ----------------
export const saveStatement = ({ account, fileName, lines, openingBalance, closingBalance }) => rpc('rec.saveStatement', {
  accountId: account.id, fileName, lines, openingBalance, closingBalance,
});
export const autoMatch = (statementId) => rpc('rec.autoMatch', statementId);
export const manualMatch = ({ statementId, lineId, txnId }) => rpc('rec.manualMatch', { statementId, lineId, txnId });
export const unmatch = ({ statementId, line }) => rpc('rec.unmatch', { statementId, lineId: line.id });
export const setIgnored = ({ statementId, line, ignored, reason }) => rpc('rec.setIgnored', { statementId, lineId: line.id, ignored, reason });

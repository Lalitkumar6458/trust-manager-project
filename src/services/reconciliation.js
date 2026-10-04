'use client';

import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import Papa from 'papaparse';
import { COL } from '@/lib/constants';
import { fyIdOf, round2 } from '@/lib/format';
import {
  colRef, doc, docRef, db, writeBatch, serverTimestamp, createdStamp, writeAudit, fetchAll, where, chunkedBatch, increment,
  fetchOne, runTransaction,
} from './db';

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

// ---------------- Save + match ----------------
export async function saveStatement({ account, fileName, lines, openingBalance, closingBalance, user }) {
  if (!lines.length) throw new Error('No valid lines found');
  const dates = lines.map((l) => l.date).sort();
  const stRef = doc(colRef(COL.bankStatements));
  const periodTo = dates[dates.length - 1];
  const ops = [];
  ops.push((b) => b.set(stRef, {
    accountId: account.id,
    accountName: account.name,
    fileName,
    periodFrom: dates[0],
    periodTo,
    financialYearId: fyIdOf(periodTo),
    openingBalance: openingBalance ?? null,
    // banks export newest-first or oldest-first: take the balance of the LATEST dated line
    closingBalance: closingBalance ?? [...lines].map((l, i) => ({ ...l, i })).sort((a, b) => (a.date === b.date ? a.i - b.i : a.date.localeCompare(b.date))).pop()?.balance ?? null,
    lineCount: lines.length,
    matchedCount: 0,
    ignoredCount: 0,
    ...createdStamp(user),
  }));
  lines.forEach((l, i) => {
    const ref = doc(colRef(COL.statementLines));
    ops.push((b) => b.set(ref, { ...l, statementId: stRef.id, accountId: account.id, seq: i, status: 'unmatched', matchedTxnId: null, matchType: null }));
  });
  ops.push((b) => writeAudit(b, user, { collection: COL.bankStatements, docId: stRef.id, ref: fileName, action: 'import', summary: `${lines.length} lines imported for ${account.name}` }));
  await chunkedBatch(ops);
  return stRef.id;
}

const refMatch = (line, t) => {
  const hay = `${line.reference} ${line.description}`.toLowerCase();
  return [t.utr, t.chequeNo, t.reference].filter((x) => x && String(x).length >= 4).some((x) => hay.includes(String(x).toLowerCase()));
};

/**
 * Auto match: same account, same amount & direction, date within ±5 days.
 * Reference/UTR match is preferred, then nearest date.
 */
export async function autoMatch(statementId, user) {
  const st = await fetchOne(COL.bankStatements, statementId);
  if (!st) throw new Error('Statement not found');
  const lines = (await fetchAll(COL.statementLines, where('statementId', '==', statementId))).filter((l) => l.status === 'unmatched');
  const from = dayjs(st.periodFrom).subtract(7, 'day').format('YYYY-MM-DD');
  const to = dayjs(st.periodTo).add(7, 'day').format('YYYY-MM-DD');
  const txns = (await fetchAll(COL.transactions, where('accountId', '==', st.accountId), where('date', '>=', from), where('date', '<=', to)))
    .filter((t) => !t.reconciled);
  const used = new Set();
  const matches = [];
  lines.forEach((l) => {
    const isIn = l.credit > 0;
    const amt = isIn ? l.credit : l.debit;
    const cands = txns.filter((t) => !used.has(t.id)
      && Math.abs((isIn ? t.credit : t.debit) - amt) < 0.01
      && Math.abs(dayjs(t.date).diff(dayjs(l.date), 'day')) <= 5);
    if (!cands.length) return;
    cands.sort((a, b) => {
      const ra = refMatch(l, a) ? 0 : 1;
      const rb = refMatch(l, b) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return Math.abs(dayjs(a.date).diff(l.date, 'day')) - Math.abs(dayjs(b.date).diff(l.date, 'day'));
    });
    used.add(cands[0].id);
    matches.push({ line: l, txn: cands[0] });
  });
  const ops = [];
  matches.forEach(({ line, txn }) => {
    ops.push((b) => b.update(docRef(COL.statementLines, line.id), { status: 'matched', matchedTxnId: txn.id, matchType: 'auto', matchedAt: serverTimestamp() }));
    ops.push((b) => b.update(docRef(COL.transactions, txn.id), { reconciled: true, statementLineId: line.id, reconciledAt: serverTimestamp() }));
  });
  if (matches.length) {
    ops.push((b) => b.update(docRef(COL.bankStatements, statementId), { matchedCount: increment(matches.length) }));
    ops.push((b) => writeAudit(b, user, { collection: COL.bankStatements, docId: statementId, ref: st.fileName, action: 'auto_match', summary: `${matches.length} lines auto-matched` }));
  }
  await chunkedBatch(ops);
  return matches.length;
}

export async function manualMatch({ statementId, lineId, txnId, user }) {
  // transaction: two users (or auto + manual) can never match the same line / ledger entry twice
  await runTransaction(db, async (tx) => {
    const [ls, ts] = await Promise.all([tx.get(docRef(COL.statementLines, lineId)), tx.get(docRef(COL.transactions, txnId))]);
    if (!ls.exists() || ls.data().status !== 'unmatched') throw new Error('This statement line is already matched or ignored');
    if (!ts.exists() || ts.data().reconciled) throw new Error('This ledger entry is already reconciled');
    tx.update(docRef(COL.statementLines, lineId), { status: 'matched', matchedTxnId: txnId, matchType: 'manual', matchedAt: serverTimestamp() });
    tx.update(docRef(COL.transactions, txnId), { reconciled: true, statementLineId: lineId, reconciledAt: serverTimestamp() });
    tx.update(docRef(COL.bankStatements, statementId), { matchedCount: increment(1) });
    writeAudit(tx, user, { collection: COL.statementLines, docId: lineId, action: 'manual_match', summary: `Matched to ledger ${txnId}` });
  });
}

export async function unmatch({ statementId, line, user }) {
  const b = writeBatch(db);
  b.update(docRef(COL.statementLines, line.id), { status: 'unmatched', matchedTxnId: null, matchType: null });
  if (line.matchedTxnId) b.update(docRef(COL.transactions, line.matchedTxnId), { reconciled: false, statementLineId: null });
  b.update(docRef(COL.bankStatements, statementId), { matchedCount: increment(-1) });
  writeAudit(b, user, { collection: COL.statementLines, docId: line.id, action: 'unmatch' });
  await b.commit();
}

export async function setIgnored({ statementId, line, ignored, reason, user }) {
  const b = writeBatch(db);
  b.update(docRef(COL.statementLines, line.id), { status: ignored ? 'ignored' : 'unmatched', ignoreReason: reason || '' });
  b.update(docRef(COL.bankStatements, statementId), { ignoredCount: increment(ignored ? 1 : -1) });
  writeAudit(b, user, { collection: COL.statementLines, docId: line.id, action: ignored ? 'ignore' : 'unignore', reason });
  await b.commit();
}

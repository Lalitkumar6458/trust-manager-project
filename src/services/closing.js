'use client';

import dayjs from 'dayjs';
import { COL } from '@/lib/constants';
import { fyMonths, fyRange, nextFyId, round2 } from '@/lib/format';
import {
  docRef, db, runTransaction, serverTimestamp, writeAudit, fetchAll, fetchOne, where, writeNotification, writeBatch,
} from './db';
import { fetchFyTransactions } from './ledger';
import { periodSummary } from './accounting';

const prevFyIdOf = (fyId) => { const y = Number(fyId.slice(0, 4)) - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; };

/**
 * Per-account carry-forward patch (dotted keys, so accounts opened IN the next
 * year keep the opening balance they were created with).
 */
function carryPatch(closing, accounts, nextId, field = 'openingBalances') {
  const patch = {};
  accounts.forEach((a) => {
    if (a.openingFyId && a.openingFyId >= nextId) return; // opened in the next year (or later)
    patch[`${field}.${a.id}`] = round2(closing[a.id] || 0);
  });
  return patch;
}

/** Closing balances of a year as they stand now (used for provisional openings) */
async function liveClosing(fyDoc, accounts) {
  const txns = await fetchFyTransactions(fyDoc.id);
  return periodSummary({ fy: fyDoc, accounts, txns }).closing;
}

/** Pending (not final) donations / expenses in a period */
export async function pendingItems({ monthKey, fyId }) {
  const field = monthKey ? 'monthKey' : 'financialYearId';
  const value = monthKey || fyId;
  const [dons, exps] = await Promise.all([
    fetchAll(COL.donations, where(field, '==', value)),
    fetchAll(COL.expenses, where(field, '==', value)),
  ]);
  return {
    donations: dons.filter((d) => ['draft', 'submitted', 'verified'].includes(d.status)),
    expenses: exps.filter((e) => ['draft', 'submitted', 'approved'].includes(e.status)),
    donationCount: dons.filter((d) => d.status === 'approved').length,
    expenseCount: exps.filter((e) => e.status === 'paid').length,
  };
}

export async function computeMonth(monthKey, fy, accounts) {
  const txns = await fetchFyTransactions(fy.id);
  const from = `${monthKey}-01`;
  const to = dayjs(from).endOf('month').format('YYYY-MM-DD');
  return periodSummary({ fy, accounts, txns, from, to });
}

export async function closeMonth({ monthKey, fy, accounts, user, notes }) {
  if (fy.openingProvisional) {
    throw new Error(`Opening balances of FY ${fy.id} are provisional until FY ${prevFyIdOf(fy.id)} is closed. Close FY ${prevFyIdOf(fy.id)} first, then close the months of this year.`);
  }
  const months = fyMonths(fy.id);
  const idx = months.indexOf(monthKey);
  if (idx < 0) throw new Error('Month does not belong to the selected FY');
  if (dayjs(`${monthKey}-01`).isAfter(dayjs(), 'month')) throw new Error('Future months cannot be closed');
  const pend = await pendingItems({ monthKey });
  if (pend.donations.length || pend.expenses.length) {
    throw new Error(`Cannot close: ${pend.donations.length} donation(s) and ${pend.expenses.length} expense(s) are still pending (draft / submitted / verified / unpaid). Complete or void them first.`);
  }
  const summary = await computeMonth(monthKey, fy, accounts);
  return runTransaction(db, async (tx) => {
    if (idx > 0) {
      const prev = await tx.get(docRef(COL.monthlyClosings, months[idx - 1]));
      if (!prev.exists() || prev.data().status !== 'closed') throw new Error(`Close ${dayjs(`${months[idx - 1]}-01`).format('MMMM YYYY')} first`);
    }
    const ref = docRef(COL.monthlyClosings, monthKey);
    const cur = await tx.get(ref);
    if (cur.exists() && cur.data().status === 'closed') throw new Error('Month already closed');
    tx.set(ref, {
      monthKey,
      financialYearId: fy.id,
      status: 'closed',
      donationTotal: summary.totals.donation,
      donationCount: pend.donationCount,
      expenseTotal: round2(summary.totals.expense + summary.totals.bankCharges),
      expenseCount: pend.expenseCount,
      otherIncome: summary.totals.otherIncome,
      adjustment: summary.totals.adjustment,
      openingTotal: summary.openingTotal,
      closingBank: summary.closingBank,
      closingCash: summary.closingCash,
      closingTotal: summary.closingTotal,
      accountClosing: summary.closing,
      notes: notes || '',
      closedBy: user.uid,
      closedByName: user.name,
      closedAt: serverTimestamp(),
      history: [...(cur.exists() ? cur.data().history || [] : []), { action: 'closed', by: user.name, at: new Date().toISOString(), note: notes || '' }],
    });
    writeAudit(tx, user, { collection: COL.monthlyClosings, docId: monthKey, ref: monthKey, action: 'close', summary: `Month ${monthKey} closed. Closing ₹${summary.closingTotal}` });
    writeNotification(tx, { type: 'month_closed', title: `Monthly closing done – ${dayjs(`${monthKey}-01`).locale('en').format('MMM YYYY')}`, message: `Closing balance ₹${summary.closingTotal}`, link: '/monthly-closing', roles: ['superAdmin', 'accountant', 'auditor'] });
  });
}

export async function reopenMonth({ monthKey, fy, user, reason }) {
  if (!reason) throw new Error('Reason is required');
  const months = fyMonths(fy.id);
  const idx = months.indexOf(monthKey);
  return runTransaction(db, async (tx) => {
    if (idx < months.length - 1) {
      const next = await tx.get(docRef(COL.monthlyClosings, months[idx + 1]));
      if (next.exists() && next.data().status === 'closed') throw new Error('Reopen the later month first (months are closed in sequence)');
    }
    const fyS = await tx.get(docRef(COL.financialYears, fy.id));
    if (fyS.data()?.status !== 'open') throw new Error('Financial year is not open');
    const ref = docRef(COL.monthlyClosings, monthKey);
    const cur = await tx.get(ref);
    tx.update(ref, {
      status: 'open',
      reopenedBy: user.uid,
      reopenedByName: user.name,
      reopenedAt: serverTimestamp(),
      history: [...(cur.data()?.history || []), { action: 'reopened', by: user.name, at: new Date().toISOString(), note: reason }],
    });
    writeAudit(tx, user, { collection: COL.monthlyClosings, docId: monthKey, ref: monthKey, action: 'reopen', reason });
  });
}

// ------------------------------------------------------------------
// Financial year
// ------------------------------------------------------------------
export async function createFinancialYear(fyId, user, { openingBalances = {}, makeCurrent = false, accounts = [] } = {}) {
  const { start, end } = fyRange(fyId);
  // previous year still open → provisional opening = its closing as of now (replaced when it is closed)
  let opening = { ...openingBalances };
  let provisional = false;
  const prevId = prevFyIdOf(fyId);
  const prev = await fetchOne(COL.financialYears, prevId);
  if (prev && prev.status === 'open' && accounts.length) {
    const closing = await liveClosing(prev, accounts);
    accounts.forEach((a) => { if (!(a.openingFyId && a.openingFyId >= fyId)) opening[a.id] = round2(closing[a.id] || 0); });
    provisional = true;
  } else if (prev && prev.closingBalances && Object.keys(prev.closingBalances).length) {
    opening = { ...prev.closingBalances, ...opening };
  }
  return runTransaction(db, async (tx) => {
    const ref = docRef(COL.financialYears, fyId);
    const s = await tx.get(ref);
    if (s.exists()) throw new Error(`FY ${fyId} already exists`);
    tx.set(ref, {
      label: `FY ${fyId}`,
      startDate: start,
      endDate: end,
      status: 'open',
      isCurrent: makeCurrent,
      openingBalances: opening,
      openingProvisional: provisional,
      ...(prev && prev.status !== 'open' ? { openingCarriedFrom: prevId } : {}),
      closingBalances: {},
      assets: [],
      liabilities: [],
      audit: { status: 'draft', auditorName: '', firmName: '', membershipNo: '', notes: '', udin: '' },
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
    writeAudit(tx, user, { collection: COL.financialYears, docId: fyId, ref: fyId, action: 'create' });
  });
}

export async function setCurrentFy(fyId, fys, user) {
  const batch = writeBatch(db);
  fys.filter((f) => !!f.isCurrent !== (f.id === fyId)).forEach((f) => batch.update(docRef(COL.financialYears, f.id), { isCurrent: f.id === fyId }));
  writeAudit(batch, user, { collection: COL.financialYears, docId: fyId, ref: fyId, action: 'set_current' });
  await batch.commit();
}

/** Year-end checklist used by the FY closing wizard */
export async function fyChecklist(fy) {
  const months = fyMonths(fy.id);
  const [closings, pend, statements, docs] = await Promise.all([
    fetchAll(COL.monthlyClosings, where('financialYearId', '==', fy.id)),
    pendingItems({ fyId: fy.id }),
    fetchAll(COL.bankStatements, where('financialYearId', '==', fy.id)),
    fetchAll(COL.documents, where('financialYearId', '==', fy.id)),
  ]);
  const closed = new Set(closings.filter((c) => c.status === 'closed').map((c) => c.monthKey));
  const openMonths = months.filter((m) => !closed.has(m));
  const unreconciled = statements.reduce((s, st) => s + Math.max(0, (st.lineCount || 0) - (st.matchedCount || 0) - (st.ignoredCount || 0)), 0);
  const auditDocs = docs.filter((d) => d.docType === 'Audit Document' && d.status !== 'archived').length;
  return [
    { key: 'pending', label: 'All transactions verified / approved / paid', ok: !pend.donations.length && !pend.expenses.length, detail: `${pend.donations.length} donation(s), ${pend.expenses.length} expense(s) pending`, critical: true },
    { key: 'months', label: 'All 12 months closed (monthly closing)', ok: openMonths.length === 0, detail: openMonths.length ? `Open: ${openMonths.map((m) => dayjs(`${m}-01`).format('MMM YY')).join(', ')}` : 'All closed', critical: true },
    { key: 'recon', label: 'Bank reconciliation completed', ok: statements.length > 0 && unreconciled === 0, detail: statements.length ? `${unreconciled} unmatched statement line(s)` : 'No bank statement uploaded for this FY', critical: false },
    { key: 'cash', label: 'Cash balance physically verified', ok: !!fy.cashVerified, detail: fy.cashVerified ? `Verified by ${fy.cashVerifiedBy || ''}` : 'Tick after physical cash count', critical: false, manual: true },
    { key: 'docs', label: 'Audit documents uploaded', ok: auditDocs > 0, detail: `${auditDocs} audit document(s)`, critical: false },
  ];
}

/**
 * Close a financial year: compute closing balance of every account and carry
 * it forward as the opening balance of the next FY (created if missing).
 */
export async function closeFinancialYear({ fy, accounts, user, override }) {
  const checks = await fyChecklist(fy);
  const failedCritical = checks.filter((c) => c.critical && !c.ok);
  if (failedCritical.length) throw new Error(`Cannot close FY: ${failedCritical.map((c) => c.label).join('; ')}`);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length && !override) throw new Error(`Checklist incomplete: ${failed.map((c) => c.label).join('; ')}`);

  const txns = await fetchFyTransactions(fy.id);
  const summary = periodSummary({ fy, accounts, txns });
  const nextId = nextFyId(fy.id);
  const { start, end } = fyRange(nextId);
  return runTransaction(db, async (tx) => {
    const fyRef = docRef(COL.financialYears, fy.id);
    const nextRef = docRef(COL.financialYears, nextId);
    const [cur, nxt] = await Promise.all([tx.get(fyRef), tx.get(nextRef)]);
    if (cur.data().status !== 'open') throw new Error('FY is not open');
    tx.update(fyRef, {
      status: 'closed',
      closingBalances: summary.closing,
      closingTotal: summary.closingTotal,
      totals: summary.totals,
      closedBy: user.uid,
      closedByName: user.name,
      closedAt: serverTimestamp(),
      checklist: checks.map((c) => ({ key: c.key, ok: c.ok, detail: c.detail })),
    });
    if (nxt.exists()) {
      if (nxt.data().status === 'finalized') throw new Error(`FY ${nextId} is finalized`);
      tx.update(nextRef, { ...carryPatch(summary.closing, accounts, nextId), openingCarriedFrom: fy.id, openingProvisional: false });
    } else {
      const opening = {};
      Object.entries(carryPatch(summary.closing, accounts, nextId)).forEach(([k, v]) => { opening[k.split('.')[1]] = v; });
      tx.set(nextRef, {
        label: `FY ${nextId}`, startDate: start, endDate: end, status: 'open', isCurrent: false,
        openingBalances: opening, openingCarriedFrom: fy.id, openingProvisional: false, closingBalances: {}, assets: fy.assets || [], liabilities: fy.liabilities || [],
        audit: { status: 'draft' }, createdBy: user.uid, createdAt: serverTimestamp(),
      });
    }
    writeAudit(tx, user, { collection: COL.financialYears, docId: fy.id, ref: fy.id, action: 'close', summary: `FY closed. Closing ₹${summary.closingTotal} carried to ${nextId}`, reason: override ? 'Closed with non-critical checklist items pending' : '' });
    writeNotification(tx, { type: 'fy_closed', title: `FY ${fy.id} closed`, message: `Closing balance ₹${summary.closingTotal} carried forward to FY ${nextId}. Audit pending.`, link: '/audit', roles: ['superAdmin', 'accountant', 'auditor'] });
  });
}

/** Recalculate carry-forward after a Super-Admin correction in a closed (not finalized) year */
export async function recalcCarryForward({ fy, accounts, user }) {
  const txns = await fetchFyTransactions(fy.id);
  const summary = periodSummary({ fy, accounts, txns });
  const nextId = nextFyId(fy.id);
  const next = await fetchOne(COL.financialYears, nextId);
  if (next?.status === 'finalized') throw new Error(`FY ${nextId} is finalized – its opening balances cannot change`);
  const batch = writeBatch(db);
  batch.update(docRef(COL.financialYears, fy.id), { closingBalances: summary.closing, closingTotal: summary.closingTotal, totals: summary.totals });
  if (next) batch.update(docRef(COL.financialYears, nextId), carryPatch(summary.closing, accounts, nextId));
  writeAudit(batch, user, { collection: COL.financialYears, docId: fy.id, ref: fy.id, action: 'recalculate', summary: `Closing recalculated ₹${summary.closingTotal}` });
  await batch.commit();
  // keep account current balances consistent: current = next FY opening + next FY movements
  return summary;
}

export async function reopenFinancialYear({ fy, user, reason }) {
  if (!reason) throw new Error('Reason is required');
  if (fy.status === 'finalized') throw new Error('A finalized year cannot be reopened');
  const next = await fetchOne(COL.financialYears, nextFyId(fy.id));
  if (next?.status === 'finalized') throw new Error(`FY ${next.id} is finalized – FY ${fy.id} can no longer be reopened`);
  const batch = writeBatch(db);
  batch.update(docRef(COL.financialYears, fy.id), { status: 'open', reopenedBy: user.uid, reopenedAt: serverTimestamp(), reopenReason: reason });
  writeAudit(batch, user, { collection: COL.financialYears, docId: fy.id, ref: fy.id, action: 'reopen', reason });
  await batch.commit();
}

export async function updateAudit({ fy, patch, user, reason }) {
  const batch = writeBatch(db);
  const next = { ...(fy.audit || {}), ...patch };
  const update = { audit: next };
  if (patch.status === 'finalized') {
    if (fy.status !== 'closed') throw new Error('Close the financial year before finalizing the audit');
    update.status = 'finalized';
    update.finalizedBy = user.uid;
    update.finalizedByName = user.name;
    update.finalizedAt = serverTimestamp();
  }
  batch.update(docRef(COL.financialYears, fy.id), update);
  writeAudit(batch, user, {
    collection: COL.financialYears, docId: fy.id, ref: fy.id, action: patch.status ? 'audit_status' : 'audit_update', reason,
    changes: Object.keys(patch).map((k) => ({ field: `audit.${k}`, old: fy.audit?.[k] ?? null, new: patch[k] })),
  });
  if (patch.status === 'under_review') {
    writeNotification(batch, { type: 'audit_pending', title: `Audit pending – FY ${fy.id}`, message: 'Financial year sent for audit review', link: '/audit', roles: ['auditor', 'superAdmin', 'accountant'] });
  }
  await batch.commit();
}

export async function saveFyFields({ fy, patch, user }) {
  const batch = writeBatch(db);
  batch.update(docRef(COL.financialYears, fy.id), patch);
  writeAudit(batch, user, { collection: COL.financialYears, docId: fy.id, ref: fy.id, action: 'update', changes: Object.keys(patch).map((k) => ({ field: k, old: fy[k] ?? null, new: patch[k] })) });
  await batch.commit();
}

/** Recompute a provisional opening (previous year still open) – Super Admin */
export async function refreshProvisionalOpening({ fy, fys, accounts, user }) {
  const prevId = prevFyIdOf(fy.id);
  const prev = fys.find((f) => f.id === prevId);
  if (!prev) throw new Error(`FY ${prevId} does not exist – enter opening balances on the accounts instead`);
  if (prev.status !== 'open') throw new Error(`FY ${prevId} is already closed – use “Recalculate carry-forward” on it`);
  const closing = await liveClosing(prev, accounts);
  const batch = writeBatch(db);
  batch.update(docRef(COL.financialYears, fy.id), { ...carryPatch(closing, accounts, fy.id), openingProvisional: true });
  writeAudit(batch, user, { collection: COL.financialYears, docId: fy.id, ref: fy.id, action: 'opening_refresh', summary: `Provisional opening refreshed from FY ${prevId}` });
  await batch.commit();
}

export { prevFyIdOf };

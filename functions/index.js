// Optional Cloud Functions (require the Firebase Blaze plan).
// The web panel works fully without them; these add:
//  1. audit*           – tamper-proof server-side mirror of every financial change
//  2. monthlyReport    – auto-generates last month's report on the 1st (IST) + notification
//  3. dailyPendingDigest – daily reminder of pending verification / approval / reconciliation
//  4. ensureNextFy     – creates next financial year in March (so entries work from 1 April)
// Region: v2 Firestore triggers must run in the SAME region as your Firestore database.
// Set FUNCTIONS_REGION in functions/.env (e.g. asia-south1, or nam5 → us-central1).

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: process.env.FUNCTIONS_REGION || 'asia-south1', maxInstances: 5 });

const IGNORE = new Set(['updatedAt', 'searchKeywords', 'workflow', 'createdAt', 'updatedBy', 'updatedByName', 'lastTxnId']);
const plain = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v);

function diff(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out = [];
  keys.forEach((k) => {
    if (IGNORE.has(k)) return;
    const a = plain(before[k]);
    const b = plain(after[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: k, old: a ?? null, new: b ?? null });
  });
  return out;
}

async function mirror(coll, event) {
  const { docId } = event.params;
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  const action = !before ? 'create' : !after ? 'delete' : 'update';
  const changes = diff(before || {}, after || {});
  if (action === 'update' && !changes.length) return;
  await db.collection('serverAuditLogs').add({
    collection: coll,
    docId,
    action,
    ref: after?.receiptNo || after?.voucherNo || after?.reference || after?.name || docId,
    changes: JSON.parse(JSON.stringify(changes)).slice(0, 80),
    by: after?.updatedBy || after?.createdBy || null,
    byName: after?.updatedByName || after?.createdByName || null,
    at: FieldValue.serverTimestamp(),
  });
}

// one trigger per financial collection (avoids firing on notifications / logs)
export const auditDonations = onDocumentWritten('donations/{docId}', (e) => mirror('donations', e));
export const auditExpenses = onDocumentWritten('expenses/{docId}', (e) => mirror('expenses', e));
export const auditTransactions = onDocumentWritten('transactions/{docId}', (e) => mirror('transactions', e));
export const auditAccounts = onDocumentWritten('accounts/{docId}', (e) => mirror('accounts', e));
export const auditFinancialYears = onDocumentWritten('financialYears/{docId}', (e) => mirror('financialYears', e));
export const auditMonthlyClosings = onDocumentWritten('monthlyClosings/{docId}', (e) => mirror('monthlyClosings', e));
export const auditUsers = onDocumentWritten('users/{docId}', (e) => mirror('users', e));
export const auditDonors = onDocumentWritten('donors/{docId}', (e) => mirror('donors', e));
export const auditBeneficiaries = onDocumentWritten('beneficiaries/{docId}', (e) => mirror('beneficiaries', e));
export const auditFunds = onDocumentWritten('funds/{docId}', (e) => mirror('funds', e));
export const auditRoles = onDocumentWritten('roles/{docId}', (e) => mirror('roles', e));
export const auditSettings = onDocumentWritten('settings/{docId}', (e) => mirror('settings', e));
export const auditDocuments = onDocumentWritten('documents/{docId}', (e) => mirror('documents', e));

// ---------- helpers for reports ----------
const pad = (n) => String(n).padStart(2, '0');
function fyIdOf(y, m) { // m = 1..12
  const start = m >= 4 ? y : y - 1;
  return `${start}-${pad((start + 1) % 100)}`;
}
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// "perm:<key>" tags let custom-role users with that permission see the notification too
const NOTIFY_PERM = { monthly_report: 'reports.view', pending_digest: 'donations.verify', recon_pending: 'reconciliation.view', fy_created: 'fy.view' };
async function notify(type, title, message, link, roles = ['superAdmin', 'accountant', 'auditor']) {
  const tags = NOTIFY_PERM[type] ? [`perm:${NOTIFY_PERM[type]}`] : [];
  await db.collection('notifications').add({ type, title, message, link, roles: [...roles, ...tags], readBy: [], createdAt: FieldValue.serverTimestamp() });
}

export const monthlyReport = onSchedule({ schedule: '5 6 1 * *', timeZone: 'Asia/Kolkata' }, async () => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  let y = now.getFullYear();
  let m = now.getMonth(); // previous month (1..12 after adjust)
  if (m === 0) { m = 12; y -= 1; }
  const monthKey = `${y}-${pad(m)}`;
  const fyId = fyIdOf(y, m);

  const [txSnap, donSnap, expSnap] = await Promise.all([
    db.collection('transactions').where('monthKey', '==', monthKey).get(),
    db.collection('donations').where('monthKey', '==', monthKey).get(),
    db.collection('expenses').where('monthKey', '==', monthKey).get(),
  ]);
  const dons = donSnap.docs.map((d) => d.data()).filter((d) => d.status === 'approved');
  const exps = expSnap.docs.map((d) => d.data()).filter((e) => e.status === 'paid');
  const txns = txSnap.docs.map((d) => d.data());
  const byKey = (rows, key) => rows.reduce((acc, r) => { const k = key(r) || '—'; acc[k] = round2((acc[k] || 0) + (r.amount || 0)); return acc; }, {});

  const report = {
    monthKey,
    financialYearId: fyId,
    donationTotal: round2(dons.reduce((s, d) => s + d.amount, 0)),
    donationCount: dons.length,
    donationByCategory: byKey(dons.flatMap((d) => d.lines || []), (l) => l.categoryName),
    donationByMode: byKey(dons, (d) => d.paymentMode),
    expenseTotal: round2(exps.reduce((s, e) => s + e.amount, 0)),
    expenseCount: exps.length,
    expenseByCategory: byKey(exps, (e) => e.categoryName),
    expenseByMode: byKey(exps, (e) => e.paymentMode),
    totalIn: round2(txns.reduce((s, t) => s + (t.credit || 0), 0)),
    totalOut: round2(txns.reduce((s, t) => s + (t.debit || 0), 0)),
    generatedAt: FieldValue.serverTimestamp(),
  };
  await db.collection('reports').doc(`monthly_${monthKey}`).set(report);
  await notify('monthly_report', `Monthly report generated – ${monthKey}`, `Donation ₹${report.donationTotal} (${dons.length}), expense ₹${report.expenseTotal} (${exps.length}). Please complete monthly closing.`, '/reports/monthly-financial');
});

export const dailyPendingDigest = onSchedule({ schedule: '0 9 * * *', timeZone: 'Asia/Kolkata' }, async () => {
  const [d1, d2, e1, e2, st] = await Promise.all([
    db.collection('donations').where('status', '==', 'submitted').count().get(),
    db.collection('donations').where('status', '==', 'verified').count().get(),
    db.collection('expenses').where('status', '==', 'submitted').count().get(),
    db.collection('expenses').where('status', '==', 'approved').count().get(),
    db.collection('bankStatements').where('financialYearId', '==', (() => { const n = new Date(); return fyIdOf(n.getFullYear(), n.getMonth() + 1); })()).get(),
  ]);
  const pendingDon = d1.data().count + d2.data().count;
  const pendingExp = e1.data().count + e2.data().count;
  const unrec = st.docs.map((d) => d.data()).reduce((s, x) => s + Math.max(0, (x.lineCount || 0) - (x.matchedCount || 0) - (x.ignoredCount || 0)), 0);
  if (pendingDon || pendingExp) {
    await notify('pending_digest', 'Pending verification / approval', `${pendingDon} donation(s) and ${pendingExp} expense(s) are waiting.`, '/dashboard', ['superAdmin', 'accountant']);
  }
  if (unrec) {
    await notify('recon_pending', 'Bank reconciliation pending', `${unrec} bank statement line(s) are not matched yet.`, '/reconciliation', ['superAdmin', 'accountant']);
  }
});

/**
 * Creates the NEXT financial year during March (runs daily 1–31 March, 01:15 IST) so that
 * entries dated 1 April can be saved. Opening balances are PROVISIONAL (previous year's
 * opening + its ledger so far) until the previous year is closed in the panel.
 */
export const ensureNextFy = onSchedule({ schedule: '15 1 * 3 *', timeZone: 'Asia/Kolkata' }, async () => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const curId = fyIdOf(now.getFullYear(), now.getMonth() + 1);
  const y = Number(curId.slice(0, 4)) + 1;
  const nextId = `${y}-${pad((y + 1) % 100)}`;
  const nextRef = db.collection('financialYears').doc(nextId);
  if ((await nextRef.get()).exists) return;
  const cur = await db.collection('financialYears').doc(curId).get();
  const opening = { ...(cur.exists ? cur.data().openingBalances || {} : {}) };
  const tx = await db.collection('transactions').where('financialYearId', '==', curId).get();
  tx.docs.forEach((d) => {
    const t = d.data();
    opening[t.accountId] = round2((opening[t.accountId] || 0) + (t.credit || 0) - (t.debit || 0));
  });
  await nextRef.create({
    label: `FY ${nextId}`, startDate: `${y}-04-01`, endDate: `${y + 1}-03-31`, status: 'open', isCurrent: false,
    openingBalances: opening, openingProvisional: true, closingBalances: {}, assets: [], liabilities: [],
    audit: { status: 'draft' }, createdBy: 'system', createdAt: FieldValue.serverTimestamp(),
  });
  await notify('fy_created', `FY ${nextId} created`, `Opening balances are provisional until FY ${curId} is closed.`, '/financial-years', ['superAdmin', 'accountant']);
});


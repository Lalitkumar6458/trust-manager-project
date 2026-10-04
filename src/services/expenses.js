'use client';

import { userCan } from '@/lib/permissions';
import { COL, isCashMode } from '@/lib/constants';
import { fyIdOf, monthKeyOf, round2, todayStr, sum } from '@/lib/format';
import { buildKeywords } from '@/lib/keywords';
import {
  colRef, docRef, doc, db, runTransaction, increment, serverTimestamp, createdStamp, updatedStamp,
  writeAudit, readCounter, commitCounter, formatSeq, diffObjects, writeNotification,
} from './db';
import { assertPeriodOpen } from './periodLock';
import { postEntry, reversalFields, reversalDate } from './ledger';

function payeeSnapshot(p) {
  return {
    name: p.name || '',
    type: p.type || 'beneficiary',
    mobile: p.mobile || '',
    address: p.address || '',
    pan: (p.pan || '').toUpperCase(),
    gstin: (p.gstin || '').toUpperCase(),
    code: p.code || '',
  };
}

function buildExpenseData(input, categories, accounts, funds) {
  const lines = (input.lines || [])
    .filter((l) => l && (l.particulars || '').trim() && Number(l.amount) > 0)
    .map((l) => ({ particulars: l.particulars.trim(), amount: round2(l.amount) }));
  if (!lines.length) throw new Error('Add at least one particular with amount');
  const amount = sum(lines, (l) => l.amount);
  const cat = categories.find((c) => c.id === input.categoryId);
  if (!cat) throw new Error('Select expense category');
  let account = null;
  if (input.accountId) {
    account = accounts.find((a) => a.id === input.accountId);
    if (input.paymentMode && isCashMode(input.paymentMode) && account?.type !== 'cash') throw new Error('Cash payment must be from a Cash account');
    if (input.paymentMode && !isCashMode(input.paymentMode) && account?.type !== 'bank') throw new Error('Non-cash payment must be from a Bank account');
  }
  const fund = funds?.find((f) => f.id === input.fundId);
  return {
    date: input.date,
    monthKey: monthKeyOf(input.date),
    financialYearId: fyIdOf(input.date),
    categoryId: cat.id,
    categoryName: cat.name,
    categoryNameHi: cat.nameHi || '',
    isCapital: !!cat.isCapital,
    purpose: input.purpose || '',
    lines,
    amount,
    paymentMode: input.paymentMode || '',
    accountId: account?.id || null,
    accountName: account?.name || '',
    accountType: account?.type || null,
    utr: input.utr || '',
    chequeNo: input.chequeNo || '',
    chequeDate: input.chequeDate || null,
    cashRef: input.cashRef || '',
    fundId: fund?.id || null,
    fundName: fund?.name || '',
    projectName: input.projectName || fund?.name || '',
    billNo: input.billNo || '',
    billDate: input.billDate || null,
    remarks: input.remarks || '',
  };
}

const keywords = (d, payee) => buildKeywords({
  names: [payee?.name],
  exact: [d.voucherNo, d.utr, d.chequeNo, d.billNo, payee?.mobile, payee?.pan, payee?.gstin, payee?.code],
});

export async function createExpense(input, ctx) {
  const { user, categories, accounts, funds, settings } = ctx;
  const base = buildExpenseData(input, categories, accounts, funds);
  const submit = !!ctx.submit;
  const id = doc(colRef(COL.expenses)).id;

  await runTransaction(db, async (tx) => {
    await assertPeriodOpen(tx, base.date, user);
    let payee;
    let payeeCounter;
    if (input.payeeId) {
      const ps = await tx.get(docRef(COL.beneficiaries, input.payeeId));
      if (!ps.exists()) throw new Error('Payee not found');
      payee = { id: ps.id, ...ps.data() };
    } else {
      if (!input.newPayee?.name) throw new Error('Paid-to name is required');
      payeeCounter = await readCounter(tx, 'payee');
    }
    const vCounter = submit ? await readCounter(tx, `voucher_${base.financialYearId}`) : null;

    if (!payee) {
      const pRef = doc(colRef(COL.beneficiaries));
      payee = { id: pRef.id, ...payeeSnapshot(input.newPayee), code: `B-${String(payeeCounter.next).padStart(5, '0')}` };
      tx.set(pRef, {
        ...payeeSnapshot(payee),
        nameLower: payee.name.toLowerCase(),
        bankAccountNo: input.newPayee.bankAccountNo || '',
        ifsc: (input.newPayee.ifsc || '').toUpperCase(),
        bankName: input.newPayee.bankName || '',
        totalAmount: 0,
        paymentCount: 0,
        lastPaymentDate: null,
        status: 'active',
        searchKeywords: buildKeywords({ names: [payee.name], exact: [payee.mobile, payee.pan, payee.gstin, payee.code] }),
        ...createdStamp(user),
      });
      commitCounter(tx, payeeCounter);
      writeAudit(tx, user, { collection: COL.beneficiaries, docId: pRef.id, ref: payee.code, action: 'create', summary: `Payee ${payee.name}` });
    }
    let voucherNo = null;
    if (vCounter) {
      voucherNo = formatSeq(settings?.voucherPrefix || 'PV', base.financialYearId, vCounter.next);
      commitCounter(tx, vCounter);
    }
    const status = submit ? 'submitted' : 'draft';
    const data = {
      ...base,
      voucherNo,
      payeeId: payee.id,
      payee: payeeSnapshot(payee),
      status,
      posted: false,
      ledgerTxnId: null,
      workflow: [
        { status: 'draft', by: user.uid, byName: user.name, at: new Date().toISOString() },
        ...(submit ? [{ status: 'submitted', by: user.uid, byName: user.name, at: new Date().toISOString() }] : []),
      ],
      ...createdStamp(user),
    };
    data.searchKeywords = keywords(data, payee);
    tx.set(docRef(COL.expenses, id), data);
    writeAudit(tx, user, { collection: COL.expenses, docId: id, ref: voucherNo, action: 'create', summary: `Expense ₹${base.amount} to ${payee.name} (${status})` });
    if (submit) {
      writeNotification(tx, { type: 'expense_pending', title: 'Expense approval pending', message: `${voucherNo}: ₹${base.amount} – ${payee.name}`, link: `/expenses/${id}` });
      if (base.amount >= Number(settings?.largeExpenseThreshold || Infinity)) {
        writeNotification(tx, { type: 'large_expense', title: '⚠ Large expense submitted', message: `${voucherNo}: ₹${base.amount} – ${payee.name}`, link: `/expenses/${id}`, roles: ['superAdmin', 'accountant'] });
      }
    }
  });

  try {
    if (ctx.approveNow) await approveExpense(id, user, 'Approved at entry');
    if (ctx.payNow) await payExpense(id, { date: base.date }, user);
  } catch (e) {
    // the expense IS saved – never let the user re-submit the form (duplicate voucher)
    const err = new Error(`Expense saved, but the next step failed: ${e.message}`);
    err.createdId = id;
    throw err;
  }
  return id;
}

export async function updateExpense(id, input, ctx) {
  const { user, categories, accounts, funds } = ctx;
  const base = buildExpenseData(input, categories, accounts, funds);
  await runTransaction(db, async (tx) => {
    const s = await tx.get(docRef(COL.expenses, id));
    if (!s.exists()) throw new Error('Expense not found');
    const old = s.data();
    if (old.posted || ['paid', 'void'].includes(old.status)) throw new Error('Paid / void expenses cannot be edited. Void it and create a new entry.');
    if (!userCan(user, 'expenses.approve') && old.createdBy !== user.uid) throw new Error('You can only edit your own entries');
    await assertPeriodOpen(tx, old.date, user);
    if (old.date !== base.date) await assertPeriodOpen(tx, base.date, user);
    if (old.voucherNo && old.financialYearId !== base.financialYearId) throw new Error('Voucher number already issued for another financial year');
    let payee = old.payee;
    if (input.payeeId && input.payeeId !== old.payeeId) {
      const ps = await tx.get(docRef(COL.beneficiaries, input.payeeId));
      if (!ps.exists()) throw new Error('Payee not found');
      payee = payeeSnapshot(ps.data());
    }
    const next = { ...base, payeeId: input.payeeId || old.payeeId, payee };
    const changes = diffObjects({ ...old, lines: JSON.stringify(old.lines) }, { ...old, ...next, lines: JSON.stringify(next.lines) });
    if (!changes.length) return;
    if (old.status !== 'draft' && !input.reason) throw new Error('Reason for change is required');
    const status = old.status === 'approved' ? 'submitted' : old.status; // re-approval after edit
    tx.update(docRef(COL.expenses, id), {
      ...next,
      status,
      searchKeywords: keywords({ ...old, ...next }, payee),
      workflow: [...(old.workflow || []), { status: 'edited', by: user.uid, byName: user.name, at: new Date().toISOString(), note: input.reason || '' }],
      ...updatedStamp(user),
    });
    writeAudit(tx, user, { collection: COL.expenses, docId: id, ref: old.voucherNo, action: 'update', changes, reason: input.reason, summary: 'Expense edited' });
  });
}

export async function submitExpense(id, user, settings) {
  return runTransaction(db, async (tx) => {
    const s = await tx.get(docRef(COL.expenses, id));
    const d = { id: s.id, ...s.data() };
    if (d.status !== 'draft') throw new Error('Only drafts can be submitted');
    await assertPeriodOpen(tx, d.date, user);
    let { voucherNo } = d;
    let c = null;
    if (!voucherNo) c = await readCounter(tx, `voucher_${d.financialYearId}`);
    if (c) {
      voucherNo = formatSeq(settings?.voucherPrefix || 'PV', d.financialYearId, c.next);
      commitCounter(tx, c);
    }
    tx.update(docRef(COL.expenses, id), {
      status: 'submitted',
      voucherNo,
      searchKeywords: keywords({ ...d, voucherNo }, d.payee),
      workflow: [...(d.workflow || []), { status: 'submitted', by: user.uid, byName: user.name, at: new Date().toISOString() }],
      ...updatedStamp(user),
    });
    writeAudit(tx, user, { collection: COL.expenses, docId: id, ref: voucherNo, action: 'status_change', changes: [{ field: 'status', old: 'draft', new: 'submitted' }] });
    writeNotification(tx, { type: 'expense_pending', title: 'Expense approval pending', message: `${voucherNo}: ₹${d.amount} – ${d.payee?.name}`, link: `/expenses/${id}` });
    if (d.amount >= Number(settings?.largeExpenseThreshold || Infinity)) {
      writeNotification(tx, { type: 'large_expense', title: '⚠ Large expense submitted', message: `${voucherNo}: ₹${d.amount} – ${d.payee?.name}`, link: `/expenses/${id}` });
    }
  });
}

export async function approveExpense(id, user, note) {
  return runTransaction(db, async (tx) => {
    const s = await tx.get(docRef(COL.expenses, id));
    const d = { id: s.id, ...s.data() };
    if (d.status !== 'submitted') throw new Error('Only submitted expenses can be approved');
    await assertPeriodOpen(tx, d.date, user);
    tx.update(docRef(COL.expenses, id), {
      status: 'approved',
      approvedBy: user.uid,
      approvedByName: user.name,
      approvedAt: serverTimestamp(),
      workflow: [...(d.workflow || []), { status: 'approved', by: user.uid, byName: user.name, at: new Date().toISOString(), note: note || '' }],
      ...updatedStamp(user),
    });
    writeAudit(tx, user, { collection: COL.expenses, docId: id, ref: d.voucherNo, action: 'approve', changes: [{ field: 'status', old: 'submitted', new: 'approved' }], reason: note });
    writeNotification(tx, { type: 'expense_approved', title: 'Expense approved – payment pending', message: `${d.voucherNo}: ₹${d.amount} – ${d.payee?.name}`, link: `/expenses/${id}`, roles: ['superAdmin', 'accountant', 'operator'] });
  });
}

/**
 * Mark an approved expense as PAID → posts ledger entry, reduces account balance,
 * updates payee + fund totals. Payment details may be supplied at this stage.
 */
export async function payExpense(id, pay, user) {
  return runTransaction(db, async (tx) => {
    const s = await tx.get(docRef(COL.expenses, id));
    const d = { id: s.id, ...s.data() };
    if (d.status !== 'approved') throw new Error('Only approved expenses can be paid');
    if (d.posted) throw new Error('Already posted');
    const paymentMode = pay.paymentMode || d.paymentMode;
    const accountId = pay.accountId || d.accountId;
    if (!paymentMode || !accountId) throw new Error('Payment mode and account are required to mark as paid');
    // the ledger entry is posted on the actual PAYMENT date (cash / bank book), not the bill date
    const payDate = pay.date || todayStr();
    if (payDate < d.date) throw new Error('Payment date cannot be before the expense date');
    if (payDate > todayStr()) throw new Error('Payment date cannot be in the future');
    await assertPeriodOpen(tx, payDate, user);
    const [aSnap, pSnap] = await Promise.all([tx.get(docRef(COL.accounts, accountId)), tx.get(docRef(COL.beneficiaries, d.payeeId))]);
    if (!aSnap.exists()) throw new Error('Account not found');
    const account = { id: aSnap.id, ...aSnap.data() };
    if (isCashMode(paymentMode) && account.type !== 'cash') throw new Error('Cash payment must be from a Cash account');
    if (!isCashMode(paymentMode) && account.type !== 'bank') throw new Error('Non-cash payment must be from a Bank account');

    const utr = pay.utr ?? d.utr;
    const chequeNo = pay.chequeNo ?? d.chequeNo;
    const txnId = postEntry(tx, user, {
      date: payDate,
      account,
      accountId,
      type: 'expense',
      debit: d.amount,
      reference: d.voucherNo,
      description: `${d.categoryName}${d.purpose ? ` – ${d.purpose}` : ''}`,
      partyName: d.payee?.name,
      paymentMode,
      utr,
      chequeNo,
      fundId: d.fundId,
      categoryName: d.categoryName,
      cats: [{ id: d.categoryId, amount: d.amount }],
      sourceType: 'expense',
      sourceId: d.id,
    });
    if (pSnap.exists()) {
      const p = pSnap.data();
      tx.update(docRef(COL.beneficiaries, d.payeeId), {
        totalAmount: increment(d.amount),
        paymentCount: increment(1),
        lastPaymentDate: !p.lastPaymentDate || payDate > p.lastPaymentDate ? payDate : p.lastPaymentDate,
      });
    }
    if (d.fundId) tx.update(docRef(COL.funds, d.fundId), { spent: increment(d.amount) });
    tx.update(docRef(COL.expenses, id), {
      status: 'paid',
      posted: true,
      ledgerTxnId: txnId,
      paymentMode,
      accountId,
      accountName: account.name,
      accountType: account.type,
      utr: utr || '',
      chequeNo: chequeNo || '',
      cashRef: pay.cashRef ?? d.cashRef ?? '',
      paidDate: payDate,
      paidBy: user.uid,
      paidByName: user.name,
      paidAt: serverTimestamp(),
      searchKeywords: keywords({ ...d, utr, chequeNo }, d.payee),
      workflow: [...(d.workflow || []), { status: 'paid', by: user.uid, byName: user.name, at: new Date().toISOString(), note: pay.note || '' }],
      ...updatedStamp(user),
    });
    writeAudit(tx, user, {
      collection: COL.expenses, docId: id, ref: d.voucherNo, action: 'pay',
      changes: [{ field: 'status', old: 'approved', new: 'paid' }], summary: `Paid ₹${d.amount} from ${account.name}`,
    });
  });
}

export async function voidExpense(id, reason, user) {
  if (!reason) throw new Error('Reason is required');
  return runTransaction(db, async (tx) => {
    const s = await tx.get(docRef(COL.expenses, id));
    const d = { id: s.id, ...s.data() };
    if (d.status === 'void') throw new Error('Already void');
    const fySnap = await tx.get(docRef(COL.financialYears, d.financialYearId));
    if (fySnap.exists() && fySnap.data().status === 'finalized') {
      throw new Error('This expense belongs to a FINALIZED year. Record an adjustment entry in the current year instead.');
    }
    let account;
    const revDate = reversalDate(d.paidDate || d.date);
    if (d.posted) {
      await assertPeriodOpen(tx, revDate, user);
      const a = await tx.get(docRef(COL.accounts, d.accountId));
      account = { id: a.id, ...a.data() };
    } else {
      await assertPeriodOpen(tx, d.date, user);
    }
    let reversalTxnId = null;
    if (d.posted) {
      reversalTxnId = postEntry(tx, user, {
        ...reversalFields(d),
        date: revDate,
        cats: [{ id: d.categoryId, amount: d.amount }],
        account,
        accountId: d.accountId,
        type: 'reversal',
        credit: d.amount,
        reference: d.voucherNo,
        description: `Reversal of expense ${d.voucherNo} dt. ${d.date}: ${reason}`,
        partyName: d.payee?.name,
        sourceType: 'expense',
        sourceId: d.id,
        reversalOf: d.ledgerTxnId,
        originalType: 'expense',
      });
      if (d.ledgerTxnId) tx.update(docRef(COL.transactions, d.ledgerTxnId), { status: 'reversed', reverseReason: reason });
      tx.update(docRef(COL.beneficiaries, d.payeeId), { totalAmount: increment(-d.amount), paymentCount: increment(-1) });
      if (d.fundId) tx.update(docRef(COL.funds, d.fundId), { spent: increment(-d.amount) });
    }
    tx.update(docRef(COL.expenses, id), {
      status: 'void',
      previousStatus: d.status,
      voidReason: reason,
      voidDate: d.posted ? revDate : null,
      voidedBy: user.uid,
      voidedByName: user.name,
      voidedAt: serverTimestamp(),
      reversalTxnId,
      workflow: [...(d.workflow || []), { status: 'void', by: user.uid, byName: user.name, at: new Date().toISOString(), note: reason }],
      ...updatedStamp(user),
    });
    writeAudit(tx, user, { collection: COL.expenses, docId: id, ref: d.voucherNo, action: 'void', reason, changes: [{ field: 'status', old: d.status, new: 'void' }] });
  });
}

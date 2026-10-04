'use client';

import { COL, TXN_TYPES } from '@/lib/constants';
import { fyIdOf, monthKeyOf, round2, todayStr } from '@/lib/format';
import { buildKeywords } from '@/lib/keywords';
import {
  colRef, docRef, doc, increment, runTransaction, db, createdStamp, writeAudit, serverTimestamp, fetchAll, where, writeNotification,
} from './db';
import { assertPeriodOpen, closedFyCarry } from './periodLock';
import { statsOnPost } from './stats';

/**
 * Posts ONE ledger line on ONE account and moves the account balance.
 * credit = money IN to the account, debit = money OUT (passbook convention).
 * Caller must have done all transaction reads before calling (Firestore rule).
 */
export function postEntry(tx, user, e) {
  const ref = e.id ? docRef(COL.transactions, e.id) : doc(colRef(COL.transactions));
  const credit = round2(e.credit || 0);
  const debit = round2(e.debit || 0);
  // cash in hand can never go below zero (reversals are allowed – they undo an earlier entry)
  if (e.account?.type === 'cash' && debit > 0 && e.type !== 'reversal') {
    const after = round2((Number(e.account.currentBalance) || 0) - debit);
    if (after < 0) throw new Error(`Insufficient cash in “${e.account.name}”: balance ₹${round2(e.account.currentBalance || 0)}, payment ₹${debit}`);
  }
  const fyId = fyIdOf(e.date);
  tx.set(ref, {
    date: e.date,
    monthKey: monthKeyOf(e.date),
    financialYearId: fyId,
    accountId: e.accountId,
    accountType: e.account?.type || null,
    accountName: e.account?.name || '',
    type: e.type,
    credit,
    debit,
    reference: e.reference || '',
    description: e.description || '',
    partyName: e.partyName || '',
    paymentMode: e.paymentMode || '',
    utr: e.utr || '',
    chequeNo: e.chequeNo || '',
    fundId: e.fundId || null,
    fundIds: e.fundIds || (e.fundId ? [e.fundId] : []),
    categoryName: e.categoryName || '',
    sourceType: e.sourceType || 'manual', // donation | expense | manual
    sourceId: e.sourceId || null,
    linkedTxnId: e.linkedTxnId || null,
    reversalOf: e.reversalOf || null,
    originalType: e.originalType || (e.type === 'reversal' ? null : e.type),
    status: 'active',
    reconciled: false,
    statementLineId: null,
    searchKeywords: buildKeywords({ names: [e.partyName], exact: [e.reference, e.utr, e.chequeNo] }),
    ...createdStamp(user),
  });
  tx.update(docRef(COL.accounts, e.accountId), {
    currentBalance: increment(round2(credit - debit)),
    lastTxnId: ref.id, // security rules tie the balance change to this ledger line
    updatedAt: serverTimestamp(),
  });
  // year summary (dashboard / monthly closing / book openings read this instead of all entries)
  statsOnPost(tx, {
    fyId, monthKey: monthKeyOf(e.date), accountId: e.accountId, credit, debit,
    type: e.type, originalType: e.originalType || (e.type === 'reversal' ? null : e.type), cats: e.cats,
  });
  // posting into a CLOSED year (Super Admin) → keep its closing + next year's opening in step
  const carry = closedFyCarry.get(tx)?.[fyId];
  if (carry && round2(credit - debit) !== 0) {
    const delta = round2(credit - debit);
    tx.update(docRef(COL.financialYears, fyId), { [`closingBalances.${e.accountId}`]: increment(delta), closingTotal: increment(delta) });
    if (carry.nextExists) tx.update(docRef(COL.financialYears, carry.nextId), { [`openingBalances.${e.accountId}`]: increment(delta) });
  }
  return ref.id;
}

/**
 * Manual accounting entries: transfers, cash deposit / withdrawal,
 * bank charges, interest, other income, adjustments.
 */
export async function createManualEntry(input, user) {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error('Amount must be greater than zero');
  if (input.date > todayStr()) throw new Error('Future dates are not allowed');
  const pair = ['transfer', 'cash_deposit', 'cash_withdrawal'].includes(input.type);
  if (pair && input.fromAccountId === input.toAccountId) throw new Error('From and To accounts must be different');

  return runTransaction(db, async (tx) => {
    await assertPeriodOpen(tx, input.date, user);
    const ids = pair ? [input.fromAccountId, input.toAccountId] : [input.accountId];
    const snaps = await Promise.all(ids.map((id) => tx.get(docRef(COL.accounts, id))));
    const accts = snaps.map((s) => {
      if (!s.exists()) throw new Error('Account not found');
      return { id: s.id, ...s.data() };
    });
    if (input.type === 'cash_deposit' && (accts[0].type !== 'cash' || accts[1].type !== 'bank')) {
      throw new Error('Cash deposit must be from a Cash account to a Bank account');
    }
    if (input.type === 'cash_withdrawal' && (accts[0].type !== 'bank' || accts[1].type !== 'cash')) {
      throw new Error('Cash withdrawal must be from a Bank account to a Cash account');
    }

    const common = {
      date: input.date,
      type: input.type,
      reference: input.reference,
      description: input.description || TXN_TYPES[input.type],
      utr: input.utr,
      chequeNo: input.chequeNo,
      fundId: input.fundId,
      sourceType: 'manual',
    };
    const created = [];
    if (pair) {
      const outId = doc(colRef(COL.transactions)).id;
      const inId = doc(colRef(COL.transactions)).id;
      postEntry(tx, user, { ...common, id: outId, account: accts[0], accountId: accts[0].id, debit: amount, partyName: accts[1].name, linkedTxnId: inId });
      postEntry(tx, user, { ...common, id: inId, account: accts[1], accountId: accts[1].id, credit: amount, partyName: accts[0].name, linkedTxnId: outId });
      created.push(outId, inId);
    } else {
      const isIn = input.direction === 'in' || ['interest', 'other_income'].includes(input.type);
      const id = postEntry(tx, user, {
        ...common,
        account: accts[0],
        accountId: accts[0].id,
        credit: isIn ? amount : 0,
        debit: isIn ? 0 : amount,
        partyName: input.partyName,
      });
      created.push(id);
    }
    writeAudit(tx, user, {
      collection: COL.transactions,
      docId: created[0],
      ref: input.reference || TXN_TYPES[input.type],
      action: 'create',
      summary: `${TXN_TYPES[input.type]} ₹${amount}`,
      changes: [{ field: 'amount', old: null, new: amount }, { field: 'type', old: null, new: input.type }],
      reason: input.description,
    });
    if (input.type === 'adjustment') {
      writeNotification(tx, { type: 'adjustment', title: 'Adjustment entry recorded', message: `${accts[0].name}: ₹${amount} – ${input.description || ''}`, link: '/transactions' });
    }
    return created;
  });
}

/** Analysis fields a reversal copies from the original line (fund, category, mode …) */
export const reversalFields = (t = {}) => ({
  fundId: t.fundId || null,
  fundIds: t.fundIds || (t.fundId ? [t.fundId] : []),
  categoryName: t.categoryName || '',
  paymentMode: t.paymentMode || '',
  utr: t.utr || '',
  chequeNo: t.chequeNo || '',
});

/** A reversal is dated today, but never before the entry it reverses */
export const reversalDate = (originalDate) => {
  const today = todayStr();
  return originalDate && originalDate > today ? originalDate : today;
};

/**
 * Reverse a MANUAL ledger entry (and its pair for transfers).
 * A reversal is posted on today's date – the original stays for the audit trail.
 */
export async function reverseManualEntry(txnId, reason, user) {
  if (!reason) throw new Error('Reason is required');
  return runTransaction(db, async (tx) => {
    const today = todayStr();
    await assertPeriodOpen(tx, today, user);
    const s = await tx.get(docRef(COL.transactions, txnId));
    if (!s.exists()) throw new Error('Entry not found');
    const t = { id: s.id, ...s.data() };
    if (t.sourceType !== 'manual') throw new Error('Donation / expense entries must be reversed by voiding the donation or expense');
    if (t.status === 'reversed' || t.type === 'reversal') throw new Error('Entry already reversed');
    const tfy = await tx.get(docRef(COL.financialYears, t.financialYearId));
    if (tfy.exists() && tfy.data().status === 'finalized') throw new Error(`FY ${t.financialYearId} is finalized – record an adjustment entry in the current year instead`);
    const list = [t];
    if (t.linkedTxnId) {
      const ls = await tx.get(docRef(COL.transactions, t.linkedTxnId));
      if (ls.exists()) list.push({ id: ls.id, ...ls.data() });
    }
    const acctSnaps = await Promise.all(list.map((x) => tx.get(docRef(COL.accounts, x.accountId))));
    list.forEach((x, i) => {
      postEntry(tx, user, {
        ...reversalFields(x),
        date: today,
        type: 'reversal',
        account: { id: acctSnaps[i].id, ...acctSnaps[i].data() },
        accountId: x.accountId,
        credit: x.debit,
        debit: x.credit,
        reference: x.reference,
        description: `Reversal of ${TXN_TYPES[x.type] || x.type} dt. ${x.date}: ${reason}`,
        partyName: x.partyName,
        reversalOf: x.id,
        originalType: x.type,
        sourceType: 'manual',
      });
      tx.update(docRef(COL.transactions, x.id), { status: 'reversed', reversedAt: serverTimestamp(), reversedBy: user.uid, reverseReason: reason });
    });
    writeAudit(tx, user, { collection: COL.transactions, docId: txnId, ref: t.reference, action: 'reverse', reason, summary: `Reversed ${TXN_TYPES[t.type]} ₹${t.credit || t.debit}` });
  });
}

/** All ledger lines of a financial year (optionally one account) */
export function fetchFyTransactions(fyId, accountId) {
  const cons = [where('financialYearId', '==', fyId)];
  if (accountId) cons.push(where('accountId', '==', accountId));
  return fetchAll(COL.transactions, ...cons);
}

/**
 * Sorts ledger lines and adds running balance.
 * @param {Array} txns  ledger lines (any order)
 * @param {number} opening  opening balance
 */
export function withRunningBalance(txns, opening = 0) {
  const sorted = [...txns].sort((a, b) => (a.date === b.date
    ? (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
    : a.date.localeCompare(b.date)));
  let bal = round2(opening);
  return sorted.map((t) => {
    bal = round2(bal + (t.credit || 0) - (t.debit || 0));
    return { ...t, balance: bal };
  });
}

/** Opening balance of each account for a FY (from FY doc, fallback to account opening) */
export function fyOpeningFor(fy, account) {
  if (fy?.openingBalances && fy.openingBalances[account.id] !== undefined) return Number(fy.openingBalances[account.id]) || 0;
  // account created inside this FY
  if (account.openingFyId === fy?.id) return Number(account.openingBalance) || 0;
  return 0;
}

/**
 * Balance per account as on a date: FY opening + all lines in FY up to (and incl.) date.
 */
export function balancesAsOn({ fy, accounts, txns, uptoDate }) {
  const out = {};
  accounts.forEach((a) => { out[a.id] = fyOpeningFor(fy, a); });
  txns.forEach((t) => {
    if (uptoDate && t.date > uptoDate) return;
    if (out[t.accountId] === undefined) out[t.accountId] = 0;
    out[t.accountId] = round2(out[t.accountId] + (t.credit || 0) - (t.debit || 0));
  });
  return out;
}

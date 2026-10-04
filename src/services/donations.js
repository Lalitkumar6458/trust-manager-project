'use client';

import { userCan } from '@/lib/permissions';
import { COL, isCashMode } from '@/lib/constants';
import { fyIdOf, monthKeyOf, round2, sum } from '@/lib/format';
import { buildKeywords } from '@/lib/keywords';
import {
  colRef, docRef, doc, db, runTransaction, increment, serverTimestamp, createdStamp, updatedStamp,
  writeAudit, readCounter, commitCounter, formatSeq, diffObjects, writeNotification,
} from './db';
import { assertPeriodOpen } from './periodLock';
import { postEntry, reversalFields, reversalDate } from './ledger';

const fyKey = (fyId) => fyId.replace('-', '_');

/** Fields copied from the form to the donation document */
function buildDonationData(input, categories, accounts) {
  const lines = (input.lines || [])
    .filter((l) => l && l.categoryId && Number(l.amount) > 0)
    .map((l) => {
      const c = categories.find((x) => x.id === l.categoryId) || {};
      return {
        categoryId: l.categoryId,
        categoryName: c.name || '',
        categoryNameHi: c.nameHi || '',
        isCorpus: !!c.isCorpus,
        fundId: l.fundId || c.defaultFundId || null,
        description: l.description || '',
        amount: round2(l.amount),
      };
    });
  if (!lines.length) throw new Error('Add at least one category with amount');
  const amount = sum(lines, (l) => l.amount);
  const account = accounts.find((a) => a.id === input.accountId);
  if (!account) throw new Error('Select the bank / cash account where the money was received');
  if (isCashMode(input.paymentMode) && account.type !== 'cash') throw new Error('Cash donation must go to a Cash account');
  if (!isCashMode(input.paymentMode) && account.type !== 'bank') throw new Error('Non-cash donation must go to a Bank account');

  return {
    date: input.date,
    monthKey: monthKeyOf(input.date),
    financialYearId: fyIdOf(input.date),
    lines,
    amount,
    categoryIds: [...new Set(lines.map((l) => l.categoryId))],
    fundIds: [...new Set(lines.map((l) => l.fundId).filter(Boolean))],
    isCorpus: lines.some((l) => l.isCorpus),
    purpose: input.purpose || '',
    paymentMode: input.paymentMode,
    accountId: account.id,
    accountName: account.name,
    accountType: account.type,
    utr: input.utr || '',
    chequeNo: input.chequeNo || '',
    chequeDate: input.chequeDate || null,
    bankName: input.bankName || '',
    txnDate: input.txnDate || input.date,
    donorRefNo: input.donorRefNo || '',
    remarks: input.remarks || '',
  };
}

function donorSnapshot(d) {
  return {
    name: d.name || '',
    organizationName: d.organizationName || '',
    donorType: d.donorType || 'Individual',
    mobile: d.mobile || '',
    email: d.email || '',
    address: d.address || '',
    pan: (d.pan || '').toUpperCase(),
    donorCode: d.donorCode || '',
  };
}

function keywords(data, donor) {
  return buildKeywords({
    names: [donor.name, donor.organizationName],
    exact: [data.receiptNo, data.utr, data.chequeNo, donor.mobile, donor.pan, donor.donorCode, data.donorRefNo],
  });
}

/**
 * Create a donation.
 * @param input form values (+ donorId OR newDonor)
 * @param ctx { user, categories, accounts, settings, submit:boolean }
 */
export async function createDonation(input, ctx) {
  const { user, categories, accounts, settings } = ctx;
  const base = buildDonationData(input, categories, accounts);
  const submit = !!ctx.submit;
  const id = doc(colRef(COL.donations)).id;

  await runTransaction(db, async (tx) => {
    await assertPeriodOpen(tx, base.date, user);

    // ---- reads ----
    let donor;
    let donorCounter;
    if (input.donorId) {
      const ds = await tx.get(docRef(COL.donors, input.donorId));
      if (!ds.exists()) throw new Error('Donor not found');
      donor = { id: ds.id, ...ds.data() };
    } else {
      if (!input.newDonor?.name) throw new Error('Donor name is required');
      donorCounter = await readCounter(tx, 'donor');
    }
    const receiptCounter = submit ? await readCounter(tx, `receipt_${base.financialYearId}`) : null;

    // ---- writes ----
    if (!donor) {
      const donorRef = doc(colRef(COL.donors));
      const nd = input.newDonor;
      donor = {
        id: donorRef.id,
        ...donorSnapshot(nd),
        donorCode: `D-${String(donorCounter.next).padStart(5, '0')}`,
        idType: nd.idType || '',
        idNumber: nd.idNumber || '',
      };
      tx.set(donorRef, {
        ...donorSnapshot(donor),
        donorCode: donor.donorCode,
        idType: donor.idType,
        idNumber: donor.idNumber,
        nameLower: donor.name.toLowerCase(),
        totalAmount: 0,
        donationCount: 0,
        firstDonationDate: null,
        lastDonationDate: null,
        fyTotals: {},
        status: 'active',
        searchKeywords: buildKeywords({ names: [donor.name, donor.organizationName], exact: [donor.mobile, donor.pan, donor.donorCode] }),
        ...createdStamp(user),
      });
      commitCounter(tx, donorCounter);
      writeAudit(tx, user, { collection: COL.donors, docId: donorRef.id, ref: donor.donorCode, action: 'create', summary: `Donor ${donor.name}` });
    }

    let receiptNo = null;
    if (receiptCounter) {
      receiptNo = formatSeq(settings?.receiptPrefix || 'DR', base.financialYearId, receiptCounter.next);
      commitCounter(tx, receiptCounter);
    }
    const status = submit ? 'submitted' : 'draft';
    const data = {
      ...base,
      receiptNo,
      donorId: donor.id,
      donor: donorSnapshot(donor),
      status,
      posted: false,
      ledgerTxnId: null,
      workflow: [
        { status: 'draft', by: user.uid, byName: user.name, at: new Date().toISOString() },
        ...(submit ? [{ status: 'submitted', by: user.uid, byName: user.name, at: new Date().toISOString() }] : []),
      ],
      ...createdStamp(user),
    };
    data.searchKeywords = keywords(data, donor);
    tx.set(docRef(COL.donations, id), data);
    writeAudit(tx, user, {
      collection: COL.donations, docId: id, ref: receiptNo, action: 'create',
      summary: `Donation ₹${base.amount} from ${donor.name} (${status})`,
    });
    if (submit) {
      writeNotification(tx, {
        type: 'donation_new', title: 'New donation – verification pending',
        message: `${receiptNo}: ₹${base.amount} from ${donor.name}`, link: `/donations/${id}`,
      });
    }
  });

  if (ctx.approveNow) {
    try {
      await verifyDonation(id, user, 'Verified at entry');
      await approveDonation(id, user, 'Approved at entry');
    } catch (e) {
      // the donation IS saved – never let the user re-submit the form (duplicate receipt)
      const err = new Error(`Donation saved, but it could not be approved: ${e.message}`);
      err.createdId = id;
      throw err;
    }
  }
  return id;
}

/** Edit a donation that is NOT yet posted (draft / submitted / verified). */
export async function updateDonation(id, input, ctx) {
  const { user, categories, accounts } = ctx;
  const base = buildDonationData(input, categories, accounts);
  await runTransaction(db, async (tx) => {
    const s = await tx.get(docRef(COL.donations, id));
    if (!s.exists()) throw new Error('Donation not found');
    const old = s.data();
    if (old.posted || ['approved', 'void'].includes(old.status)) {
      throw new Error('Approved / void donations cannot be edited. Void it and create a new entry.');
    }
    if (!userCan(user, 'donations.verify') && old.createdBy !== user.uid) throw new Error('You can only edit your own entries');
    await assertPeriodOpen(tx, old.date, user);
    if (old.date !== base.date) await assertPeriodOpen(tx, base.date, user);
    if (old.receiptNo && old.financialYearId !== base.financialYearId) {
      throw new Error('Receipt number already issued for another financial year – void and re-enter instead');
    }
    let donor = old.donor;
    if (input.donorId && input.donorId !== old.donorId) {
      const ds = await tx.get(docRef(COL.donors, input.donorId));
      if (!ds.exists()) throw new Error('Donor not found');
      donor = donorSnapshot({ ...ds.data() });
    }
    const next = { ...base, donorId: input.donorId || old.donorId, donor };
    const changes = diffObjects(
      { ...old, lines: JSON.stringify(old.lines) },
      { ...old, ...next, lines: JSON.stringify(next.lines) },
    );
    if (!changes.length) return;
    if (old.status !== 'draft' && !input.reason) throw new Error('Reason for change is required');
    // editing after verification sends it back for re-verification
    const status = old.status === 'verified' ? 'submitted' : old.status;
    tx.update(docRef(COL.donations, id), {
      ...next,
      status,
      searchKeywords: keywords({ ...old, ...next }, donor),
      workflow: [...(old.workflow || []), { status: 'edited', by: user.uid, byName: user.name, at: new Date().toISOString(), note: input.reason }],
      ...updatedStamp(user),
    });
    writeAudit(tx, user, { collection: COL.donations, docId: id, ref: old.receiptNo, action: 'update', changes, reason: input.reason, summary: 'Donation edited' });
  });
}

async function moveStatus(id, user, { from, to, note, extra, onTx }) {
  return runTransaction(db, async (tx) => {
    const s = await tx.get(docRef(COL.donations, id));
    if (!s.exists()) throw new Error('Donation not found');
    const d = { id: s.id, ...s.data() };
    if (!from.includes(d.status)) throw new Error(`Donation is ${d.status}; cannot move to ${to}`);
    await assertPeriodOpen(tx, d.date, user);
    const patch = await (onTx ? onTx(tx, d) : {});
    tx.update(docRef(COL.donations, id), {
      status: to,
      ...(extra || {}),
      ...(patch || {}),
      workflow: [...(d.workflow || []), { status: to, by: user.uid, byName: user.name, at: new Date().toISOString(), note: note || '' }],
      ...updatedStamp(user),
    });
    writeAudit(tx, user, {
      collection: COL.donations, docId: id, ref: d.receiptNo || patch?.receiptNo, action: 'status_change',
      changes: [{ field: 'status', old: d.status, new: to }], reason: note, summary: `Donation ${d.status} → ${to}`,
    });
    return d;
  });
}

export async function submitDonation(id, user, settings) {
  return moveStatus(id, user, {
    from: ['draft'],
    to: 'submitted',
    onTx: async (tx, d) => {
      if (d.receiptNo) return {};
      const c = await readCounter(tx, `receipt_${d.financialYearId}`);
      const receiptNo = formatSeq(settings?.receiptPrefix || 'DR', d.financialYearId, c.next);
      commitCounter(tx, c);
      writeNotification(tx, { type: 'donation_new', title: 'Donation verification pending', message: `${receiptNo}: ₹${d.amount} from ${d.donor?.name}`, link: `/donations/${d.id}` });
      return { receiptNo, searchKeywords: keywords({ ...d, receiptNo }, d.donor) };
    },
  });
}

export const verifyDonation = (id, user, note) => moveStatus(id, user, {
  from: ['submitted'], to: 'verified', note, extra: { verifiedBy: user.uid, verifiedByName: user.name, verifiedAt: serverTimestamp() },
});

/** Approve = post to ledger, move account balance, update donor + fund totals */
export async function approveDonation(id, user, note) {
  return runTransaction(db, async (tx) => {
    const s = await tx.get(docRef(COL.donations, id));
    if (!s.exists()) throw new Error('Donation not found');
    const d = { id: s.id, ...s.data() };
    if (d.status !== 'verified') throw new Error('Only verified donations can be approved');
    if (d.posted) throw new Error('Already posted');
    await assertPeriodOpen(tx, d.date, user);
    const [acctSnap, donorSnap] = await Promise.all([
      tx.get(docRef(COL.accounts, d.accountId)),
      tx.get(docRef(COL.donors, d.donorId)),
    ]);
    if (!acctSnap.exists()) throw new Error('Account not found');
    const account = { id: acctSnap.id, ...acctSnap.data() };
    if (account.status === 'inactive') throw new Error('Account is inactive');

    // ---- writes ----
    const txnId = postEntry(tx, user, {
      date: d.date,
      account,
      accountId: d.accountId,
      type: 'donation',
      credit: d.amount,
      reference: d.receiptNo,
      description: `Donation – ${d.lines.map((l) => l.categoryName).join(', ')}${d.purpose ? ` (${d.purpose})` : ''}`,
      partyName: d.donor?.name,
      paymentMode: d.paymentMode,
      utr: d.utr,
      chequeNo: d.chequeNo,
      fundId: d.fundIds?.length === 1 ? d.fundIds[0] : null,
      fundIds: d.fundIds || [],
      categoryName: d.lines.map((l) => l.categoryName).join(', '),
      cats: d.lines.map((l) => ({ id: l.categoryId, amount: l.amount })),
      sourceType: 'donation',
      sourceId: d.id,
    });
    if (donorSnap.exists()) {
      const dn = donorSnap.data();
      tx.update(docRef(COL.donors, d.donorId), {
        totalAmount: increment(d.amount),
        donationCount: increment(1),
        [`fyTotals.${fyKey(d.financialYearId)}`]: increment(d.amount),
        firstDonationDate: !dn.firstDonationDate || d.date < dn.firstDonationDate ? d.date : dn.firstDonationDate,
        lastDonationDate: !dn.lastDonationDate || d.date > dn.lastDonationDate ? d.date : dn.lastDonationDate,
        categoryIds: [...new Set([...(dn.categoryIds || []), ...d.categoryIds])],
      });
    }
    const fundAmounts = {};
    d.lines.forEach((l) => { if (l.fundId) fundAmounts[l.fundId] = round2((fundAmounts[l.fundId] || 0) + l.amount); });
    Object.entries(fundAmounts).forEach(([fid, amt]) => tx.update(docRef(COL.funds, fid), { received: increment(amt) }));

    tx.update(docRef(COL.donations, id), {
      status: 'approved',
      posted: true,
      ledgerTxnId: txnId,
      approvedBy: user.uid,
      approvedByName: user.name,
      approvedAt: serverTimestamp(),
      workflow: [...(d.workflow || []), { status: 'approved', by: user.uid, byName: user.name, at: new Date().toISOString(), note: note || '' }],
      ...updatedStamp(user),
    });
    writeAudit(tx, user, {
      collection: COL.donations, docId: id, ref: d.receiptNo, action: 'approve',
      changes: [{ field: 'status', old: 'verified', new: 'approved' }], summary: `Approved & posted ₹${d.amount} to ${account.name}`,
    });
  });
}

/**
 * Void / cancel a donation. If it was posted, a reversal ledger entry is
 * created on today's date and all totals are reverted. Nothing is deleted.
 */
export async function voidDonation(id, reason, user, { bounced = false } = {}) {
  if (!reason) throw new Error('Reason is required');
  return runTransaction(db, async (tx) => {
    const s = await tx.get(docRef(COL.donations, id));
    if (!s.exists()) throw new Error('Donation not found');
    const d = { id: s.id, ...s.data() };
    if (d.status === 'void') throw new Error('Already void');
    const fySnap = await tx.get(docRef(COL.financialYears, d.financialYearId));
    if (fySnap.exists() && fySnap.data().status === 'finalized') {
      throw new Error('This donation belongs to a FINALIZED year. Record an adjustment entry in the current year instead.');
    }
    let account;
    let donorSnap;
    const revDate = reversalDate(d.date);
    if (d.posted) {
      await assertPeriodOpen(tx, revDate, user);
      const [a, dn] = await Promise.all([tx.get(docRef(COL.accounts, d.accountId)), tx.get(docRef(COL.donors, d.donorId))]);
      account = { id: a.id, ...a.data() };
      donorSnap = dn;
    } else {
      await assertPeriodOpen(tx, d.date, user);
    }
    // ---- writes ----
    let reversalTxnId = null;
    if (d.posted) {
      reversalTxnId = postEntry(tx, user, {
        ...reversalFields({ ...d, fundId: d.fundIds?.length === 1 ? d.fundIds[0] : null, categoryName: d.lines.map((l) => l.categoryName).join(', ') }),
        date: revDate,
        cats: d.lines.map((l) => ({ id: l.categoryId, amount: l.amount })),
        account,
        accountId: d.accountId,
        type: 'reversal',
        debit: d.amount,
        reference: d.receiptNo,
        description: `${bounced ? 'Cheque bounced – ' : 'Reversal of '}donation ${d.receiptNo} dt. ${d.date}: ${reason}`,
        partyName: d.donor?.name,
        sourceType: 'donation',
        sourceId: d.id,
        reversalOf: d.ledgerTxnId,
        originalType: 'donation',
      });
      if (d.ledgerTxnId) tx.update(docRef(COL.transactions, d.ledgerTxnId), { status: 'reversed', reverseReason: reason });
      if (donorSnap?.exists()) {
        tx.update(docRef(COL.donors, d.donorId), {
          totalAmount: increment(-d.amount),
          donationCount: increment(-1),
          [`fyTotals.${fyKey(d.financialYearId)}`]: increment(-d.amount),
        });
      }
      const fundAmounts = {};
      d.lines.forEach((l) => { if (l.fundId) fundAmounts[l.fundId] = round2((fundAmounts[l.fundId] || 0) + l.amount); });
      Object.entries(fundAmounts).forEach(([fid, amt]) => tx.update(docRef(COL.funds, fid), { received: increment(-amt) }));
    }
    tx.update(docRef(COL.donations, id), {
      status: 'void',
      previousStatus: d.status,
      voidReason: reason,
      voidDate: d.posted ? revDate : null,
      ...(bounced ? { bounced: true } : {}),
      voidedBy: user.uid,
      voidedByName: user.name,
      voidedAt: serverTimestamp(),
      reversalTxnId,
      workflow: [...(d.workflow || []), { status: 'void', by: user.uid, byName: user.name, at: new Date().toISOString(), note: reason }],
      ...updatedStamp(user),
    });
    writeAudit(tx, user, {
      collection: COL.donations, docId: id, ref: d.receiptNo, action: 'void', reason,
      changes: [{ field: 'status', old: d.status, new: 'void' }], summary: `Donation voided${d.posted ? ' (reversal posted)' : ''}`,
    });
  });
}

/** Count receipt prints – every print after the first is marked “DUPLICATE” */
export async function markReceiptPrinted(id, user) {
  return runTransaction(db, async (tx) => {
    const s = await tx.get(docRef(COL.donations, id));
    if (!s.exists()) throw new Error('Donation not found');
    const n = (s.data().printCount || 0) + 1;
    tx.update(docRef(COL.donations, id), { printCount: n, lastPrintedAt: serverTimestamp(), lastPrintedBy: user.name || user.uid });
    return n;
  });
}

'use client';

import { COL } from '@/lib/constants';
import { buildKeywords } from '@/lib/keywords';
import { fyIdOf, round2 } from '@/lib/format';
import {
  colRef, docRef, doc, db, runTransaction, writeBatch, createdStamp, updatedStamp, writeAudit, diffObjects,
  readCounter, commitCounter, increment, serverTimestamp,
} from './db';

const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === undefined ? null : v)));

/**
 * Generic create/update with audit log for master data.
 * `keywordFn(data)` optionally returns searchKeywords.
 */
export async function saveMaster(collName, id, data, user, { keywordFn, codeCounter, codePrefix, refField = 'name', reason } = {}) {
  const payload = clean(data);
  if (keywordFn) payload.searchKeywords = keywordFn(payload);
  if (payload.name) payload.nameLower = String(payload.name).toLowerCase();

  return runTransaction(db, async (tx) => {
    if (id) {
      const s = await tx.get(docRef(collName, id));
      const old = s.exists() ? s.data() : {};
      // codes (donor / payee code) are not part of the form – rebuild keywords from the merged record
      if (keywordFn) payload.searchKeywords = keywordFn({ ...old, ...payload });
      const changes = diffObjects(old, { ...old, ...payload });
      if (!changes.length) return id;
      tx.update(docRef(collName, id), { ...payload, ...updatedStamp(user) });
      writeAudit(tx, user, { collection: collName, docId: id, ref: old[refField] || payload[refField], action: 'update', changes, reason });
      return id;
    }
    let counter = null;
    if (codeCounter) counter = await readCounter(tx, codeCounter);
    const ref = doc(colRef(collName));
    if (counter) {
      payload.code = `${codePrefix}-${String(counter.next).padStart(5, '0')}`;
      if (collName === COL.donors) payload.donorCode = payload.code;
      if (keywordFn) payload.searchKeywords = keywordFn(payload);
      commitCounter(tx, counter);
    }
    tx.set(ref, { ...payload, ...createdStamp(user) });
    writeAudit(tx, user, { collection: collName, docId: ref.id, ref: payload[refField] || payload.code, action: 'create', changes: [], summary: `Created ${payload[refField] || ''}` });
    return ref.id;
  });
}

export const donorKeywords = (d) => buildKeywords({ names: [d.name, d.organizationName], exact: [d.mobile, d.pan, d.donorCode, d.email] });
export const payeeKeywords = (d) => buildKeywords({ names: [d.name], exact: [d.mobile, d.pan, d.gstin, d.code] });

export function saveDonor(id, data, user) {
  const payload = { ...data, pan: (data.pan || '').toUpperCase() };
  if (!id) Object.assign(payload, { totalAmount: 0, donationCount: 0, fyTotals: {}, firstDonationDate: null, lastDonationDate: null, status: 'active' });
  return saveMaster(COL.donors, id, payload, user, { keywordFn: donorKeywords, codeCounter: id ? null : 'donor', codePrefix: 'D' });
}

export function saveBeneficiary(id, data, user) {
  const payload = { ...data, pan: (data.pan || '').toUpperCase(), gstin: (data.gstin || '').toUpperCase(), ifsc: (data.ifsc || '').toUpperCase() };
  if (!id) Object.assign(payload, { totalAmount: 0, paymentCount: 0, lastPaymentDate: null, status: 'active' });
  return saveMaster(COL.beneficiaries, id, payload, user, { keywordFn: payeeKeywords, codeCounter: id ? null : 'payee', codePrefix: 'B' });
}

/**
 * Create a bank / cash account. The opening balance is recorded on the
 * account and in the financial-year's opening balance map.
 */
export async function createAccount(data, user) {
  const opening = round2(data.openingBalance || 0);
  const fyId = fyIdOf(data.openingDate);
  return runTransaction(db, async (tx) => {
    const fyRef = docRef(COL.financialYears, fyId);
    const fy = await tx.get(fyRef);
    if (!fy.exists()) throw new Error(`Create financial year ${fyId} first (Financial Year menu)`);
    if (fy.data().status !== 'open') throw new Error(`FY ${fyId} is ${fy.data().status}`);
    const ref = doc(colRef(COL.accounts));
    tx.set(ref, clean({
      ...data,
      openingBalance: opening,
      openingFyId: fyId,
      currentBalance: opening,
      status: 'active',
      ...createdStamp(user),
    }));
    tx.update(fyRef, { [`openingBalances.${ref.id}`]: opening });
    writeAudit(tx, user, { collection: COL.accounts, docId: ref.id, ref: data.name, action: 'create', changes: [{ field: 'openingBalance', old: null, new: opening }] });
    return ref.id;
  });
}

/** Super Admin only: change opening balance of an account for a FY (not closed) */
export async function changeOpeningBalance(accountId, fyId, newOpening, reason, user) {
  if (!reason) throw new Error('Reason is required');
  const value = round2(newOpening);
  return runTransaction(db, async (tx) => {
    const fyRef = docRef(COL.financialYears, fyId);
    const [fy, acc] = await Promise.all([tx.get(fyRef), tx.get(docRef(COL.accounts, accountId))]);
    if (!fy.exists() || fy.data().status !== 'open') throw new Error('Opening balance can only be changed in an OPEN financial year');
    const a = acc.data();
    if (a.openingFyId && a.openingFyId !== fyId) {
      throw new Error(`Opening balance of FY ${fyId} comes from the closing of the previous year. Correct the entries there (or use an adjustment entry) instead.`);
    }
    const old = round2(fy.data().openingBalances?.[accountId] ?? (a.openingFyId === fyId ? a.openingBalance : 0));
    const delta = round2(value - old);
    tx.update(fyRef, { [`openingBalances.${accountId}`]: value });
    const accPatch = { currentBalance: increment(delta), updatedAt: serverTimestamp() };
    if (a.openingFyId === fyId) accPatch.openingBalance = value;
    tx.update(docRef(COL.accounts, accountId), accPatch);
    writeAudit(tx, user, { collection: COL.accounts, docId: accountId, ref: a.name, action: 'opening_balance', reason, changes: [{ field: `openingBalance (${fyId})`, old, new: value }] });
  });
}

export async function setStatus(collName, id, status, user, reason) {
  const batch = writeBatch(db);
  batch.update(docRef(collName, id), { status, ...updatedStamp(user) });
  writeAudit(batch, user, { collection: collName, docId: id, action: 'status_change', changes: [{ field: 'status', old: null, new: status }], reason });
  await batch.commit();
}

export async function saveSettings(data, user) {
  return runTransaction(db, async (tx) => {
    const ref = docRef(COL.settings, 'trust');
    const s = await tx.get(ref);
    const old = s.exists() ? s.data() : {};
    const changes = diffObjects(old, { ...old, ...clean(data) });
    tx.set(ref, { ...clean(data), ...updatedStamp(user) }, { merge: true });
    if (changes.length) writeAudit(tx, user, { collection: COL.settings, docId: 'trust', ref: 'Trust settings', action: 'update', changes });
  });
}

'use client';

import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import {
  COL, DEFAULT_DONATION_CATEGORIES, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_TRUST_SETTINGS,
} from '@/lib/constants';
import { fyIdOf, fyRange, todayStr } from '@/lib/format';
import { colRef, doc, docRef, db, getDoc, writeBatch, serverTimestamp, writeAudit } from './db';

export async function isBootstrapped() {
  const s = await getDoc(docRef(COL.settings, 'bootstrap'));
  return s.exists();
}

/**
 * First-time setup:
 * 1) creates the Super Admin login + profile (allowed by rules only once)
 * 2) seeds trust settings, categories, Cash account and the current FY.
 */
export async function bootstrapTrust({ name, email, password, mobile, trust, cashOpening = 0 }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  const uid = cred.user.uid;
  const user = { uid, name, role: 'superAdmin', email };

  // step 1 – super admin profile + bootstrap marker
  const b1 = writeBatch(db);
  b1.set(docRef(COL.users, uid), {
    name, email, mobile: mobile || '', role: 'superAdmin', active: true, createdAt: serverTimestamp(), createdBy: uid,
  });
  b1.set(docRef(COL.settings, 'bootstrap'), { by: uid, at: serverTimestamp() });
  await b1.commit();

  // step 2 – master data
  const fyId = fyIdOf(todayStr());
  const { start, end } = fyRange(fyId);
  const cashRef = doc(colRef(COL.accounts));
  const b2 = writeBatch(db);
  b2.set(docRef(COL.settings, 'trust'), { ...DEFAULT_TRUST_SETTINGS, ...trust, updatedAt: serverTimestamp(), updatedBy: uid });
  DEFAULT_DONATION_CATEGORIES.forEach((c, i) => b2.set(doc(colRef(COL.donationCategories)), {
    ...c, isCorpus: !!c.isCorpus, showOnReceipt: !!c.showOnReceipt, active: true, order: i + 1, defaultFundId: null, createdAt: serverTimestamp(),
  }));
  DEFAULT_EXPENSE_CATEGORIES.forEach((c, i) => b2.set(doc(colRef(COL.expenseCategories)), {
    ...c, active: true, order: i + 1, createdAt: serverTimestamp(),
  }));
  b2.set(cashRef, {
    type: 'cash', name: 'Cash in Hand (रोकड़)', openingBalance: Number(cashOpening) || 0, openingDate: start, openingFyId: fyId,
    currentBalance: Number(cashOpening) || 0, status: 'active', createdAt: serverTimestamp(), createdBy: uid,
  });
  b2.set(docRef(COL.financialYears, fyId), {
    label: `FY ${fyId}`, startDate: start, endDate: end, status: 'open', isCurrent: true,
    openingBalances: { [cashRef.id]: Number(cashOpening) || 0 }, closingBalances: {}, assets: [], liabilities: [],
    audit: { status: 'draft' }, createdBy: uid, createdAt: serverTimestamp(),
  });
  writeAudit(b2, user, { collection: COL.settings, docId: 'trust', ref: 'Setup', action: 'bootstrap', summary: 'Initial setup completed' });
  await b2.commit();
  return uid;
}

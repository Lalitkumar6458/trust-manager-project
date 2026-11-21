import 'server-only';
import {
  COL, DEFAULT_DONATION_CATEGORIES, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_TRUST_SETTINGS,
} from '@/lib/constants';
import { fyIdOf, fyRange, todayStr } from '@/lib/format';
import { sql } from '../pg';
import { hashPassword, checkPasswordStrength } from '../auth';
import {
  colRef, doc, docRef, db, runTransaction, serverTimestamp, writeAudit, newId,
} from './db';

/** Setup is "done" once the marker exists or any login exists */
export async function isBootstrapped() {
  const r = await sql("SELECT (SELECT count(*) FROM user_credentials) + (SELECT count(*) FROM settings WHERE id = 'bootstrap') AS n");
  return Number(r.rows[0].n) > 0;
}

/**
 * First-time setup (only while no Super Admin exists):
 * creates the Super Admin login, trust settings, categories, Cash account and the current FY.
 */
export async function bootstrapTrust({ name, email, password, mobile, trust, cashOpening = 0 }) {
  if (await isBootstrapped()) throw Object.assign(new Error('Setup is already done. Please sign in.'), { status: 409 });
  if (!name || !email) throw new Error('Name and email are required');
  checkPasswordStrength(password);
  const em = String(email).trim().toLowerCase();
  const hash = await hashPassword(password);
  const uid = newId();
  const user = { uid, name, role: 'superAdmin', email: em };
  // ONE transaction: refused as soon as any login or the setup marker exists – setup can never
  // be used to change an existing account or overwrite trust data
  await runTransaction(db, async (tx) => {
    await tx.lock('setup');
    const used = await tx.client.query("SELECT (SELECT count(*) FROM user_credentials) + (SELECT count(*) FROM settings WHERE id = 'bootstrap') AS n");
    if (Number(used.rows[0].n) > 0) throw Object.assign(new Error('Setup is already done. Please sign in.'), { status: 409 });
    await tx.client.query('INSERT INTO users (id, data) VALUES ($1, $2)', [uid, {
      name, email: em, mobile: mobile || '', role: 'superAdmin', active: true, roleId: null, roleName: null, permissions: [], createdAt: new Date().toISOString(), createdBy: uid,
    }]);
    await tx.client.query('INSERT INTO user_credentials (user_id, email, password_hash) VALUES ($1, $2, $3)', [uid, em, hash]);
    const fyId = fyIdOf(todayStr());
    const { start, end } = fyRange(fyId);
    const cashRef = doc(colRef(COL.accounts));
    tx.set(docRef(COL.settings, 'bootstrap'), { by: uid, at: serverTimestamp() });
    tx.set(docRef(COL.settings, 'trust'), { ...DEFAULT_TRUST_SETTINGS, ...(trust || {}), updatedAt: serverTimestamp(), updatedBy: uid });
    DEFAULT_DONATION_CATEGORIES.forEach((c, i) => tx.set(doc(colRef(COL.donationCategories)), {
      ...c, isCorpus: !!c.isCorpus, showOnReceipt: !!c.showOnReceipt, active: true, order: i + 1, defaultFundId: null, createdAt: serverTimestamp(),
    }));
    DEFAULT_EXPENSE_CATEGORIES.forEach((c, i) => tx.set(doc(colRef(COL.expenseCategories)), {
      ...c, active: true, order: i + 1, createdAt: serverTimestamp(),
    }));
    tx.set(cashRef, {
      type: 'cash', name: 'Cash in Hand (रोकड़)', openingBalance: Number(cashOpening) || 0, openingDate: start, openingFyId: fyId,
      currentBalance: Number(cashOpening) || 0, status: 'active', createdAt: serverTimestamp(), createdBy: uid,
    });
    tx.set(docRef(COL.financialYears, fyId), {
      label: `FY ${fyId}`, startDate: start, endDate: end, status: 'open', isCurrent: true,
      openingBalances: { [cashRef.id]: Number(cashOpening) || 0 }, closingBalances: {}, assets: [], liabilities: [],
      audit: { status: 'draft' }, createdBy: uid, createdAt: serverTimestamp(),
    });
    writeAudit(tx, user, { collection: COL.settings, docId: 'trust', ref: 'Setup', action: 'bootstrap', summary: 'Initial setup completed' });
  });
  return uid;
}

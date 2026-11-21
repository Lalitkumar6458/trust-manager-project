import 'server-only';
import { COL, ROLES, MANUAL_TXN_TYPES } from '@/lib/constants';
import { normalizeSearch } from '@/lib/keywords';
import { assertCan, can, isSuper, assertCanRead, redact } from './access';
import { fetchAll, fetchOne, where, orderBy } from './services/db';
import * as don from './services/donations';
import * as exp from './services/expenses';
import * as led from './services/ledger';
import * as mas from './services/masters';
import * as clo from './services/closing';
import * as rec from './services/reconciliation';
import * as rol from './services/roles';
import * as sta from './services/stats';
import * as bak from './services/backup';
import * as docs from './services/documents';
import * as usr from './services/users';
import * as rv from './services/receiptVerify';
import { form10bd } from './services/form10bd';
import { saveCashCount } from './services/cashCount';
import * as plg from './services/pledges';
import * as recc from './services/recCreate';
import { tallyExport } from './services/tally';
import { saveBudget } from './services/budget';
import * as onl from './online';
import * as auth from './auth';
import { sql } from './pg';
import * as mon from './monitor';
import * as bkg from './services/bookings';
import * as sev from './services/seva';
import * as inv from './services/inventory';
import { saveAsset } from './services/assets';
import * as pay from './services/payroll';
import * as msg from './messaging';
import { setSecret, secretsSet } from './secrets';
import { arrayUnion, docRef, updateDoc } from './store';
import { changeOwnPassword } from './auth';

/** plan limit on active logins (multi-sanstha) */
async function assertUserLimit(u) {
  const max = u.license?.maxUsers;
  if (!max) return;
  const { rows } = await sql("SELECT count(*)::int AS n FROM users WHERE COALESCE(data->>'active', 'true') <> 'false'");
  if (rows[0].n >= max) throw Object.assign(new Error(`Your plan allows ${max} active users. Disable an old user or ask your software provider to upgrade the plan.`), { status: 402 });
}

// ------------------------------------------------------------------
// Every change the browser can ask for. Each entry checks the permission
// on the SERVER (the browser's own checks only hide buttons) and loads the
// trusted data it needs (financial year, accounts, settings …) from the
// database instead of taking it from the request.
// ------------------------------------------------------------------
const settingsDoc = async () => (await fetchOne(COL.settings, 'trust')) || {};
const accountsAll = () => fetchAll(COL.accounts);
const fysAll = () => fetchAll(COL.financialYears);
async function fyById(id) {
  const fy = id ? await fetchOne(COL.financialYears, id) : null;
  if (!fy) throw new Error('Financial year not found');
  return fy;
}
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/** fields that only move together with postings – never through a plain "save" */
const PROTECTED = {
  [COL.accounts]: ['currentBalance', 'openingBalance', 'openingFyId', 'lastTxnId', 'type'],
  [COL.funds]: ['received', 'spent'],
  [COL.donors]: ['totalAmount', 'donationCount', 'fyTotals', 'firstDonationDate', 'lastDonationDate', 'donorCode', 'code'],
  [COL.beneficiaries]: ['totalAmount', 'paymentCount', 'lastPaymentDate', 'code'],
};
const strip = (coll, data) => {
  // plain form fields only: no dotted paths (they would reach into protected maps), no __proto__ tricks
  const out = Object.fromEntries(Object.entries(data && typeof data === 'object' ? data : {}).filter(([k]) => !k.includes('.') && !k.startsWith('__') && k !== 'constructor' && k !== 'prototype'));
  ['id', 'createdAt', 'createdBy', 'createdByName', 'updatedAt', 'updatedBy', 'updatedByName', 'searchKeywords', ...(PROTECTED[coll] || [])].forEach((k) => delete out[k]);
  return out;
};
const MASTER_PERM = {
  [COL.funds]: 'funds.manage',
  [COL.trustees]: 'trustees.manage',
  [COL.accounts]: 'accounts.manage',
  [COL.donationCategories]: 'settings.manage',
  [COL.expenseCategories]: 'settings.manage',
};

async function donationCtx(user, flags = {}) {
  const [categories, accounts, settings, funds] = await Promise.all([fetchAll(COL.donationCategories), accountsAll(), settingsDoc(), fetchAll(COL.funds)]);
  return {
    user, categories, accounts, settings, funds,
    submit: !!flags.submit,
    approveNow: !!flags.approveNow && can(user, 'donations.approve') && can(user, 'donations.verify'),
  };
}
async function expenseCtx(user, flags = {}) {
  const [categories, accounts, funds, settings] = await Promise.all([fetchAll(COL.expenseCategories), accountsAll(), fetchAll(COL.funds), settingsDoc()]);
  return {
    user, categories, accounts, funds, settings,
    submit: !!flags.submit,
    approveNow: !!flags.approveNow && can(user, 'expenses.approve'),
    payNow: !!flags.payNow && can(user, 'expenses.approve') && can(user, 'expenses.pay'),
  };
}

export const RPC = {
  // ---------------- donations ----------------
  'donations.create': async ([input, flags], u) => {
    assertCan(u, 'donations.create');
    const ctx = await donationCtx(u, flags);
    const id = await don.createDonation(input, ctx);
    // sankalp instalment received
    if (input?.pledgeId && typeof input.pledgeId === 'string' && flags?.submit) {
      try { await plg.pledgeReceived(input.pledgeId, id, u); } catch (e) { console.error('pledge update failed', e.message); } // eslint-disable-line no-console
    }
    if (ctx.approveNow) msg.autoSendReceipt(id);
    return id;
  },
  'donations.update': async ([id, input], u) => { assertCan(u, 'donations.create', 'donations.verify'); return don.updateDonation(id, input, await donationCtx(u)); },
  'donations.submit': async ([id], u) => { assertCan(u, 'donations.create', 'donations.verify'); return don.submitDonation(id, u, await settingsDoc()); },
  'donations.verify': async ([id, note], u) => { assertCan(u, 'donations.verify'); return don.verifyDonation(id, u, note); },
  'donations.approve': async ([id, note], u) => {
    assertCan(u, 'donations.approve');
    const r = await don.approveDonation(id, u, note);
    msg.autoSendReceipt(id);
    return r;
  },
  'donations.void': async ([id, reason, opts], u) => { assertCan(u, 'finance.void'); return don.voidDonation(id, reason, u, { bounced: !!opts?.bounced }); },
  'donations.printed': async ([id], u) => { assertCan(u, 'donations.create', 'donations.verify', 'donations.approve'); return don.markReceiptPrinted(id, u); },

  // ---------------- expenses ----------------
  'expenses.create': async ([input, flags], u) => { assertCan(u, 'expenses.create'); return exp.createExpense(input, await expenseCtx(u, flags)); },
  'expenses.update': async ([id, input], u) => { assertCan(u, 'expenses.create', 'expenses.approve'); return exp.updateExpense(id, input, await expenseCtx(u)); },
  'expenses.submit': async ([id], u) => { assertCan(u, 'expenses.create', 'expenses.approve'); return exp.submitExpense(id, u, await settingsDoc()); },
  'expenses.approve': async ([id, note], u) => { assertCan(u, 'expenses.approve'); return exp.approveExpense(id, u, note); },
  'expenses.pay': async ([id, pay], u) => { assertCan(u, 'expenses.pay'); return exp.payExpense(id, pay || {}, u); },
  'expenses.void': async ([id, reason], u) => { assertCan(u, 'finance.void'); return exp.voidExpense(id, reason, u); },

  // ---------------- ledger ----------------
  'ledger.manual': async ([input], u) => {
    assertCan(u, 'ledger.manual');
    if (!MANUAL_TXN_TYPES.some((t) => t.value === input?.type)) throw bad('Invalid entry type');
    return led.createManualEntry(input, u);
  },
  'ledger.reverse': async ([id, reason], u) => { assertCan(u, 'ledger.manual', 'finance.void'); return led.reverseManualEntry(id, reason, u); },

  // ---------------- masters ----------------
  'masters.save': async ([coll, id, data], u) => {
    const perm = MASTER_PERM[coll];
    if (!perm) throw bad('This record type cannot be saved here');
    assertCan(u, perm);
    return mas.saveMaster(coll, id || null, strip(coll, data), u);
  },
  'masters.saveDonor': async ([id, data], u) => { assertCan(u, 'donors.edit', 'donations.create'); return mas.saveDonor(id || null, strip(COL.donors, data), u); },
  'masters.saveBeneficiary': async ([id, data], u) => { assertCan(u, 'beneficiaries.edit', 'expenses.create'); return mas.saveBeneficiary(id || null, strip(COL.beneficiaries, data), u); },
  'masters.createAccount': async ([data], u) => { assertCan(u, 'accounts.manage'); return mas.createAccount(data, u); },
  'masters.openingBalance': async ([accountId, fyId, amount, reason], u) => { assertCan(u, 'accounts.manage'); return mas.changeOpeningBalance(accountId, fyId, amount, reason, u); },
  'masters.setStatus': async ([coll, id, status, reason], u) => {
    const perm = MASTER_PERM[coll];
    if (!perm || !['active', 'inactive'].includes(status)) throw bad('Not allowed');
    assertCan(u, perm);
    return mas.setStatus(coll, id, status, u, reason);
  },
  'settings.save': async ([data], u) => { assertCan(u, 'settings.manage'); return mas.saveSettings(strip(COL.settings, data), u); },

  // ---------------- closing / financial year ----------------
  'closing.closeMonth': async ([{ monthKey, fyId, notes }], u) => { assertCan(u, 'closing.close'); return clo.closeMonth({ monthKey, fy: await fyById(fyId), accounts: await accountsAll(), user: u, notes }); },
  'closing.reopenMonth': async ([{ monthKey, fyId, reason }], u) => { assertCan(u, 'closing.reopen'); return clo.reopenMonth({ monthKey, fy: await fyById(fyId), user: u, reason }); },
  'closing.pending': async ([args], u) => { assertCan(u, 'closing.view', 'fy.view', 'closing.close'); return clo.pendingItems(args || {}); },
  'fy.create': async ([fyId, opts], u) => { assertCan(u, 'fy.manage'); return clo.createFinancialYear(fyId, u, { makeCurrent: !!opts?.makeCurrent, accounts: await accountsAll() }); },
  'fy.setCurrent': async ([fyId], u) => { assertCan(u, 'fy.manage'); return clo.setCurrentFy(fyId, await fysAll(), u); },
  'fy.checklist': async ([fyId], u) => { assertCan(u, 'fy.view', 'fy.manage'); return clo.fyChecklist(await fyById(fyId)); },
  'fy.close': async ([{ fyId, override }], u) => { assertCan(u, 'fy.manage'); return clo.closeFinancialYear({ fy: await fyById(fyId), accounts: await accountsAll(), user: u, override: !!override }); },
  'fy.recalc': async ([{ fyId }], u) => { assertCan(u, 'fy.manage'); return clo.recalcCarryForward({ fy: await fyById(fyId), accounts: await accountsAll(), user: u }); },
  'fy.reopen': async ([{ fyId, reason }], u) => { assertCan(u, 'fy.manage'); return clo.reopenFinancialYear({ fy: await fyById(fyId), user: u, reason }); },
  'fy.refreshOpening': async ([{ fyId }], u) => { assertCan(u, 'fy.manage'); return clo.refreshProvisionalOpening({ fy: await fyById(fyId), fys: await fysAll(), accounts: await accountsAll(), user: u }); },
  'fy.updateAudit': async ([{ fyId, patch, reason }], u) => {
    assertCan(u, 'audit.manage');
    const fy = await fyById(fyId);
    if (fy.status === 'finalized') throw bad('This financial year is finalized');
    if (patch?.status === 'finalized') assertCan(u, 'audit.finalize');
    return clo.updateAudit({ fy, patch: patch || {}, user: u, reason });
  },
  'fy.saveFields': async ([{ fyId, patch }], u) => {
    const fy = await fyById(fyId);
    if (fy.status === 'finalized') throw bad('This financial year is finalized');
    const keys = Object.keys(patch || {});
    const auditKeys = ['assets', 'liabilities'];
    const superKeys = [...auditKeys, 'cashVerified', 'cashVerifiedBy', 'cashVerifiedOn', 'notes'];
    if (keys.every((k) => auditKeys.includes(k))) assertCan(u, 'audit.manage', 'fy.manage');
    else if (keys.every((k) => superKeys.includes(k))) assertCan(u, 'fy.manage');
    else throw bad('These fields cannot be changed here');
    return clo.saveFyFields({ fy, patch, user: u });
  },

  // ---------------- reconciliation ----------------
  'rec.saveStatement': async ([{ accountId, fileName, lines, openingBalance, closingBalance }], u) => {
    assertCan(u, 'reconciliation.manage');
    const account = await fetchOne(COL.accounts, accountId);
    if (!account) throw bad('Account not found');
    if (!Array.isArray(lines) || lines.length > 20000) throw bad('Too many lines in one statement');
    return rec.saveStatement({ account, fileName: String(fileName || '').slice(0, 200), lines, openingBalance, closingBalance, user: u });
  },
  'rec.autoMatch': async ([statementId], u) => { assertCan(u, 'reconciliation.manage'); return rec.autoMatch(statementId, u); },
  'rec.manualMatch': async ([{ statementId, lineId, txnId }], u) => { assertCan(u, 'reconciliation.manage'); return rec.manualMatch({ statementId, lineId, txnId, user: u }); },
  'rec.unmatch': async ([{ statementId, lineId }], u) => { assertCan(u, 'reconciliation.manage'); return rec.unmatch({ statementId, lineId, user: u }); },
  'rec.donationFromLine': async ([input], u) => {
    assertCan(u, 'reconciliation.manage');
    assertCan(u, 'donations.approve');
    assertCan(u, 'donations.verify');
    const ctx = await donationCtx(u, { submit: true, approveNow: true });
    const r = await recc.donationFromLine(input || {}, ctx);
    msg.autoSendReceipt(r.donationId);
    return r;
  },
  'rec.ledgerFromLine': async ([input], u) => { assertCan(u, 'reconciliation.manage'); assertCan(u, 'ledger.manual'); return recc.ledgerFromLine(input || {}, u); },
  'rec.setIgnored': async ([{ statementId, lineId, ignored, reason }], u) => { assertCan(u, 'reconciliation.manage'); return rec.setIgnored({ statementId, lineId, ignored: !!ignored, reason, user: u }); },

  // ---------------- users & roles ----------------
  'users.create': async ([data], u) => { assertCan(u, 'users.manage'); await assertUserLimit(u); return usr.createStaffUser(data || {}, u); },
  'users.updateLogin': async ([data], u) => {
    assertCan(u, 'users.manage');
    if (data?.disabled === false && data?.uid) { const cur = await fetchOne(COL.users, data.uid); if (cur && cur.active === false) await assertUserLimit(u); }
    return usr.updateStaffLogin(data || {}, u);
  },
  'users.updateProfile': async ([uid, patch], u) => { if (uid !== u.uid) assertCan(u, 'users.manage'); return usr.updateUserProfile(uid, patch || {}, u); },
  'users.changeOwnPassword': async ([current, next], u) => changeOwnPassword(u, current, next),
  'roles.save': async ([data], u) => { assertCan(u, 'users.manage'); const old = data?.id ? await fetchOne(COL.roles, data.id) : null; return rol.saveRole(data || {}, u, old); },
  'roles.delete': async ([id], u) => {
    assertCan(u, 'users.manage');
    const role = await fetchOne(COL.roles, id);
    if (!role) throw bad('Role not found');
    return rol.deleteRole(role, u);
  },
  'roles.assign': async ([uid, value], u) => {
    assertCan(u, 'users.manage');
    const target = await fetchOne(COL.users, uid);
    if (!target) throw bad('User not found');
    if (uid === u.uid && value !== 'superAdmin') throw bad('You cannot change your own role');
    if (typeof value !== 'string' || !(Object.values(ROLES).includes(value) || /^custom:[A-Za-z0-9_-]+$/.test(value))) throw bad('Invalid role');
    return rol.assignRole(target, value, await fetchAll(COL.roles), u);
  },

  // ---------------- documents ----------------
  'documents.archive': async ([id, reason], u) => { assertCan(u, 'documents.archive'); return docs.archiveDocument(id, reason, u); },

  // ---------------- misc ----------------
  'stats.rebuild': async ([fyId], u) => {
    if (!(isSuper(u) || ['accountant'].includes(u.role) || can(u, 'ledger.manual') || can(u, 'donations.approve') || can(u, 'expenses.pay'))) assertCan(u, 'fy.manage');
    return sta.rebuildStats(await fyById(fyId));
  },
  'donors.import': async ([donors], u) => {
    if (!isSuper(u)) throw Object.assign(new Error('Only the Super Admin can import donors'), { status: 403 });
    if (!Array.isArray(donors) || donors.length > 20000) throw bad('Too many rows');
    return bak.importDonors(donors, u);
  },
  'search.global': async ([text], u) => {
    const term = normalizeSearch(text || '');
    if (term.length < 2) return [];
    const q = async (coll) => {
      try { assertCanRead(u, coll); } catch { return []; }
      const rows = await fetchAll(coll, where('searchKeywords', 'array-contains', term), orderBy('createdAt', 'desc'), { t: 'limit', n: 15 }).catch(() => []);
      return rows.map((r) => redact(u, coll, r));
    };
    const [dons, exps, donors, payees, txns] = await Promise.all([
      q(COL.donations), q(COL.expenses), q(COL.donors), q(COL.beneficiaries), q(COL.transactions),
    ]);
    return { dons, exps, donors, payees, txns };
  },
  // messages (email / WhatsApp)
  'messages.status': async (_a, u) => { assertCan(u, 'settings.manage'); return secretsSet(msg.SECRET_KEYS); },
  'messages.saveSettings': async ([messaging, secrets], u) => {
    assertCan(u, 'settings.manage');
    const keys = Object.keys(msg.DEFAULT_MESSAGING);
    const clean = Object.fromEntries(Object.entries(messaging || {}).filter(([k]) => keys.includes(k)).map(([k, v]) => [k, typeof v === 'string' ? v.trim().slice(0, 2000) : (typeof v === 'boolean' || typeof v === 'number' ? v : null)]));
    for (const k of msg.SECRET_KEYS) {
      if (secrets && typeof secrets[k] === 'string' && secrets[k] !== '') await setSecret(k, secrets[k].trim()); // eslint-disable-line no-await-in-loop
      if (secrets && secrets[k] === null) await setSecret(k, ''); // eslint-disable-line no-await-in-loop
    }
    return mas.saveSettings({ messaging: clean }, u);
  },
  'messages.test': async ([channel, to], u) => { assertCan(u, 'settings.manage'); return msg.sendTest(await settingsDoc(), { channel, to: String(to || '').trim() }); },
  'messages.sendReceipt': async ([donationId, channels], u) => {
    assertCan(u, 'messages.send');
    const ch = (Array.isArray(channels) ? channels : []).filter((c) => ['email', 'whatsapp'].includes(c));
    if (!ch.length) throw bad('Select email or WhatsApp');
    return msg.sendReceipt(String(donationId), ch, u);
  },
  // sankalp / pledges
  'pledges.save': async ([id, input], u) => { assertCan(u, 'pledges.manage'); return plg.savePledge(id || null, input, u); },
  'pledges.skip': async ([id, reason], u) => { assertCan(u, 'pledges.manage'); return plg.skipInstalment(id, reason, u); },
  // 2-step login (authenticator app)
  'auth.totpStatus': async (_a, u) => auth.totpStatus(u.uid),
  'auth.totpSetup': async (_a, u) => auth.totpSetup(u, (await settingsDoc()).nameEn || (await settingsDoc()).name || 'Trust Manager'),
  'auth.totpEnable': async ([code], u) => auth.totpEnable(u, code),
  'auth.totpDisable': async ([password], u) => {
    const s = await settingsDoc();
    if ((s.security?.require2fa || []).includes(u.role)) throw bad('2-step login is required for your role – ask the Super Admin to reset it if you changed your phone');
    return auth.totpDisable(u, password);
  },
  'users.twoFactorList': async (_a, u) => {
    assertCan(u, 'users.manage');
    const { rows } = await sql('SELECT user_id FROM user_credentials WHERE totp_enabled');
    return Object.fromEntries(rows.map((r) => [r.user_id, true]));
  },
  'users.reset2fa': async ([uid], u) => { assertCan(u, 'users.manage'); await auth.totpReset(String(uid)); return true; },
  'settings.security': async ([sec], u) => {
    assertCan(u, 'settings.manage');
    const roles = (Array.isArray(sec?.require2fa) ? sec.require2fa : []).filter((r) => ['superAdmin', 'accountant', 'operator', 'auditor', 'custom'].includes(r));
    return mas.saveSettings({ security: { require2fa: roles } }, u);
  },
  // hall / room booking
  'bookings.saveResource': async ([id, input], u) => { assertCan(u, 'settings.manage', 'bookings.manage'); return bkg.saveResource(id, input, u); },
  'bookings.save': async ([id, input], u) => { assertCan(u, 'bookings.manage'); return bkg.saveBooking(id, input, u); },
  'bookings.payment': async ([id, input], u) => { assertCan(u, 'bookings.manage'); assertCan(u, 'ledger.manual', 'donations.approve'); return bkg.bookingPayment(id, input, u); },
  'bookings.refund': async ([id, input], u) => { assertCan(u, 'bookings.manage'); assertCan(u, 'ledger.manual'); return bkg.refundDeposit(id, input, u); },
  // seva / pooja booking
  'seva.saveType': async ([id, input], u) => { assertCan(u, 'settings.manage', 'seva.manage'); return sev.saveSevaType(id, input, u); },
  'seva.book': async ([input], u) => {
    assertCan(u, 'seva.manage');
    if (input?.receipt) assertCan(u, 'donations.create');
    const ctx = await donationCtx(u, { submit: true, approveNow: !!input?.receipt?.approve });
    return sev.bookSeva(input, ctx);
  },
  'seva.receipt': async ([id, payInfo], u) => {
    assertCan(u, 'seva.manage'); assertCan(u, 'donations.create');
    const ctx = await donationCtx(u, { submit: true, approveNow: !!payInfo?.approve });
    const r = await sev.sevaReceipt(id, payInfo || {}, ctx);
    if (ctx.approveNow) msg.autoSendReceipt(r);
    return r;
  },
  'seva.status': async ([id, status, reason], u) => { assertCan(u, 'seva.manage'); return sev.setSevaStatus(id, status, reason, u); },
  // store / inventory
  'inventory.saveItem': async ([id, input], u) => { assertCan(u, 'inventory.manage'); return inv.saveItem(id, input, u); },
  'inventory.move': async ([input], u) => { assertCan(u, 'inventory.manage'); return inv.stockMove(input, u); },
  // asset register
  'assets.save': async ([id, input], u) => { assertCan(u, 'assets.manage'); return saveAsset(id, input, u); },
  // staff & salary
  'payroll.saveStaff': async ([id, input], u) => { assertCan(u, 'payroll.manage'); return pay.saveStaff(id, input, u); },
  'payroll.generate': async ([month, rows], u) => { assertCan(u, 'payroll.manage'); return pay.generatePayslips(month, rows, u); },
  'payroll.pay': async ([ids, payInfo], u) => {
    assertCan(u, 'payroll.manage'); assertCan(u, 'expenses.approve'); assertCan(u, 'expenses.pay');
    return pay.payPayslips(ids, payInfo, await expenseCtx(u, { submit: true }));
  },
  // system health / error log (Super Admin)
  'system.health': async (_a, u) => { assertCan(u, 'system.monitor'); return mon.systemHealth(); },
  'system.clearErrors': async (_a, u) => { assertCan(u, 'system.monitor'); await mon.clearErrors(); return true; },
  'system.alertEmail': async ([email], u) => {
    assertCan(u, 'system.monitor');
    const e = String(email || '').trim();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('Email is not valid');
    return mas.saveSettings({ monitor: { alertEmail: e } }, u);
  },
  // online donations (Razorpay)
  'online.status': async (_a, u) => { assertCan(u, 'settings.manage'); return secretsSet(onl.SECRET_KEYS); },
  'online.saveSettings': async ([online, secrets], u) => {
    assertCan(u, 'settings.manage');
    const o = online || {};
    const clean = {
      enabled: !!o.enabled, keyId: String(o.keyId || '').trim().slice(0, 80), accountId: String(o.accountId || ''), defaultCategoryId: String(o.defaultCategoryId || ''),
      categoryIds: Array.isArray(o.categoryIds) ? o.categoryIds.map(String).slice(0, 50) : [],
      minAmount: Math.max(1, Number(o.minAmount) || 1), maxAmount: Math.max(1, Number(o.maxAmount) || 500000),
      suggested: (Array.isArray(o.suggested) ? o.suggested : []).map(Number).filter((n) => n > 0).slice(0, 8),
      title: String(o.title || '').slice(0, 200), intro: String(o.intro || '').slice(0, 1000), thankYou: String(o.thankYou || '').slice(0, 500),
    };
    for (const k of onl.SECRET_KEYS) {
      if (secrets && typeof secrets[k] === 'string' && secrets[k] !== '') await setSecret(k, secrets[k].trim()); // eslint-disable-line no-await-in-loop
    }
    return mas.saveSettings({ online: clean }, u);
  },
  'online.retry': async ([id], u) => { assertCan(u, 'donations.approve'); return onl.retryOrder(String(id)); },
  // Tally export / budget
  'reports.tally': async ([opts], u) => { assertCan(u, 'reports.export'); const s = await settingsDoc(); return tallyExport({ ...(opts || {}), company: opts?.company || s?.tallyCompany || '' }); },
  'budget.save': async ([fyId, input], u) => { assertCan(u, 'budget.manage'); return saveBudget(fyId, input, u); },
  // cash count (denomination)
  'cash.count': async ([input], u) => { assertCan(u, 'cash.count'); return saveCashCount(input, u); },
  // receipt QR links (signed on the server)
  'receipts.verifyTokens': async ([ids], u) => {
    assertCanRead(u, COL.donations);
    if (!Array.isArray(ids) || ids.length > 1000) throw bad('Too many receipts');
    return rv.verifyTokens(ids);
  },
  // Form 10BD / 10BE data (80G)
  'reports.form10bd': async ([fyId], u) => { assertCan(u, 'reports.view'); return form10bd(fyId); },
  'reports.form10bdFiling': async ([fyId, filing], u) => {
    assertCan(u, 'settings.manage', 'reports.export');
    if (!/^\d{4}-\d{2}$/.test(String(fyId || ''))) throw bad('Select a financial year');
    const arn = String(filing?.arn || '').trim().slice(0, 40);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(filing?.date || '') ? filing.date : '';
    return mas.saveSettings({ form10bd: { [fyId]: { arn, date } } }, u);
  },
  'notifications.read': async ([ids], u) => {
    const list = (Array.isArray(ids) ? ids : [ids]).slice(0, 200);
    await Promise.all(list.map((id) => updateDoc(docRef(COL.notifications, id), { readBy: arrayUnion(u.uid) }).catch(() => {})));
    return true;
  },
};

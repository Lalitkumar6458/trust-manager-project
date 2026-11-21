import 'server-only';
import { COL } from '@/lib/constants';
import { fyIdOf, nextFyId, round2 } from '@/lib/format';
import { sql } from './pg';
import { fetchAll, fetchOne, where, writeBatch, docRef, serverTimestamp } from './services/db';
import { createFinancialYear } from './services/closing';

// ------------------------------------------------------------------
// Scheduled jobs (were Cloud Functions). Run by cron on the server:
//   /api/cron/monthly-report  – 1st of every month, 06:05 IST
//   /api/cron/daily-digest    – every day 09:00 IST
//   /api/cron/next-fy         – every day in March, 01:15 IST
// ------------------------------------------------------------------
const SYSTEM = { uid: 'system', name: 'System', role: 'superAdmin' };
const istNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
const pad = (n) => String(n).padStart(2, '0');
const NOTIFY_PERM = { monthly_report: 'reports.view', pending_digest: 'donations.verify', recon_pending: 'reconciliation.view', fy_created: 'fy.view', pledge_overdue: 'pledges.view' };

async function notify(type, title, message, link, roles = ['superAdmin', 'accountant', 'auditor']) {
  const b = writeBatch();
  b.set(docRef(COL.notifications, `${type}_${Date.now()}`), {
    type, title, message, link, roles: [...roles, ...(NOTIFY_PERM[type] ? [`perm:${NOTIFY_PERM[type]}`] : [])], readBy: [], createdAt: serverTimestamp(),
  });
  await b.commit();
}

export async function monthlyReport() {
  const now = istNow();
  let y = now.getFullYear();
  let m = now.getMonth(); // previous month
  if (m === 0) { m = 12; y -= 1; }
  const monthKey = `${y}-${pad(m)}`;
  const [dons, exps, txns] = await Promise.all([
    fetchAll(COL.donations, where('monthKey', '==', monthKey), where('status', '==', 'approved')),
    fetchAll(COL.expenses, where('monthKey', '==', monthKey), where('status', '==', 'paid')),
    sql("SELECT COALESCE(SUM((data->>'credit')::numeric),0) AS cin, COALESCE(SUM((data->>'debit')::numeric),0) AS cout FROM transactions WHERE data->'monthKey' = $1::jsonb", [JSON.stringify(monthKey)]),
  ]);
  const byKey = (rows, key) => rows.reduce((acc, r) => { const k = key(r) || '—'; acc[k] = round2((acc[k] || 0) + (r.amount || 0)); return acc; }, {});
  const report = {
    monthKey,
    financialYearId: fyIdOf(`${monthKey}-01`),
    donationTotal: round2(dons.reduce((s, d) => s + d.amount, 0)),
    donationCount: dons.length,
    donationByCategory: byKey(dons.flatMap((d) => d.lines || []), (l) => l.categoryName),
    donationByMode: byKey(dons, (d) => d.paymentMode),
    expenseTotal: round2(exps.reduce((s, e) => s + e.amount, 0)),
    expenseCount: exps.length,
    expenseByCategory: byKey(exps, (e) => e.categoryName),
    expenseByMode: byKey(exps, (e) => e.paymentMode),
    totalIn: round2(txns.rows[0].cin),
    totalOut: round2(txns.rows[0].cout),
    generatedAt: serverTimestamp(),
  };
  const b = writeBatch();
  b.set(docRef(COL.reports, `monthly_${monthKey}`), report);
  await b.commit();
  await notify('monthly_report', `Monthly report generated – ${monthKey}`, `Donation ₹${report.donationTotal} (${dons.length}), expense ₹${report.expenseTotal} (${exps.length}). Please complete monthly closing.`, '/reports/monthly-financial');
  return { monthKey };
}

export async function dailyDigest() {
  const count = async (t, statuses) => (await sql(`SELECT count(*)::int AS n FROM ${t} WHERE data->>'status' = ANY($1)`, [statuses])).rows[0].n;
  const fyId = fyIdOf(`${istNow().getFullYear()}-${pad(istNow().getMonth() + 1)}-01`);
  const [pendingDon, pendingExp, st] = await Promise.all([
    count('donations', ['submitted', 'verified']),
    count('expenses', ['submitted', 'approved']),
    fetchAll(COL.bankStatements, where('financialYearId', '==', fyId)),
  ]);
  const unrec = st.reduce((s, x) => s + Math.max(0, (x.lineCount || 0) - (x.matchedCount || 0) - (x.ignoredCount || 0)), 0);
  if (pendingDon || pendingExp) await notify('pending_digest', 'Pending verification / approval', `${pendingDon} donation(s) and ${pendingExp} expense(s) are waiting.`, '/dashboard', ['superAdmin', 'accountant']);
  if (unrec) await notify('recon_pending', 'Bank reconciliation pending', `${unrec} bank statement line(s) are not matched yet.`, '/reconciliation', ['superAdmin', 'accountant']);
  return { pendingDon, pendingExp, unrec };
}

/** In March: create next year's FY (provisional opening) so 1 April entries can be saved */
export async function ensureNextFy() {
  const now = istNow();
  const curId = fyIdOf(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`);
  const nextId = nextFyId(curId);
  if (await fetchOne(COL.financialYears, nextId)) return { created: false };
  await createFinancialYear(nextId, SYSTEM, { accounts: await fetchAll(COL.accounts) });
  await notify('fy_created', `FY ${nextId} created`, `Opening balances are provisional until FY ${curId} is closed.`, '/financial-years', ['superAdmin', 'accountant']);
  return { created: true, fyId: nextId };
}

/** Birthday / anniversary wishes to donors (WhatsApp template or email) – every morning */
export async function specialDays() {
  const { messagingOf, sendDonorMessage, fillTemplate } = await import('./messaging');
  const settings = (await fetchOne(COL.settings, 'trust')) || {};
  const cfg = messagingOf(settings);
  if (!cfg.birthdayGreetings && !cfg.anniversaryGreetings) return { skipped: 'off' };
  const now = istNow();
  const md = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const sent = { birthday: 0, anniversary: 0, failed: 0 };
  const run = async (field, occasion, kind) => {
    const donors = await fetchAll(COL.donors, where(field, '==', md));
    for (const d of donors) {
      if (d.status === 'inactive' || d.noMessages) continue;
      const vars = { name: d.name, occasion, trust: settings.name || '' };
      // eslint-disable-next-line no-await-in-loop
      const r = await sendDonorMessage(settings, { donor: d, kind, text: fillTemplate(cfg.greetingText, vars), template: cfg.waGreetingTemplate, params: [d.name, occasion, settings.name || ''], ref: `${kind}_${now.getFullYear()}` });
      if (r.some((x) => x.ok)) sent[kind] += 1; else if (r.length) sent.failed += 1;
    }
  };
  if (cfg.birthdayGreetings) await run('dobMD', 'जन्मदिन (Birthday)', 'birthday');
  if (cfg.anniversaryGreetings) await run('anniversaryMD', 'विवाह वर्षगाँठ (Anniversary)', 'anniversary');
  return sent;
}

/** Sankalp reminders: donor message a few days before the due date + staff notification for overdue */
export async function pledgeReminders() {
  const { messagingOf, sendDonorMessage, fillTemplate } = await import('./messaging');
  const { fmtDate, money } = await import('@/lib/format');
  const settings = (await fetchOne(COL.settings, 'trust')) || {};
  const cfg = messagingOf(settings);
  const today = `${istNow().getFullYear()}-${pad(istNow().getMonth() + 1)}-${pad(istNow().getDate())}`;
  const active = await fetchAll(COL.pledges, where('status', '==', 'active'));
  let reminded = 0;
  let overdue = 0;
  for (const p of active) {
    if (!p.nextDue) continue;
    const daysLeft = Math.round((new Date(p.nextDue) - new Date(today)) / 86400000);
    if (daysLeft < 0) overdue += 1;
    if (!cfg.pledgeReminders || p.lastReminderFor === p.nextDue) continue;
    if (daysLeft <= (p.remindDaysBefore ?? 3) && daysLeft >= -1) {
      const donor = await fetchOne(COL.donors, p.donorId); // eslint-disable-line no-await-in-loop
      if (!donor) continue;
      const vars = { name: donor.name, amount: money(p.amount), date: fmtDate(p.nextDue), trust: settings.name || '' };
      // eslint-disable-next-line no-await-in-loop
      const r = await sendDonorMessage(settings, { donor, kind: 'pledge_reminder', text: fillTemplate(cfg.reminderText, vars), template: cfg.waReminderTemplate, params: [vars.name, vars.amount, vars.date, vars.trust], ref: p.pledgeNo });
      if (r.some((x) => x.ok)) {
        reminded += 1;
        const b = writeBatch();
        b.update(docRef(COL.pledges, p.id), { lastReminderFor: p.nextDue, lastReminderAt: serverTimestamp() });
        await b.commit(); // eslint-disable-line no-await-in-loop
      }
    }
  }
  if (overdue) await notify('pledge_overdue', 'Sankalp due', `${overdue} sankalp instalment(s) are due / overdue.`, '/pledges', ['superAdmin', 'accountant', 'operator']);
  return { active: active.length, reminded, overdue };
}

export const JOBS = {
  'monthly-report': monthlyReport, 'daily-digest': dailyDigest, 'next-fy': ensureNextFy, 'special-days': specialDays, 'pledge-reminders': pledgeReminders,
};

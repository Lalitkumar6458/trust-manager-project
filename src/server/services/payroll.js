import 'server-only';
import dayjs from 'dayjs';
import { COL } from '@/lib/constants';
import { round2, todayStr, MOBILE_REGEX, PAN_REGEX } from '@/lib/format';
import { fetchAll, fetchOne, where, db, runTransaction, docRef, createdStamp, updatedStamp, writeAudit } from './db';
import { saveRecord, bad, amountOf, dateOf, pickFields } from './crud';
import { createExpense, approveExpense, payExpense } from './expenses';
import { saveBeneficiary } from './masters';

// ------------------------------------------------------------------
// Staff & salary. Monthly payslips (days worked, advance / other deductions, bonus);
// "Pay" makes a normal expense voucher (category: Salary) for each payslip,
// approves and pays it – so cash / bank book, ledger and reports update by themselves.
// ------------------------------------------------------------------

export async function saveStaff(id, input, user) {
  const d = pickFields(input, ['name', 'designation', 'mobile', 'joinDate', 'salary', 'bankAccount', 'ifsc', 'bankName', 'pan', 'address', 'status', 'notes', 'paymentMode']);
  if (!d.name) throw bad('Name is required');
  if (d.mobile && !MOBILE_REGEX.test(d.mobile)) throw bad('10 digit mobile');
  if (d.pan) { d.pan = d.pan.toUpperCase(); if (!PAN_REGEX.test(d.pan)) throw bad('PAN is not valid'); }
  if (d.ifsc) d.ifsc = d.ifsc.toUpperCase();
  d.joinDate = d.joinDate ? dateOf(d.joinDate, 'Joining date') : '';
  d.salary = amountOf(d.salary || 0, { allowZero: true, label: 'Salary' });
  d.status = d.status === 'left' ? 'left' : 'active';
  return saveRecord(COL.staff, id || null, d, user, {
    number: id ? null : { key: 'staff', prefix: 'ST-', field: 'code', width: 3 },
    keywords: (n) => ({ names: [n.name], exact: [n.code, n.mobile, n.pan] }),
    ref: (n) => n.code || n.name,
  });
}

/** month 'YYYY-MM'; rows [{ staffId, daysWorked, advance, otherDeduction, bonus, note }] → draft payslips */
export async function generatePayslips(month, rows, user) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw bad('Select month');
  const daysInMonth = dayjs(`${month}-01`).daysInMonth();
  const ids = [];
  for (const r of rows || []) {
    // eslint-disable-next-line no-await-in-loop
    const st = await fetchOne(COL.staff, r.staffId);
    if (!st) continue;
    const daysWorked = Math.max(0, Math.min(daysInMonth, Number(r.daysWorked ?? daysInMonth)));
    const gross = round2((st.salary * daysWorked) / daysInMonth);
    const bonus = round2(Math.max(0, Number(r.bonus) || 0));
    const advance = round2(Math.max(0, Number(r.advance) || 0));
    const otherDeduction = round2(Math.max(0, Number(r.otherDeduction) || 0));
    const net = round2(gross + bonus - advance - otherDeduction);
    if (net < 0) throw bad(`${st.name}: deductions are more than the salary`);
    const id = `${month}_${st.id}`;
    // eslint-disable-next-line no-await-in-loop
    await runTransaction(db, async (tx) => {
      const ref = docRef(COL.payslips, id);
      const s = await tx.get(ref);
      if (s.exists() && s.data().status === 'paid') throw bad(`${st.name}: salary for ${month} is already paid`);
      const data = {
        month, staffId: st.id, staffName: st.name, staffCode: st.code || '', designation: st.designation || '', monthlySalary: st.salary,
        daysInMonth, daysWorked, gross, bonus, advance, otherDeduction, net, note: String(r.note || '').slice(0, 200), status: 'draft',
      };
      if (s.exists()) tx.update(ref, { ...data, ...updatedStamp(user) });
      else tx.set(ref, { ...data, ...createdStamp(user) });
      writeAudit(tx, user, { collection: COL.payslips, docId: id, ref: `${st.name} ${month}`, action: s.exists() ? 'update' : 'create', summary: `Net ₹${net}` });
    });
    ids.push(id);
  }
  return ids;
}

/** pay draft payslips: one expense voucher each (create → approve → pay) */
export async function payPayslips(ids, pay, ctx) {
  const user = ctx.user;
  const settings = ctx.settings || {};
  const categoryId = pay?.categoryId || settings.payroll?.categoryId || ctx.categories.find((c) => /salary|वेतन/i.test(`${c.name} ${c.nameHi || ''}`))?.id;
  if (!ctx.categories.some((c) => c.id === categoryId)) throw bad('Select the expense category for salary');
  const account = ctx.accounts.find((a) => a.id === pay?.accountId);
  if (!account) throw bad('Select cash / bank account');
  const paymentMode = pay?.paymentMode || (account.type === 'cash' ? 'Cash' : 'Bank Transfer');
  const date = dateOf(pay?.date || todayStr());
  const done = [];
  for (const id of ids || []) {
    // eslint-disable-next-line no-await-in-loop
    const p = await fetchOne(COL.payslips, id);
    if (!p || p.status === 'paid' || !(p.net > 0)) continue;
    // eslint-disable-next-line no-await-in-loop
    const st = await fetchOne(COL.staff, p.staffId);
    let payeeId = st?.payeeId;
    if (!payeeId || !(await fetchOne(COL.beneficiaries, payeeId))) { // eslint-disable-line no-await-in-loop
      // eslint-disable-next-line no-await-in-loop
      payeeId = await saveBeneficiary(null, {
        name: st.name, type: 'staff', mobile: st.mobile || '', pan: st.pan || '', address: st.address || '',
        bankAccountNo: st.bankAccount || '', ifsc: st.ifsc || '', bankName: st.bankName || '', notes: `Staff ${st.code || ''}`,
      }, user);
      // eslint-disable-next-line no-await-in-loop
      await runTransaction(db, async (tx) => { await tx.get(docRef(COL.staff, st.id)); tx.update(docRef(COL.staff, st.id), { payeeId }); });
    }
    const lines = [{ particulars: `Salary ${dayjs(`${p.month}-01`).format('MMM YYYY')} (${p.daysWorked}/${p.daysInMonth} days)`, amount: p.gross }];
    if (p.bonus) lines.push({ particulars: 'Bonus / extra', amount: p.bonus });
    // deductions reduce the paid amount: shown as a negative-free line set (net) – keep the voucher equal to cash paid
    const voucherLines = p.advance || p.otherDeduction
      ? [{ particulars: `${lines.map((l) => `${l.particulars} ₹${l.amount}`).join(' + ')} − advance ₹${p.advance || 0} − other ₹${p.otherDeduction || 0}`.slice(0, 300), amount: p.net }]
      : lines;
    // eslint-disable-next-line no-await-in-loop
    const expenseId = await createExpense({
      date, categoryId, payeeId, lines: voucherLines, purpose: `Salary ${p.month} – ${p.staffName}`, paymentMode, accountId: account.id,
      utr: pay?.utr || '', remarks: `Payslip ${id}`,
    }, { ...ctx, submit: true });
    await approveExpense(expenseId, user, 'Salary (payroll)'); // eslint-disable-line no-await-in-loop
    await payExpense(expenseId, { paymentMode, accountId: account.id, date, utr: pay?.utr || '' }, user); // eslint-disable-line no-await-in-loop
    const e = await fetchOne(COL.expenses, expenseId); // eslint-disable-line no-await-in-loop
    // eslint-disable-next-line no-await-in-loop
    await runTransaction(db, async (tx) => {
      await tx.get(docRef(COL.payslips, id));
      tx.update(docRef(COL.payslips, id), { status: 'paid', expenseId, voucherNo: e?.voucherNo || '', paidDate: date, paidFrom: account.name, ...updatedStamp(user) });
      writeAudit(tx, user, { collection: COL.payslips, docId: id, ref: `${p.staffName} ${p.month}`, action: 'paid', summary: `Voucher ${e?.voucherNo} ₹${p.net}` });
    });
    done.push({ id, expenseId, voucherNo: e?.voucherNo });
  }
  return done;
}

export async function staffList() { return fetchAll(COL.staff, where('status', '==', 'active')); }

#!/usr/bin/env node
/**
 * Fresh start with DEMO data (local testing only).
 *
 *   npm run dev                       (keep it running in one terminal)
 *   npm run seed:demo -- --reset      (second terminal: empties the local database, creates logins + demo data)
 *
 * Options:  --reset          empty all tables + uploads first (asks for confirmation)
 *           --donations 300  number of demo donations (default 300)
 *           --expenses 80    number of demo expenses (default 80)
 *           --url http://localhost:3000
 *
 * Everything is created through the app's own server actions, so receipts, ledger, balances,
 * donor totals and the year summary are exactly as if a person had entered them.
 * Logins created (password for all: demo12345):
 *   admin@demo.test (Super Admin) · accountant@demo.test · operator@demo.test · auditor@demo.test
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env.local', '.env']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p) && !process.env.DATABASE_URL) process.loadEnvFile(p);
}
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const BASE = opt('url', 'http://localhost:3000');
const N_DON = Number(opt('donations', 300));
const N_EXP = Number(opt('expenses', 80));
const PASSWORD = 'demo12345';
const die = (m) => { console.error(`✖ ${m}`); process.exit(1); };

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) die('DATABASE_URL is not set (.env.local)');
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl) && !opt('yes-not-local', false)) die('This is only for a LOCAL database (DATABASE_URL must point to localhost).');

const db = new pg.Client({ connectionString: dbUrl });
await db.connect().catch(() => die('Cannot connect to PostgreSQL. Start it:  brew services start postgresql@16   (or run: bash scripts/setup-mac.sh)'));

// ---------------- talk to the running app ----------------
let cookie = '';
async function call(url, body) {
  let res;
  try {
    res = await fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  } catch {
    die(`Cannot reach ${BASE}. Start the app first:  npm run dev`);
  }
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${url}: ${json.error || res.status}`);
  return json;
}
const rpc = async (name, ...args) => (await call('/api/rpc', { name, args })).result;
const list = async (coll, cons = []) => (await call('/api/query', { coll, cons, mode: 'list' })).rows;

// make sure BASE really is this app (another project may be running on the same port)
const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
if (!health || !('db' in health)) {
  die(`${BASE} is not the Trust Manager app (another app may be using this port, or it is not started).
  Look at the "npm run dev" terminal – it prints "Local: http://localhost:XXXX" – and run:
    npm run seed:demo -- --reset --url http://localhost:XXXX`);
}
if (health.db !== 'up') die('The app cannot reach PostgreSQL – start it: brew services start postgresql@16');
// ---------------- reset ----------------
if (opt('reset', false)) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question('ALL data in the local database will be deleted. Type YES: ');
  rl.close();
  if (ans.trim() !== 'YES') die('Cancelled');
  const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'")).rows.map((r) => r.tablename);
  await db.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`);
  fs.rmSync(path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'uploads')), { recursive: true, force: true });
  console.log('✔ Local database emptied');
}

const status = await (await fetch(`${BASE}/api/setup`)).json();
if (status.done) die('The database already has a trust. Run with --reset to start fresh.');

// ---------------- setup + logins ----------------
await call('/api/setup', {
  name: 'Demo Admin', email: 'admin@demo.test', password: PASSWORD, mobile: '9000000000', cashOpening: 50000,
  trust: { name: 'श्री शावलाजी सेवा संस्थान', nameEn: 'Shree Shavlaji Seva Sansthan', address: '20/2, शिवम फ्लैट, बापूनगर, अहमदाबाद - 380024', phones: '9723878021', registrationNo: 'E/24833/अहमदाबाद', pan: 'ABOTS3964Q' },
});
console.log('✔ Setup done – admin@demo.test');
for (const [role, email, name] of [['accountant', 'accountant@demo.test', 'Demo Accountant'], ['operator', 'operator@demo.test', 'Demo Operator'], ['auditor', 'auditor@demo.test', 'Demo Auditor']]) {
  await rpc('users.create', { name, email, password: PASSWORD, role });
}
// demo logins: no forced password change
await db.query('UPDATE user_credentials SET must_change = false');
console.log('✔ Logins: accountant / operator / auditor @demo.test');

// ---------------- masters ----------------
const fy = (await list('financialYears'))[0];
const cash = (await list('accounts')).find((a) => a.type === 'cash');
const cats = await list('donationCategories');
const ecats = await list('expenseCategories');
const sbi = await rpc('masters.createAccount', { type: 'bank', name: 'SBI Savings', bankName: 'State Bank of India', branch: 'Bapunagar', accountNumber: '30112345678', ifsc: 'SBIN0001234', openingBalance: 500000, openingDate: fy.startDate });
const bob = await rpc('masters.createAccount', { type: 'bank', name: 'Bank of Baroda Current', bankName: 'Bank of Baroda', branch: 'Naroda', accountNumber: '04520200001234', ifsc: 'BARB0NARODA', openingBalance: 200000, openingDate: fy.startDate });
const fundA = await rpc('masters.save', 'funds', null, { name: 'Gaushala Nirman', description: 'Cow shelter construction', target: 1000000, status: 'active' });
const fundB = await rpc('masters.save', 'funds', null, { name: 'Shiksha Sahayata', description: 'Education support', target: 300000, status: 'active' });
await rpc('masters.save', 'trustees', null, { name: 'Ramesh Patel', designation: 'President', mobile: '9876500001', status: 'active' });
await rpc('masters.save', 'trustees', null, { name: 'Suresh Shah', designation: 'Treasurer', mobile: '9876500002', status: 'active' });

const first = ['Ramesh', 'Suresh', 'Mahesh', 'Kiran', 'Anita', 'Sunita', 'Prakash', 'Jignesh', 'Hetal', 'Bhavesh', 'Nita', 'Rakesh', 'Pooja', 'Vijay', 'Meena', 'Dinesh', 'Kavita', 'Alpesh', 'Rekha', 'Manoj'];
const last = ['Patel', 'Shah', 'Mehta', 'Desai', 'Joshi', 'Trivedi', 'Parmar', 'Chauhan', 'Solanki', 'Modi'];
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const pan = () => `${'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('').sort(() => Math.random() - 0.5).slice(0, 3).join('')}P${'ABCDEFGH'[Math.floor(Math.random() * 8)]}${1000 + Math.floor(Math.random() * 8999)}${'ABCDEFGHJK'[Math.floor(Math.random() * 10)]}`;
const donorIds = [];
for (let i = 0; i < 60; i += 1) {
  const org = i % 12 === 0;
  donorIds.push(await rpc('masters.saveDonor', null, {
    name: org ? `${rnd(last)} Traders` : `${rnd(first)} ${rnd(last)}`, donorType: org ? 'Company' : 'Individual',
    mobile: `98${String(10000000 + i * 7919).slice(0, 8)}`, address: `${10 + i}, Bapunagar, Ahmedabad`, pan: i % 3 ? pan() : '', email: i % 4 ? '' : `donor${i}@example.com`,
  }));
}
const payeeIds = [];
for (const [name, type] of [['Shyam Tent House', 'vendor'], ['Gujarat Electricity', 'vendor'], ['Om Printers', 'vendor'], ['Krishna Kirana', 'vendor'], ['Shanti Medical', 'vendor'], ['Lakshmi Ben', 'beneficiary'], ['Ravi Kumar', 'beneficiary'], ['Gita Devi', 'beneficiary'], ['Mohan Lal', 'staff'], ['Sarva Shiksha School', 'organization']]) {
  payeeIds.push(await rpc('masters.saveBeneficiary', null, { name, type, mobile: `97${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` }));
}
console.log('✔ Accounts, funds, trustees, 60 donors, 10 beneficiaries / vendors');

// ---------------- donations & expenses ----------------
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const start = new Date(fy.startDate);
const days = Math.max(1, Math.floor((new Date(today) - start) / 864e5));
const dayStr = (i, n) => new Date(start.getTime() + Math.floor((i / n) * days) * 864e5).toISOString().slice(0, 10);
const MODES = ['Cash', 'Cash', 'UPI', 'UPI', 'NEFT', 'Cheque', 'Bank Transfer'];
let ok = 0;
for (let i = 0; i < N_DON; i += 1) {
  const mode = rnd(MODES);
  const c1 = rnd(cats);
  const lines = [{ categoryId: c1.id, amount: [101, 251, 501, 1100, 2100, 5100, 11000][Math.floor(Math.random() * 7)], fundId: i % 9 === 0 ? fundA : i % 13 === 0 ? fundB : null }];
  if (i % 7 === 0) lines.push({ categoryId: rnd(cats).id, amount: 501 });
  const stage = i % 20 === 0 ? 'draft' : i % 15 === 0 ? 'submit' : 'approve';
  try {
    await rpc('donations.create', {
      date: dayStr(i, N_DON), donorId: rnd(donorIds), lines, paymentMode: mode, accountId: mode === 'Cash' ? cash.id : (i % 2 ? sbi : bob),
      utr: mode === 'UPI' || mode === 'NEFT' ? `UTR${100000000 + i}` : '', chequeNo: mode === 'Cheque' ? String(500100 + i) : '', purpose: i % 5 ? '' : 'Bhandara',
    }, { submit: stage !== 'draft', approveNow: stage === 'approve' });
    ok += 1;
  } catch (e) { if (ok === 0) console.warn('  donation:', e.message); }
  if (i % 50 === 49) console.log(`  … ${i + 1} donations`);
}
console.log(`✔ ${ok} donations (most approved, some submitted / draft)`);
let eok = 0;
for (let i = 0; i < N_EXP; i += 1) {
  const cashPay = i % 4 === 0;
  const amount = cashPay ? [200, 450, 800, 1200][i % 4] : [1500, 3200, 5000, 8500, 12000, 25000][i % 6];
  try {
    await rpc('expenses.create', {
      date: dayStr(i, N_EXP), payeeId: rnd(payeeIds), categoryId: rnd(ecats).id, lines: [{ particulars: rnd(['Tent & sound', 'Electricity bill', 'Printing', 'Grocery for bhandara', 'Medicines', 'School fees', 'Salary']), amount }],
      paymentMode: cashPay ? 'Cash' : rnd(['UPI', 'NEFT', 'Cheque']), accountId: cashPay ? cash.id : sbi, fundId: i % 10 === 0 ? fundA : null, billNo: `B-${1000 + i}`,
    }, { submit: true, approveNow: i % 8 !== 0, payNow: i % 8 !== 0 && i % 11 !== 0 });
    eok += 1;
  } catch (e) { if (eok === 0) console.warn('  expense:', e.message); }
}
console.log(`✔ ${eok} expenses (most paid, some waiting for approval / payment)`);

// ---------------- ledger entries ----------------
const mid = dayStr(1, 2);
await rpc('ledger.manual', { type: 'cash_deposit', date: mid, amount: 20000, fromAccountId: cash.id, toAccountId: sbi, reference: 'DEP-001', description: 'Cash deposited in bank' }).catch((e) => console.warn('  deposit:', e.message));
await rpc('ledger.manual', { type: 'transfer', date: mid, amount: 50000, fromAccountId: sbi, toAccountId: bob, reference: 'TRF-001' }).catch(() => {});
await rpc('ledger.manual', { type: 'interest', date: today, amount: 1840, accountId: sbi, reference: 'INT-Q2' }).catch(() => {});
await rpc('ledger.manual', { type: 'bank_charges', date: today, amount: 118, accountId: bob, reference: 'CHG' }).catch(() => {});
console.log('✔ Cash deposit, bank transfer, interest, bank charges');

// ---------------- newer modules (sankalp, seva, hall booking, store, assets, staff, budget) ----------------
const soft = async (label, fn) => { try { await fn(); } catch (e) { console.warn(`  ${label}:`, e.message); } };
const addDays = (d, n) => new Date(new Date(d).getTime() + n * 864e5).toISOString().slice(0, 10);
await soft('sankalp', async () => {
  for (let i = 0; i < 6; i += 1) {
    await rpc('pledges.save', null, { donorId: donorIds[i * 3], categoryId: cats[i % cats.length].id, amount: [501, 1100, 2100][i % 3], frequency: ['monthly', 'monthly', 'quarterly', 'yearly', 'monthly', 'halfYearly'][i], startDate: addDays(today, i * 3 - 6), remindDaysBefore: 3 });
  }
});
await soft('seva', async () => {
  const cat = cats[0];
  const types = [];
  for (const [name, nameHi, amount, dailyLimit, time] of [['Abhishek', 'अभिषेक', 501, 5, '06:00 AM'], ['Annadaan', 'अन्नदान', 2100, 0, '12:00 PM'], ['Sandhya Aarti', 'संध्या आरती', 251, 10, '07:00 PM']]) {
    types.push(await rpc('seva.saveType', null, { name, nameHi, amount, categoryId: cat.id, dailyLimit, time }));
  }
  for (let i = 0; i < 8; i += 1) {
    await rpc('seva.book', { sevaTypeId: types[i % 3], sevaDate: addDays(today, i % 3), devotee: { name: `${rnd(first)} ${rnd(last)}`, mobile: `98${String(10000000 + i * 7919).slice(0, 8)}`, gotra: rnd(['Kashyap', 'Bharadwaj', 'Vashishtha']) }, receipt: i % 2 === 0 ? { paymentMode: 'Cash', accountId: cash.id, approve: true } : null });
  }
});
await soft('hall booking', async () => {
  const hall = await rpc('bookings.saveResource', null, { name: 'Satsang Hall', type: 'hall', capacity: 400, rentPerDay: 11000, deposit: 5000 });
  const room = await rpc('bookings.saveResource', null, { name: 'Dharamshala Room 1', type: 'room', capacity: 4, rentPerDay: 500, deposit: 0 });
  const b1 = await rpc('bookings.save', null, { resourceId: hall, fromDate: addDays(today, 5), toDate: addDays(today, 6), guest: { name: 'Mehta Parivar', mobile: '9825011111' }, purpose: 'Wedding', persons: 300 });
  await rpc('bookings.payment', b1, { amount: 11000, kind: 'rent', accountId: sbi, date: today });
  await rpc('bookings.save', null, { resourceId: room, fromDate: today, toDate: addDays(today, 2), guest: { name: 'Yatri – Joshi ji', mobile: '9825022222' }, status: 'checked_in' });
});
await soft('store', async () => {
  for (const [name, nameHi, unit, category, minStock, rate, qty] of [['Ghee', 'घी', 'kg', 'pooja', 5, 620, 12], ['Sugar', 'शक्कर', 'kg', 'prasad', 20, 44, 50], ['Agarbatti', 'अगरबत्ती', 'packet', 'pooja', 30, 25, 18], ['Rice', 'चावल', 'kg', 'kitchen', 50, 60, 100]]) {
    const id = await rpc('inventory.saveItem', null, { name, nameHi, unit, category, minStock, rate });
    await rpc('inventory.move', { itemId: id, type: 'purchase', qty, rate, reference: 'Demo' });
    if (category === 'kitchen') await rpc('inventory.move', { itemId: id, type: 'issue', qty: 30, party: 'Bhandara' });
  }
});
await soft('assets', async () => {
  await rpc('assets.save', null, { name: 'Temple building', category: 'building', purchaseDate: '2015-04-15', cost: 4500000, depRate: 10, depMethod: 'wdv', location: 'Campus' });
  await rpc('assets.save', null, { name: 'Generator 15 kVA', category: 'machinery', purchaseDate: '2024-06-10', cost: 185000, depRate: 15, depMethod: 'wdv', location: 'Store' });
  await rpc('assets.save', null, { name: 'Silver mukut', category: 'ornaments', purchaseDate: '2022-11-01', cost: 95000, weight: '1.2 kg, 92.5', location: 'Locker' });
});
await soft('staff', async () => {
  await rpc('payroll.saveStaff', null, { name: 'Pandit Shivshankar', designation: 'Pujari', salary: 18000, mobile: '9898011111', joinDate: '2020-01-01' });
  await rpc('payroll.saveStaff', null, { name: 'Ramji Bhai', designation: 'Security guard', salary: 12000, mobile: '9898022222', joinDate: '2022-07-01' });
});
await soft('budget', async () => {
  await rpc('budget.save', fy.id, { income: Object.fromEntries(cats.slice(0, 4).map((c) => [c.id, 300000])), expense: Object.fromEntries(ecats.slice(0, 5).map((c) => [c.id, 150000])) });
});
console.log('✔ Sankalp, seva, hall booking, store, assets, staff, budget');

await db.end();
console.log(`
==================================================================
 Demo data ready.  Open ${BASE}/login
   admin@demo.test        Super Admin
   accountant@demo.test   Accountant
   operator@demo.test     Data entry
   auditor@demo.test      Auditor / CA
   password for all:      ${PASSWORD}
==================================================================`);

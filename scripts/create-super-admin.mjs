#!/usr/bin/env node
/**
 * Create the first Super Admin (and seed default master data) using the Firebase Admin SDK.
 *
 * Usage:
 *   npm run create-admin
 *   npm run create-admin -- --email admin@trust.org --password Secret@123 --name "Mangalam"
 *   npm run create-admin -- --key ./service-account.json        (use a downloaded key file)
 *   npm run create-admin -- --no-seed                           (only create the login + role)
 *   npm run create-admin -- --cash 25000                        (opening cash in hand for current FY)
 *
 * Credentials (any one):
 *   1. FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY in .env.local
 *   2. --key <path to service-account JSON>   (Firebase console → Project settings → Service accounts → Generate new private key)
 *   3. GOOGLE_APPLICATION_CREDENTIALS env var
 *
 * Admin SDK bypasses security rules, so this works even before rules are deployed.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------- helpers ----------------
function loadEnvFile(file) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
function currentFy() {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { id: `${y}-${pad((y + 1) % 100)}`, start: `${y}-04-01`, end: `${y + 1}-03-31` };
}

const ok = (m) => console.log(`\x1b[32m✔\x1b[0m ${m}`);
const info = (m) => console.log(`\x1b[36mℹ\x1b[0m ${m}`);
const fail = (m) => { console.error(`\x1b[31m✖ ${m}\x1b[0m`); process.exit(1); };

// ---------------- main ----------------
loadEnvFile('.env.local');
loadEnvFile('.env');
const args = parseArgs(process.argv.slice(2));

// credentials
let credential;
let projectId;
if (args.key) {
  const keyPath = path.resolve(process.cwd(), args.key);
  if (!fs.existsSync(keyPath)) fail(`Key file not found: ${keyPath}`);
  const sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  credential = cert(sa);
  projectId = sa.project_id;
} else if (process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
  projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  credential = cert({
    projectId,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
  });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  credential = applicationDefault();
  projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
} else {
  fail('No Firebase Admin credentials.\n  Either add FIREBASE_ADMIN_* to .env.local, or run with  --key ./service-account.json\n  (Firebase console → Project settings → Service accounts → Generate new private key)');
}

initializeApp({ credential, projectId });
const auth = getAuth();
const db = getFirestore();
info(`Firebase project: ${projectId}`);

// inputs
const rl = readline.createInterface({ input, output });
const ask = async (q, def) => {
  const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim();
  return a || def || '';
};
const name = args.name || await ask('Super Admin name');
const email = (args.email || await ask('Login email')).toLowerCase();
const mobile = args.mobile || (args.email ? '' : await ask('Mobile (optional)'));
let password = args.password || '';
if (!password) password = await ask('Password (min 8 characters)');
rl.close();

if (!name) fail('Name is required');
if (!/^\S+@\S+\.\S+$/.test(email)) fail('Valid email is required');
if (password.length < 8) fail('Password must be at least 8 characters');

try {
  // 1) Auth user (create or reuse)
  let user;
  try {
    user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { password, displayName: name, disabled: false });
    info(`Login already existed – password & name updated (${user.uid})`);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    user = await auth.createUser({ email, password, displayName: name, emailVerified: true });
    ok(`Login created (${user.uid})`);
  }
  const { uid } = user;

  // 2) Role profile
  await db.collection('users').doc(uid).set({
    name, email, mobile: mobile || '', role: 'superAdmin', active: true,
    createdAt: FieldValue.serverTimestamp(), createdBy: 'script',
  }, { merge: true });
  ok('users/' + uid + ' → role: superAdmin');

  // 3) Bootstrap marker (closes the /setup page)
  const bootRef = db.collection('settings').doc('bootstrap');
  if (!(await bootRef.get()).exists) {
    await bootRef.set({ by: uid, at: FieldValue.serverTimestamp(), via: 'script' });
    ok('settings/bootstrap created');
  }

  // 4) Seed default master data (only if not done yet)
  const trustRef = db.collection('settings').doc('trust');
  if (args['no-seed']) {
    info('Skipping master data (--no-seed)');
  } else if ((await trustRef.get()).exists) {
    info('Trust settings already exist – master data not touched');
  } else {
    const C = await import(pathToFileURL(path.join(ROOT, 'src/lib/constants.js')).href);
    const fy = currentFy();
    const cash = Number(args.cash) || 0;
    const batch = db.batch();
    batch.set(trustRef, { ...C.DEFAULT_TRUST_SETTINGS, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
    C.DEFAULT_DONATION_CATEGORIES.forEach((c, i) => batch.set(db.collection('donationCategories').doc(), {
      ...c, isCorpus: !!c.isCorpus, showOnReceipt: !!c.showOnReceipt, active: true, order: i + 1, defaultFundId: null, createdAt: FieldValue.serverTimestamp(),
    }));
    C.DEFAULT_EXPENSE_CATEGORIES.forEach((c, i) => batch.set(db.collection('expenseCategories').doc(), {
      ...c, active: true, order: i + 1, createdAt: FieldValue.serverTimestamp(),
    }));
    const cashRef = db.collection('accounts').doc();
    batch.set(cashRef, {
      type: 'cash', name: 'Cash in Hand (रोकड़)', openingBalance: cash, openingDate: fy.start, openingFyId: fy.id,
      currentBalance: cash, status: 'active', createdAt: FieldValue.serverTimestamp(), createdBy: uid,
    });
    const fyRef = db.collection('financialYears').doc(fy.id);
    if (!(await fyRef.get()).exists) {
      batch.set(fyRef, {
        label: `FY ${fy.id}`, startDate: fy.start, endDate: fy.end, status: 'open', isCurrent: true,
        openingBalances: { [cashRef.id]: cash }, closingBalances: {}, assets: [], liabilities: [],
        audit: { status: 'draft' }, createdBy: uid, createdAt: FieldValue.serverTimestamp(),
      });
    }
    batch.set(db.collection('auditLogs').doc(), {
      collection: 'settings', docId: 'trust', ref: 'Setup', action: 'bootstrap', summary: 'Initial setup via create-super-admin script',
      changes: [], reason: '', userId: uid, userName: name, role: 'superAdmin', device: 'script', at: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    ok(`Seeded: trust settings, ${C.DEFAULT_DONATION_CATEGORIES.length} donation & ${C.DEFAULT_EXPENSE_CATEGORIES.length} expense categories, Cash account, FY ${fy.id}`);
    info('Edit trust name / address / receipt text later in Settings. Use --cash <amount> to set opening cash.');
  }

  console.log(`\n\x1b[1mDone!\x1b[0m  Login at http://localhost:3000/login\n  Email:    ${email}\n  Password: (the one you entered)\n`);
  process.exit(0);
} catch (e) {
  fail(e.message || String(e));
}

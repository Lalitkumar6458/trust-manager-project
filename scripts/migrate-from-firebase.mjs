#!/usr/bin/env node
/**
 * One-time move of ALL data from Firebase (Firestore + Authentication + Storage) into PostgreSQL.
 *
 *   npm run migrate:firebase -- --key ./service-account.json [--hash-config ./hash-config.txt] [--force]
 *
 * Options
 *   --key <file>           Firebase service-account JSON (Firebase console → Project settings → Service accounts →
 *                          Generate new private key). Without it the old FIREBASE_ADMIN_* values from .env.firebase /
 *                          .env.local are used.
 *   --bucket <name>        Storage bucket (default: NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET or <project>.firebasestorage.app)
 *   --hash-config <file>   Password hash parameters (Firebase console → Authentication → Users → ⋮ → Password hash
 *                          parameters → copy the text into a file). With it every staff member keeps his password.
 *                          Without it each login gets a temporary password (written to migration-temp-passwords.csv).
 *   --skip-files           Do not download uploaded documents / images
 *   --force                Empty the PostgreSQL tables first (when re-running the migration)
 *   --from-json <file>     Read a JSON export { collection: { id: data } } instead of Firestore (testing / offline)
 *
 * Firebase is only READ – nothing is changed or deleted there.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// .env.firebase = the old Firebase settings (kept by scripts/setup-mac.sh)
for (const f of ['.env.local', '.env.firebase', '.env']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) { try { process.loadEnvFile(p); } catch { /* ignore */ } }
}
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : null; };
const FORCE = !!opt('force');
const SKIP_FILES = !!opt('skip-files');
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'));

const COLLECTIONS = {
  settings: 'settings', counters: 'counters', users: 'users', trustees: 'trustees', donors: 'donors', beneficiaries: 'beneficiaries',
  accounts: 'accounts', funds: 'funds', donationCategories: 'donation_categories', expenseCategories: 'expense_categories',
  donations: 'donations', expenses: 'expenses', transactions: 'transactions', bankStatements: 'bank_statements',
  statementLines: 'statement_lines', monthlyClosings: 'monthly_closings', financialYears: 'financial_years', reports: 'reports',
  auditLogs: 'audit_logs', documents: 'documents', notifications: 'notifications', roles: 'roles', stats: 'stats',
};

const log = (...a) => console.log(...a);
const die = (m) => { console.error(`✖ ${m}`); process.exit(1); };
if (!process.env.DATABASE_URL) die('DATABASE_URL is not set (.env.local)');

// ---------------- value conversion ----------------
/** Firestore value → plain JSON (timestamps → ISO strings) */
function plain(v) {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v?.toDate === 'function') return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v);
    // JSON exports of timestamps: {_seconds,_nanoseconds} / {seconds,nanoseconds}
    if ((keys.length === 2 && '_seconds' in v && '_nanoseconds' in v) || (keys.length === 2 && 'seconds' in v && 'nanoseconds' in v)) {
      const s = v._seconds ?? v.seconds; const n = v._nanoseconds ?? v.nanoseconds;
      return new Date(s * 1000 + Math.floor(n / 1e6)).toISOString();
    }
    if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && keys.length === 2) return { lat: v.latitude, lng: v.longitude };
    if (v.path && v.firestore) return v.path; // DocumentReference
    if (typeof v.toBase64 === 'function') return v.toBase64(); // Bytes
    const out = {};
    keys.forEach((k) => { out[k] = plain(v[k]); });
    return out;
  }
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}

// ---------------- password hashes ----------------
const scrypt = promisify(crypto.scrypt);
async function ownHash(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}
function readHashConfig(file) {
  if (!file) return null;
  const t = fs.readFileSync(file, 'utf8');
  const get = (k) => (t.match(new RegExp(`${k}\\s*[:=]\\s*"?([^",\\n}]+)"?`)) || [])[1]?.trim();
  const cfg = { signer: get('base64_signer_key'), sep: get('base64_salt_separator'), rounds: Number(get('rounds')), mem: Number(get('mem_cost')) };
  if (!cfg.signer || !cfg.sep || !cfg.rounds || !cfg.mem) die(`Could not read the password hash parameters from ${file}`);
  return cfg;
}
const tempPassword = () => `${crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x')}#${crypto.randomInt(10, 99)}`;

// ---------------- sources ----------------
async function firebaseSource() {
  let admin;
  try {
    admin = {
      app: await import('firebase-admin/app'),
      fs: await import('firebase-admin/firestore'),
      auth: await import('firebase-admin/auth'),
      storage: await import('firebase-admin/storage'),
    };
  } catch {
    die('firebase-admin is not installed. Run:  npm install firebase-admin --no-save');
  }
  let credential;
  let projectId;
  const keyFile = opt('key');
  if (keyFile) {
    const json = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    credential = admin.app.cert(json);
    projectId = json.project_id;
  } else if (process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
    credential = admin.app.cert({ projectId, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n') });
  } else die('Give --key <service-account.json> (or the old FIREBASE_ADMIN_* values in .env.local)');
  const bucketName = opt('bucket') || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
  const app = admin.app.initializeApp({ credential, projectId, storageBucket: bucketName });
  const db = admin.fs.getFirestore(app);
  const bucket = admin.storage.getStorage(app).bucket(bucketName);
  return {
    name: `Firebase project ${projectId}`,
    async* docs(coll) {
      let last = null;
      for (;;) {
        let q = db.collection(coll).orderBy(admin.fs.FieldPath.documentId()).limit(1000);
        if (last) q = q.startAfter(last);
        // eslint-disable-next-line no-await-in-loop
        const s = await q.get();
        if (s.empty) return;
        for (const d of s.docs) yield { id: d.id, data: d.data() };
        last = s.docs[s.docs.length - 1].id;
        if (s.size < 1000) return;
      }
    },
    async authUsers() {
      const out = [];
      let token;
      do {
        // eslint-disable-next-line no-await-in-loop
        const r = await admin.auth.getAuth(app).listUsers(1000, token);
        r.users.forEach((u) => out.push({ uid: u.uid, email: u.email, disabled: u.disabled, passwordHash: u.passwordHash, passwordSalt: u.passwordSalt }));
        token = r.pageToken;
      } while (token);
      return out;
    },
    async download(storagePath) {
      const [buf] = await bucket.file(storagePath).download();
      return buf;
    },
  };
}

function jsonSource(file) {
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    name: `JSON export ${file}`,
    async* docs(coll) { for (const [id, data] of Object.entries(dump[coll] || {})) yield { id, data }; },
    async authUsers() { return dump.__authUsers || []; },
    async download(storagePath) {
      const f = dump.__files?.[storagePath];
      if (!f) throw new Error('not in export');
      return Buffer.from(f, 'base64');
    },
  };
}

/** gs path of a Firebase Storage download URL (…/o/<encoded path>?alt=media…) */
function storagePathOf(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/o\/([^/]+)$/);
    if (m) return decodeURIComponent(m[1]);
    const parts = u.pathname.split('/').filter(Boolean); // storage.googleapis.com/<bucket>/<path>
    if (u.hostname === 'storage.googleapis.com' && parts.length > 1) return decodeURIComponent(parts.slice(1).join('/'));
  } catch { /* not a URL */ }
  return null;
}
const isFirebaseUrl = (v) => typeof v === 'string' && /firebasestorage\.googleapis\.com|\.firebasestorage\.app|storage\.googleapis\.com/.test(v);
const fileUrl = (rel) => `/api/files/${rel.split('/').map(encodeURIComponent).join('/')}`;
const safeRel = (p) => p.split('/').map((s) => s.replace(/[^\w.\-()ऀ-ॿ ]+/g, '_').replace(/\s+/g, '_')).filter((s) => s && s !== '..').join('/');

async function saveDownloaded(src, storagePath, stats) {
  const rel = safeRel(storagePath);
  const abs = path.join(UPLOAD_DIR, rel);
  if (!fs.existsSync(abs)) {
    const buf = await src.download(storagePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    stats.bytes += buf.length;
  }
  stats.files += 1;
  return rel;
}

// ---------------- main ----------------
const src = opt('from-json') ? jsonSource(opt('from-json')) : await firebaseSource();
const hashCfg = readHashConfig(opt('hash-config'));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows.map((r) => r.tablename);
if (!tables.includes('donations')) die('Tables are missing – run  npm run db:migrate  first');
const existing = Number((await client.query('SELECT (SELECT count(*) FROM donations) + (SELECT count(*) FROM users) AS n')).rows[0].n);
if (existing && !FORCE) die('PostgreSQL already has data. Re-run with --force to replace it (all current PostgreSQL data will be deleted).');

log(`Source: ${src.name}`);
log(`Target: ${process.env.DATABASE_URL.replace(/:[^:@/]+@/, ':****@')}`);
log(`Files:  ${SKIP_FILES ? 'skipped' : UPLOAD_DIR}\n`);

const counts = {};
const fileStats = { files: 0, bytes: 0, failed: [] };
const tempPasswords = [];
try {
  await client.query('BEGIN');
  if (FORCE) {
    await client.query(`TRUNCATE ${Object.values(COLLECTIONS).join(', ')}, user_credentials, sessions CASCADE`);
    log('Emptied PostgreSQL tables.');
  }
  for (const [coll, table] of Object.entries(COLLECTIONS)) {
    let n = 0;
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      const values = batch.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
      await client.query(`INSERT INTO ${table} (id, data) VALUES ${values} ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, batch.flatMap((r) => [r.id, JSON.stringify(r.data)]));
      batch = [];
    };
    for await (const d of src.docs(coll)) {
      const data = plain(d.data) || {};
      // uploaded files: download into UPLOAD_DIR and point the record at /api/files/…
      if (!SKIP_FILES && coll === 'documents' && (data.storagePath || isFirebaseUrl(data.url))) {
        const sp = data.storagePath || storagePathOf(data.url);
        try {
          const rel = await saveDownloaded(src, sp, fileStats);
          data.storagePath = rel; data.url = fileUrl(rel);
        } catch (e) { fileStats.failed.push(`${sp}: ${e.message}`); }
      }
      if (!SKIP_FILES && coll === 'settings') {
        for (const [k, v] of Object.entries(data)) {
          if (!isFirebaseUrl(v)) continue;
          const sp = storagePathOf(v);
          if (!sp) continue;
          try { data[k] = fileUrl(await saveDownloaded(src, sp, fileStats)); } catch (e) { fileStats.failed.push(`${sp}: ${e.message}`); }
        }
      }
      if (coll === 'users' && data.email) data.email = String(data.email).toLowerCase();
      batch.push({ id: d.id, data });
      n += 1;
      if (batch.length >= 500) await flush();
    }
    await flush();
    counts[coll] = n;
    log(`  ${coll.padEnd(20)} ${String(n).padStart(7)}`);
  }

  // ---------------- logins ----------------
  const authUsers = await src.authUsers();
  const profiles = new Map((await client.query('SELECT id, data FROM users')).rows.map((r) => [r.id, r.data]));
  let kept = 0;
  for (const u of authUsers) {
    const prof = profiles.get(u.uid);
    if (!prof || !u.email) continue; // a login without a staff profile is not moved
    let hash;
    let mustChange = false;
    if (hashCfg && u.passwordHash && u.passwordSalt) {
      hash = ['fbscrypt', hashCfg.rounds, hashCfg.mem, hashCfg.sep, hashCfg.signer, u.passwordSalt, u.passwordHash].join('$');
      kept += 1;
    } else {
      const pw = tempPassword();
      hash = await ownHash(pw);
      mustChange = true;
      tempPasswords.push([prof.name || '', u.email, pw]);
    }
    await client.query('INSERT INTO user_credentials (user_id, email, password_hash, must_change) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, must_change = EXCLUDED.must_change',
      [u.uid, String(u.email).toLowerCase(), hash, mustChange]);
    if (u.disabled && prof.active !== false) await client.query("UPDATE users SET data = data || '{\"active\": false}'::jsonb WHERE id = $1", [u.uid]);
  }
  log(`\n  logins moved: ${kept + tempPasswords.length} (${kept} keep their password, ${tempPasswords.length} got a temporary password)`);
  const noLogin = [...profiles.values()].filter((p) => p.email && !authUsers.some((u) => u.email?.toLowerCase() === p.email)).map((p) => p.email);
  if (noLogin.length) log(`  staff profiles without a Firebase login (Super Admin can set a password in Users): ${noLogin.join(', ')}`);

  // ---------------- checks ----------------
  const problems = [];
  const acc = (await client.query('SELECT id, data FROM accounts')).rows;
  const fys = (await client.query('SELECT id, data FROM financial_years')).rows;
  const cur = fys.find((f) => f.data.isCurrent) || fys.sort((a, b) => b.id.localeCompare(a.id))[0];
  if (cur) {
    for (const a of acc) {
      const r = await client.query("SELECT COALESCE(SUM((data->>'credit')::numeric - (data->>'debit')::numeric), 0) AS net FROM transactions WHERE data->>'accountId' = $1 AND data->>'financialYearId' = $2", [a.id, cur.id]);
      const opening = Number(cur.data.openingBalances?.[a.id] ?? (a.data.openingFyId === cur.id ? a.data.openingBalance : 0)) || 0;
      const later = await client.query("SELECT COALESCE(SUM((data->>'credit')::numeric - (data->>'debit')::numeric), 0) AS net FROM transactions WHERE data->>'accountId' = $1 AND data->>'financialYearId' > $2", [a.id, cur.id]);
      const expect = Math.round((opening + Number(r.rows[0].net) + Number(later.rows[0].net)) * 100) / 100;
      const actual = Math.round((Number(a.data.currentBalance) || 0) * 100) / 100;
      if (expect !== actual) problems.push(`${a.data.name}: balance ₹${actual} but opening + ledger = ₹${expect}`);
    }
  }
  // the trust is set up – /setup must never run on this database
  await client.query("INSERT INTO settings (id, data) VALUES ('bootstrap', $1) ON CONFLICT (id) DO NOTHING", [{ by: 'migration', at: new Date().toISOString() }]);
  await client.query('INSERT INTO audit_logs (id, data) VALUES ($1, $2)', [`migration_${Date.now()}`, {
    collection: 'system', docId: null, ref: 'Firebase → PostgreSQL', action: 'import', summary: `Data moved from ${src.name}`,
    changes: Object.entries(counts).map(([k, v]) => ({ field: k, old: null, new: v })), reason: '', userId: 'system', userName: 'Migration', role: 'system',
    device: 'migrate-from-firebase', searchKeywords: ['migration'], at: new Date().toISOString(),
  }]);
  await client.query('COMMIT');

  log(`\n  files downloaded: ${fileStats.files} (${Math.round(fileStats.bytes / 1024 / 1024 * 10) / 10} MB)`);
  if (fileStats.failed.length) log(`  ⚠ ${fileStats.failed.length} file(s) could not be downloaded:\n    ${fileStats.failed.slice(0, 20).join('\n    ')}`);
  if (problems.length) log(`\n  ⚠ Balance check (current FY ${cur?.id}):\n    ${problems.join('\n    ')}\n    (these differences already existed in Firebase – check them in the Cash Book / Bank Book)`);
  else log(`\n  ✔ Balance check passed: every account balance = opening + ledger (FY ${cur?.id || '-'})`);
  if (tempPasswords.length) {
    const out = path.join(ROOT, 'migration-temp-passwords.csv');
    fs.writeFileSync(out, `Name,Email,Temporary password\n${tempPasswords.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')}\n`, { mode: 0o600 });
    log(`\n  Temporary passwords → ${out}\n  Give each person his password; he must choose a new one at first sign-in. DELETE this file afterwards.`);
  }
  log('\n✔ Migration finished. Start the app and sign in.');
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\n✖ Migration failed – nothing was changed in PostgreSQL.\n', e);
  process.exitCode = 1;
} finally {
  await client.end();
}

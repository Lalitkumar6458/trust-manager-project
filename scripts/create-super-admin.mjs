#!/usr/bin/env node
/**
 * Create a Super Admin login – or reset the password of an existing one (lock-out recovery).
 *
 *   npm run create-admin
 *   npm run create-admin -- --email admin@trust.org --name "Mangalam"
 *
 * The password is asked interactively (never put it on the command line – it would stay in
 * the shell history). First-time setup of a NEW trust is easier from the browser: open /setup.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env.local', '.env']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p) && !process.env.DATABASE_URL) process.loadEnvFile(p);
}
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));

async function askHidden(rl, q) {
  const stdout = process.stdout;
  const write = stdout.write.bind(stdout);
  let muted = false;
  stdout.write = (chunk, ...rest) => (muted && typeof chunk === 'string' && !chunk.includes(q) ? true : write(chunk, ...rest));
  const p = rl.question(q);
  muted = true;
  const ans = await p;
  muted = false;
  stdout.write = write;
  write('\n');
  return ans;
}

const scrypt = promisify(crypto.scrypt);
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}
const newId = () => crypto.randomBytes(15).toString('base64url').slice(0, 20);

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set (.env.local)'); process.exit(1); }
const rl = readline.createInterface({ input, output });
const email = String(args.email || await rl.question('Super Admin email: ')).trim().toLowerCase();
const name = String(args.name || await rl.question('Name: ') || 'Super Admin').trim();
const password = await askHidden(rl, 'Password (min 8 characters): ');
const again = await askHidden(rl, 'Repeat password: ');
rl.close();
if (!email || !email.includes('@')) { console.error('Valid email required'); process.exit(1); }
if (password.length < 8) { console.error('Password must be at least 8 characters'); process.exit(1); }
if (password !== again) { console.error('Passwords do not match'); process.exit(1); }

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  const hash = await hashPassword(password);
  const found = await client.query('SELECT user_id FROM user_credentials WHERE email = $1', [email]);
  if (found.rows[0]) {
    const uid = found.rows[0].user_id;
    await client.query("UPDATE users SET data = data || $2::jsonb WHERE id = $1", [uid, JSON.stringify({ role: 'superAdmin', active: true, roleId: null, roleName: null, permissions: [] })]);
    await client.query('UPDATE user_credentials SET password_hash = $2, must_change = false, failed_attempts = 0, locked_until = NULL WHERE user_id = $1', [uid, hash]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [uid]);
    console.log(`✔ ${email} is now an active Super Admin with the new password.`);
  } else {
    const boot = await client.query("SELECT 1 FROM settings WHERE id = 'bootstrap'");
    if (!boot.rows.length) throw new Error('This database has no trust set up yet. Open /setup in the browser instead (it creates the Super Admin together with the trust profile).');
    const uid = newId();
    await client.query('INSERT INTO users (id, data) VALUES ($1, $2)', [uid, {
      name, email, mobile: '', role: 'superAdmin', active: true, roleId: null, roleName: null, permissions: [], createdAt: new Date().toISOString(), createdBy: 'script',
    }]);
    await client.query('INSERT INTO user_credentials (user_id, email, password_hash) VALUES ($1, $2, $3)', [uid, email, hash]);
    console.log(`✔ Super Admin ${email} created.`);
  }
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

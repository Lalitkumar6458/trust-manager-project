#!/usr/bin/env node
/**
 * Owner (software provider) login for the control panel – or reset its password.
 *
 *   npm run control:owner
 *   npm run control:owner -- --email you@yourbrand.in --name "Mangalam"
 *
 * Password is asked interactively (never on the command line – it would stay in shell history).
 * For automated setups only: CONTROL_OWNER_PASSWORD in the environment.
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
  if (fs.existsSync(p)) process.loadEnvFile(p);
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

if (!process.env.CONTROL_DATABASE_URL) { console.error('CONTROL_DATABASE_URL is not set (.env.local) – multi-sanstha mode is off'); process.exit(1); }
const rl = readline.createInterface({ input, output });
const email = String(args.email || await rl.question('Owner email: ')).trim().toLowerCase();
const name = String(args.name || (process.env.CONTROL_OWNER_PASSWORD ? 'Owner' : await rl.question('Name: ')) || 'Owner').trim();
let password = process.env.CONTROL_OWNER_PASSWORD || '';
if (!password) {
  password = await askHidden(rl, 'Password (min 10 characters): ');
  const again = await askHidden(rl, 'Repeat password: ');
  if (password !== again) { rl.close(); console.error('Passwords do not match'); process.exit(1); }
}
rl.close();
if (!email.includes('@')) { console.error('Valid email required'); process.exit(1); }
if (password.length < 10) { console.error('Password must be at least 10 characters'); process.exit(1); }

const c = new pg.Client({ connectionString: process.env.CONTROL_DATABASE_URL });
await c.connect();
const { rows: [chk] } = await c.query("SELECT to_regclass('public.owners') AS t");
if (!chk.t) {
  await c.end();
  console.error('The control database has no tables yet. Run first:  npm run db:migrate   (it should say "Mode: multi-sanstha")');
  process.exit(1);
}
const hash = await hashPassword(password);
const { rows } = await c.query('SELECT id FROM owners WHERE email = $1', [email]);
if (rows.length) {
  await c.query('UPDATE owners SET password_hash = $2, failed_attempts = 0, locked_until = NULL WHERE id = $1', [rows[0].id, hash]);
  await c.query('DELETE FROM owner_sessions WHERE owner_id = $1', [rows[0].id]);
  console.log(`Password reset for ${email}.`);
} else {
  await c.query('INSERT INTO owners (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [crypto.randomBytes(10).toString('hex'), email, name, hash]);
  console.log(`Owner login created: ${email}`);
}
await c.end();

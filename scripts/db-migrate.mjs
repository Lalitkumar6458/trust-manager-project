#!/usr/bin/env node
// Applies db/migrations/*.sql (in name order) that have not run yet.
//   npm run db:migrate
// Multi-sanstha mode (CONTROL_DATABASE_URL set): migrates the control database (db/control)
// and then EVERY sanstha database listed in it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrateDatabase, MIGRATIONS_DIR, CONTROL_MIGRATIONS_DIR } from '../src/server/migrator.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
// always read .env.local (values already set in the shell win – loadEnvFile never overwrites them)
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) process.loadEnvFile(p);
}
console.log(process.env.CONTROL_DATABASE_URL ? 'Mode: multi-sanstha (CONTROL_DATABASE_URL found)\n' : 'Mode: single trust (no CONTROL_DATABASE_URL)\n');
const log = (s) => process.stdout.write(s);

try {
  if (process.env.CONTROL_DATABASE_URL) {
    console.log('Control database:');
    const a = await migrateDatabase(process.env.CONTROL_DATABASE_URL, CONTROL_MIGRATIONS_DIR(), log);
    console.log(a.length ? `${a.length} migration(s) applied.` : 'up to date.');
    const c = new pg.Client({ connectionString: process.env.CONTROL_DATABASE_URL });
    await c.connect();
    const { rows } = await c.query('SELECT slug, db_name FROM tenants WHERE deleted_at IS NULL ORDER BY slug');
    await c.end();
    for (const t of rows) {
      const u = new URL(process.env.TENANT_DATABASE_URL || process.env.CONTROL_DATABASE_URL);
      u.pathname = `/${t.db_name}`;
      console.log(`\nSanstha ${t.slug} (${t.db_name}):`);
      const n = await migrateDatabase(u.toString(), MIGRATIONS_DIR(), log);
      console.log(n.length ? `${n.length} migration(s) applied.` : 'up to date.');
    }
  } else {
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL is not set (put it in .env.local)');
      process.exit(1);
    }
    const n = await migrateDatabase(process.env.DATABASE_URL, MIGRATIONS_DIR(), log);
    console.log(n.length ? `${n.length} migration(s) applied.` : 'Database is up to date.');
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

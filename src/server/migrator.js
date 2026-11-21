// Applies *.sql migrations (name order) that have not run yet on one database.
// Plain Node (no Next.js aliases) – used by scripts/db-migrate.mjs and by sanstha provisioning.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const MIGRATIONS_DIR = () => path.join(/* turbopackIgnore: true */ process.cwd(), 'db', 'migrations');
export const CONTROL_MIGRATIONS_DIR = () => path.join(/* turbopackIgnore: true */ process.cwd(), 'db', 'control');

/** → names of the files applied now */
export async function migrateDatabase(connectionString, dir = MIGRATIONS_DIR(), log = () => {}) {
  const client = new pg.Client({ connectionString, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  const applied = [];
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      log(`→ ${f} … `);
      try {
        await client.query('BEGIN');
        await client.query(text);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        log('ok\n');
        applied.push(f);
      } catch (e) {
        await client.query('ROLLBACK');
        log('FAILED\n');
        throw new Error(`${f}: ${e.message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

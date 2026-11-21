import 'server-only';
import crypto from 'node:crypto';
import { sql } from './pg';
import { tenantKey, isControlRequest } from './tenant';

// ------------------------------------------------------------------
// Error log: server 500s and browser crashes are stored in error_logs
// (same error on the same page on the same day = one row with a counter).
// Super Admin sees them in System health; a new server error can be emailed.
// ------------------------------------------------------------------
const recent = new Map(); // throttle per key (avoid DB storms)

export async function logError({ kind = 'server', message, stack, path = '', user = null, userAgent = '', extra = null }) {
  // the owner control panel has no sanstha database – its errors only go to the server log
  if (await isControlRequest()) return;
  try {
    const msg = String(message || 'Unknown error').slice(0, 500);
    const day = new Date().toISOString().slice(0, 10);
    const key = crypto.createHash('sha1').update(`${kind}|${msg}|${String(path).split('?')[0]}|${day}`).digest('hex').slice(0, 24);
    const tk = `${await tenantKey().catch(() => '')}|${key}`;
    const now = Date.now();
    if (recent.has(tk) && now - recent.get(tk) < 2000) return;
    recent.set(tk, now);
    if (recent.size > 2000) recent.clear();
    const data = {
      kind, message: msg, stack: String(stack || '').slice(0, 4000), path: String(path).slice(0, 300), day,
      lastUser: user ? `${user.name || user.email || user.uid}` : '', userAgent: String(userAgent).slice(0, 200), extra,
      at: new Date().toISOString(),
    };
    const r = await sql(
      `INSERT INTO error_logs (id, data) VALUES ($1, $2::jsonb || jsonb_build_object('count', 1, 'firstAt', $3::text))
       ON CONFLICT (id) DO UPDATE SET data = error_logs.data || jsonb_build_object('count', COALESCE((error_logs.data->>'count')::int, 1) + 1, 'at', $3::text, 'lastUser', $4::text)
       RETURNING (data->>'count')::int AS n`,
      [key, JSON.stringify(data), data.at, data.lastUser],
    );
    if (kind === 'server' && r.rows[0]?.n === 1) alert(data).catch(() => {});
  } catch (e) {
    console.error('logError failed', e.message); // eslint-disable-line no-console
  }
}

async function alert(data) {
  const { fetchOne } = await import('./services/db');
  const s = (await fetchOne('settings', 'trust')) || {};
  const to = s.monitor?.alertEmail;
  if (!to || !s.messaging?.emailEnabled) return;
  const { sendEmail } = await import('./messaging');
  await sendEmail(s, { to, subject: `⚠ Server error – ${s.name || 'Trust Manager'}`, text: `${data.message}\n\nPage: ${data.path}\nUser: ${data.lastUser}\nTime: ${data.at}\n\n${data.stack.slice(0, 1500)}` });
}

/** numbers for the System health page */
export async function systemHealth() {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');
  const out = { time: new Date().toISOString(), node: process.version, uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576) };
  try {
    const t = Date.now();
    const r = await sql("SELECT pg_database_size(current_database()) AS size, (SELECT count(*) FROM sessions WHERE expires_at > now()) AS sessions, version() AS v");
    out.db = { ok: true, ms: Date.now() - t, sizeMb: Math.round(Number(r.rows[0].size) / 1048576), sessions: Number(r.rows[0].sessions), version: String(r.rows[0].v).split(',')[0] };
  } catch (e) { out.db = { ok: false, error: e.message }; }
  try {
    const st = await fs.statfs(/* turbopackIgnore: true */ process.cwd());
    out.disk = { freeGb: Math.round((st.bavail * st.bsize) / 1073741824 * 10) / 10, totalGb: Math.round((st.blocks * st.bsize) / 1073741824 * 10) / 10 };
  } catch { out.disk = null; }
  out.load = os.loadavg().map((x) => Math.round(x * 100) / 100);
  try {
    const dir = process.env.BACKUP_DIR || '/var/backups/trust-manager';
    const files = (await fs.readdir(/* turbopackIgnore: true */ dir)).filter((f) => f.startsWith('db_'));
    const stats = await Promise.all(files.map(async (f) => ({ f, m: (await fs.stat(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dir, f))).mtime })));
    const last = stats.sort((a, b) => b.m - a.m)[0];
    out.backup = last ? { file: last.f, at: last.m.toISOString(), count: files.length } : { count: 0 };
  } catch { out.backup = null; }
  const errs = await sql("SELECT count(*)::int AS n, COALESCE(sum((data->>'count')::int), 0)::int AS total FROM error_logs WHERE data->>'day' >= to_char(now() - interval '7 days', 'YYYY-MM-DD')");
  out.errors7d = { distinct: errs.rows[0].n, total: errs.rows[0].total };
  return out;
}

export async function clearErrors() {
  await sql('DELETE FROM error_logs');
}

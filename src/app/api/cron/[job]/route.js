import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { fail } from '@/server/http';
import { JOBS } from '@/server/jobs';
import { multiTenant, csql, runAsTenant } from '@/server/tenant';
import { licenseOf, controlSettings } from '@/server/license';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// jobs that only make sense when the module is in the sanstha's plan
const JOB_FEATURE = { 'special-days': 'messaging', 'pledge-reminders': 'pledges' };

/**
 * Called by cron on the server: curl -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3000/api/cron/daily-digest
 * Multi-sanstha: runs the job for every active sanstha (?tenant=<slug> for one).
 */
export async function POST(req, { params }) {
  try {
    const secret = process.env.CRON_SECRET || '';
    const got = req.headers.get('x-cron-secret') || '';
    if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { job } = await params;
    const fn = JOBS[job];
    if (!fn) return NextResponse.json({ error: 'Unknown job' }, { status: 404 });
    if (!multiTenant()) return NextResponse.json({ ok: true, result: await fn() });

    const only = new URL(req.url).searchParams.get('tenant');
    const { rows } = await csql('SELECT * FROM tenants WHERE deleted_at IS NULL AND ($1::text IS NULL OR slug = $1) ORDER BY slug', [only]);
    const settings = await controlSettings();
    const results = {};
    for (const t of rows) {
      const lic = await licenseOf(t, settings);
      if (lic.locked || lic.readOnly) { results[t.slug] = 'skipped (plan expired / suspended)'; continue; }
      if (JOB_FEATURE[job] && !lic.features.includes(JOB_FEATURE[job])) { results[t.slug] = 'skipped (not in plan)'; continue; }
      try {
        results[t.slug] = await runAsTenant(t, () => fn());
      } catch (e) {
        console.error(`cron ${job} failed for ${t.slug}:`, e.message); // eslint-disable-line no-console
        results[t.slug] = `error: ${e.message}`;
      }
    }
    return NextResponse.json({ ok: true, result: results });
  } catch (e) {
    return fail(e);
  }
}

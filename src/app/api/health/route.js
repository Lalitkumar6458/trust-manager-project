import { NextResponse } from 'next/server';
import { sql } from '@/server/pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Uptime check: app + database */
export async function GET() {
  try {
    await sql('SELECT 1');
    return NextResponse.json({ ok: true, db: 'up', time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503 });
  }
}

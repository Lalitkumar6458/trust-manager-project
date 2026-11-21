import { NextResponse } from 'next/server';
import { fail } from '@/server/http';
import { portalLogout } from '@/server/portal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try { await portalLogout(); return NextResponse.json({ ok: true }); } catch (e) { return fail(e); }
}

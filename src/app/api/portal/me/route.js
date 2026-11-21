import { NextResponse } from 'next/server';
import { fail } from '@/server/http';
import { portalData } from '@/server/portal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try { return NextResponse.json(await portalData()); } catch (e) { return fail(e); }
}

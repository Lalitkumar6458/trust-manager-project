import { NextResponse } from 'next/server';
import { fail } from '@/server/http';
import { publicConfig } from '@/server/online';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try { return NextResponse.json(await publicConfig()); } catch (e) { return fail(e); }
}

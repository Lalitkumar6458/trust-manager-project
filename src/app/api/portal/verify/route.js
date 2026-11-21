import { NextResponse } from 'next/server';
import { fail, assertSameOrigin } from '@/server/http';
import { clientInfo } from '@/server/auth';
import { verifyOtp } from '@/server/portal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try { assertSameOrigin(req); const { id, code } = await req.json(); return NextResponse.json(await verifyOtp(id, code, await clientInfo())); } catch (e) { return fail(e); }
}

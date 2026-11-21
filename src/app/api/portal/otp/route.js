import { NextResponse } from 'next/server';
import { fail, assertSameOrigin } from '@/server/http';
import { requestOtp } from '@/server/portal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try { assertSameOrigin(req); const { id } = await req.json(); return NextResponse.json(await requestOtp(id)); } catch (e) { return fail(e); }
}

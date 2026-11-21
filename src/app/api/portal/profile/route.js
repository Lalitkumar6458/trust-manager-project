import { NextResponse } from 'next/server';
import { fail, assertSameOrigin } from '@/server/http';
import { updateProfile } from '@/server/portal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try { assertSameOrigin(req); const { donorId, ...rest } = await req.json(); return NextResponse.json(await updateProfile(String(donorId || ''), rest)); } catch (e) { return fail(e); }
}

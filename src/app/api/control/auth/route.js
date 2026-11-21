import { NextResponse } from 'next/server';
import { fail, assertSameOrigin } from '@/server/http';
import { ownerLogin, ownerLogout, currentOwner } from '@/server/control/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** owner of the software: GET = who is signed in, POST = sign in, DELETE = sign out (control host only) */
export async function GET() {
  try { return NextResponse.json({ owner: await currentOwner() }); } catch (e) { return fail(e); }
}
export async function POST(req) {
  try {
    assertSameOrigin(req);
    const { email, password } = await req.json();
    return NextResponse.json({ owner: await ownerLogin(email, password) });
  } catch (e) { return fail(e); }
}
export async function DELETE(req) {
  try { assertSameOrigin(req); await ownerLogout(); return NextResponse.json({ ok: true }); } catch (e) { return fail(e); }
}

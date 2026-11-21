import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { fail } from '@/server/http';
import { sql } from '@/server/pg';
import { isControlRequest } from '@/server/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** { user } of the current session (null when signed out) */
export async function GET() {
  try {
    if (await isControlRequest()) return NextResponse.json({ user: null, control: true });
    const user = await currentUser();
    if (!user) return NextResponse.json({ user: null });
    const r = await sql('SELECT must_change, totp_enabled FROM user_credentials WHERE user_id = $1', [user.uid]);
    return NextResponse.json({ user: { ...user, mustChangePassword: !!r.rows[0]?.must_change, twoFactor: !!r.rows[0]?.totp_enabled } });
  } catch (e) {
    return fail(e);
  }
}

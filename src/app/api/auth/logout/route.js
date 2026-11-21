import { NextResponse } from 'next/server';
import { logout } from '@/server/auth';
import { fail } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await logout();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

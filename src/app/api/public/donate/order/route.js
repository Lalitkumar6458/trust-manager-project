import { NextResponse } from 'next/server';
import { fail, assertSameOrigin } from '@/server/http';
import { clientInfo } from '@/server/auth';
import { createOrder } from '@/server/online';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    assertSameOrigin(req);
    const info = await clientInfo();
    return NextResponse.json(await createOrder(await req.json(), info.ip));
  } catch (e) { return fail(e); }
}

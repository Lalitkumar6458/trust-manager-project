import { NextResponse } from 'next/server';
import { fail, assertSameOrigin } from '@/server/http';
import { isBootstrapped, bootstrapTrust } from '@/server/services/setup';
import { startSession, clientInfo } from '@/server/auth';
import { withRequest } from '@/server/context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Is first-time setup done? */
export async function GET() {
  try {
    return NextResponse.json({ done: await isBootstrapped() });
  } catch (e) {
    return fail(e);
  }
}

/** First-time setup – works only once (while no Super Admin exists) */
export async function POST(req) {
  try {
    assertSameOrigin(req);
    const body = await req.json();
    const uid = await withRequest(await clientInfo(), () => bootstrapTrust(body));
    await startSession(uid);
    return NextResponse.json({ uid });
  } catch (e) {
    return fail(e);
  }
}

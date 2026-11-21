import { NextResponse } from 'next/server';
import { complete2fa, clientInfo } from '@/server/auth';
import { fail, assertSameOrigin } from '@/server/http';
import { withRequest } from '@/server/context';
import { writeBatch, writeAudit } from '@/server/services/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** second login step: authenticator / recovery code */
export async function POST(req) {
  try {
    assertSameOrigin(req);
    const { code } = await req.json();
    const user = await complete2fa(code);
    await withRequest(await clientInfo(), async () => {
      const b = writeBatch();
      writeAudit(b, user, { collection: 'users', docId: user.uid, ref: user.email, action: 'login', summary: '2-step login' });
      await b.commit().catch(() => {});
    });
    return NextResponse.json({ user });
  } catch (e) {
    return fail(e);
  }
}

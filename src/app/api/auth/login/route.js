import { NextResponse } from 'next/server';
import { login, clientInfo } from '@/server/auth';
import { fail, assertSameOrigin } from '@/server/http';
import { withRequest } from '@/server/context';
import { writeBatch, writeAudit } from '@/server/services/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    assertSameOrigin(req);
    const { email, password } = await req.json();
    const user = await login(email, password);
    if (user.needs2fa) return NextResponse.json({ needs2fa: true });
    await withRequest(await clientInfo(), async () => {
      const b = writeBatch();
      writeAudit(b, user, { collection: 'users', docId: user.uid, ref: user.email, action: 'login' });
      await b.commit().catch(() => {});
    });
    return NextResponse.json({ user });
  } catch (e) {
    return fail(e);
  }
}

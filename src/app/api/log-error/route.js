import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { logError } from '@/server/monitor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hits = new Map();

/** Browser crashes (window.onerror / React error boundary) – staff pages only, rate limited */
export async function POST(req) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });
    const now = Date.now();
    const list = (hits.get(user.uid) || []).filter((t) => now - t < 60_000);
    if (list.length >= 20) return NextResponse.json({ ok: false }, { status: 429 });
    list.push(now);
    hits.set(user.uid, list);
    const b = await req.json().catch(() => ({}));
    await logError({ kind: 'browser', message: b.message, stack: b.stack, path: b.path, user, userAgent: req.headers.get('user-agent') || '' });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}

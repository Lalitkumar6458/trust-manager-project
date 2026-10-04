import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Same-origin proxy for the trust's own Storage images (logo, deity images, signature, stamp),
 * so receipts / vouchers / report PDFs can embed them even when the Storage bucket has no CORS
 * configuration. Only URLs of THIS project's bucket are allowed (not an open proxy).
 */
const MAX_BYTES = 3 * 1024 * 1024;
const bucket = (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '').trim();

function allowed(u) {
  if (u.protocol !== 'https:') return false;
  const host = u.hostname;
  const okHost = host === 'firebasestorage.googleapis.com' || host === 'storage.googleapis.com' || host.endsWith('.firebasestorage.app');
  if (!okHost) return false;
  // must point at our bucket (path contains /b/<bucket>/ or starts with /<bucket>/)
  if (!bucket) return true;
  return u.pathname.includes(`/b/${bucket}/`) || u.pathname.startsWith(`/${bucket}/`) || host === bucket;
}

export async function GET(req) {
  const raw = new URL(req.url).searchParams.get('url');
  let target;
  try { target = new URL(raw); } catch { return NextResponse.json({ error: 'Bad url' }, { status: 400 }); }
  if (!allowed(target)) return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
  try {
    const res = await fetch(target, { cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ error: `Storage returned ${res.status}` }, { status: 502 });
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return NextResponse.json({ error: 'Not an image' }, { status: 415 });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return NextResponse.json({ error: 'Image too large' }, { status: 413 });
    return new NextResponse(buf, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' } });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 502 });
  }
}

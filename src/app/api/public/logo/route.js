import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { COL } from '@/lib/constants';
import { fetchOne } from '@/server/services/db';
import { resolveStored, MIME_BY_EXT } from '@/server/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Trust logo only (signature / stamp stay private) – for the public donate / portal pages */
export async function GET() {
  try {
    const s = (await fetchOne(COL.settings, 'trust')) || {};
    const m = /^\/api\/files\/(.+)$/.exec(String(s.logoUrl || s.leftImageUrl || '').split('?')[0]);
    if (!m) throw new Error('none');
    const file = await resolveStored(decodeURIComponent(m[1]));
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new Error('type');
    return new NextResponse(await fs.readFile(file), { headers: { 'Content-Type': MIME_BY_EXT[ext], 'Cache-Control': 'public, max-age=3600' } });
  } catch {
    return new NextResponse(null, { status: 307, headers: { Location: '/icons/icon-192.png' } });
  }
}

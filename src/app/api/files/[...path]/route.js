import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { withUser } from '@/server/http';
import { canReadFile } from '@/server/access';
import { resolveStored, MIME_BY_EXT } from '@/server/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Serves an uploaded file to signed-in staff */
export const GET = withUser(async (req, user, { params }) => {
  const parts = (await params).path || [];
  const rel = parts.map((p) => decodeURIComponent(p)).join('/');
  if (!canReadFile(user, rel)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  let abs;
  try { abs = await resolveStored(rel); } catch { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
  if (!fs.existsSync(abs)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const ext = path.extname(abs).slice(1).toLowerCase();
  const type = MIME_BY_EXT[ext] || 'application/octet-stream';
  const inline = type.startsWith('image/') || type === 'application/pdf';
  const stat = fs.statSync(abs);
  return new NextResponse(Readable.toWeb(fs.createReadStream(abs)), {
    headers: {
      'Content-Type': type,
      'Content-Length': String(stat.size),
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(abs).replace(/^[0-9a-f]{12}_/, ''))}`,
      ...(type === 'image/svg+xml' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}),
    },
  });
});

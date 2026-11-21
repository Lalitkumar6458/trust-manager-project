import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { tlsAllowed } from '@/server/control/service';
import { multiTenant, normHost } from '@/server/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Caddy on-demand TLS "ask" endpoint (called by Caddy on the same server):
 *   200 = this address belongs to a sanstha → issue an HTTPS certificate, 404 = refuse.
 */
export async function GET(req) {
  const host = normHost((await headers()).get('host'));
  if (!multiTenant() || !['127.0.0.1', 'localhost'].includes(host)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const domain = new URL(req.url).searchParams.get('domain') || '';
  try {
    return (await tlsAllowed(domain)) ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false }, { status: 404 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

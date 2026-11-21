import { NextResponse } from 'next/server';
import { withUser, assertSameOrigin } from '@/server/http';
import { RPC } from '@/server/rpc';
import { enforceRpc } from '@/server/license';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { name, args: [] } → runs one server action (permission checked inside) */
export const POST = withUser(async (req, user) => {
  assertSameOrigin(req);
  const text = await req.text();
  if (text.length > 5_000_000) return NextResponse.json({ error: 'Request too large' }, { status: 413 });
  const { name, args } = JSON.parse(text || '{}');
  const fn = Object.prototype.hasOwnProperty.call(RPC, name) ? RPC[name] : null;
  if (!fn) return NextResponse.json({ error: `Unknown action ${name}` }, { status: 400 });
  enforceRpc(name, user.license); // plan features + expired plan (read-only)
  const result = await fn(Array.isArray(args) ? args : [], user);
  return NextResponse.json({ result: result === undefined ? null : result });
});

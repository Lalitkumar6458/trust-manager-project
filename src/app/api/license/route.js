import { NextResponse } from 'next/server';
import { withUser, assertSameOrigin } from '@/server/http';
import { billingInfo, createRenewOrder, verifyRenew } from '@/server/control/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Plan & billing of this sanstha (Super Admin) */
export const GET = withUser(async (req, user) => {
  if (user.role !== 'superAdmin') return NextResponse.json({ error: 'Only the Super Admin can see the plan' }, { status: 403 });
  return NextResponse.json(await billingInfo());
});

/** { action: 'order', planId, months } | { action: 'verify', orderId, paymentId, signature } */
export const POST = withUser(async (req, user) => {
  assertSameOrigin(req);
  if (user.role !== 'superAdmin') return NextResponse.json({ error: 'Only the Super Admin can renew the plan' }, { status: 403 });
  const b = await req.json();
  if (b.action === 'order') return NextResponse.json(await createRenewOrder(b, user));
  if (b.action === 'verify') return NextResponse.json(await verifyRenew(b));
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
});

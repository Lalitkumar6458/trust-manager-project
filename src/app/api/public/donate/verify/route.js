import { NextResponse } from 'next/server';
import { fail, assertSameOrigin } from '@/server/http';
import { verifyCheckout } from '@/server/online';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    assertSameOrigin(req);
    const b = await req.json();
    return NextResponse.json(await verifyCheckout({ orderId: b.razorpay_order_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature }));
  } catch (e) { return fail(e); }
}

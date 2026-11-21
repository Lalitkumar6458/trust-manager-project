import { NextResponse } from 'next/server';
import { fail } from '@/server/http';
import { webhook } from '@/server/online';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Razorpay Dashboard → Webhooks → URL https://<site>/api/public/razorpay/webhook, events payment.captured, order.paid, payment.failed */
export async function POST(req) {
  try {
    const raw = await req.text();
    return NextResponse.json({ ok: true, result: await webhook(raw, req.headers.get('x-razorpay-signature') || '') });
  } catch (e) { return fail(e); }
}

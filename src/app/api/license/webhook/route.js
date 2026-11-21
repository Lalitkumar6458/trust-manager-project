import { NextResponse } from 'next/server';
import { fail } from '@/server/http';
import { renewWebhook } from '@/server/control/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Razorpay webhook for subscription renewals (owner's Razorpay account) */
export async function POST(req) {
  try {
    const raw = await req.text();
    return NextResponse.json(await renewWebhook(raw, req.headers.get('x-razorpay-signature') || ''));
  } catch (e) { return fail(e); }
}

import { NextResponse } from 'next/server';
import { COL } from '@/lib/constants';
import { fail } from '@/server/http';
import { fetchAll, fetchOne } from '@/server/services/db';
import { portalDonation } from '@/server/portal';
import { receiptPdfBuffer } from '@/server/pdfServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  try {
    const { id } = await params;
    const d = await portalDonation(id);
    const [s, cats] = await Promise.all([fetchOne(COL.settings, 'trust'), fetchAll(COL.donationCategories)]);
    const buf = await receiptPdfBuffer(d, s || {}, cats);
    return new NextResponse(buf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Receipt-${String(d.receiptNo).replace(/[^\w.-]+/g, '-')}.pdf"`, 'Cache-Control': 'private, no-store' } });
  } catch (e) { return fail(e); }
}

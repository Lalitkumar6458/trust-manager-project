import { NextResponse } from 'next/server';
import { COL } from '@/lib/constants';
import { fetchAll, fetchOne } from '@/server/services/db';
import { receiptPdfBuffer } from '@/server/pdfServer';
import { verifyReceipt } from '@/server/services/receiptVerify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Receipt PDF for the person holding the signed link (QR / online donation thank-you page) */
export async function GET(_req, { params }) {
  const { token } = await params;
  const ok = await verifyReceipt(token).catch(() => null);
  if (!ok || ok.status !== 'approved') return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
  const id = String(token).split('.')[0];
  const [d, s, cats] = await Promise.all([fetchOne(COL.donations, id), fetchOne(COL.settings, 'trust'), fetchAll(COL.donationCategories)]);
  const buf = await receiptPdfBuffer(d, s || {}, cats);
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Receipt-${String(d.receiptNo || 'receipt').replace(/[^\w.-]+/g, '-')}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

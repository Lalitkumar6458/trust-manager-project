import { NextResponse } from 'next/server';
import { COL } from '@/lib/constants';
import { fail } from '@/server/http';
import { fetchAll, fetchOne, where } from '@/server/services/db';
import { requireDonor } from '@/server/portal';
import { statementPdfBuffer } from '@/server/pdfServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** /api/portal/statement/2026-27?donor=<id> */
export async function GET(req, { params }) {
  try {
    const { fy } = await params;
    if (!/^\d{4}-\d{2}$/.test(fy)) throw Object.assign(new Error('Bad year'), { status: 400 });
    const s = await requireDonor();
    const donorId = new URL(req.url).searchParams.get('donor') || s.donorIds[0];
    if (!s.donorIds.includes(donorId)) throw Object.assign(new Error('Not allowed'), { status: 403 });
    const [donor, settings, donations] = await Promise.all([
      fetchOne(COL.donors, donorId), fetchOne(COL.settings, 'trust'),
      fetchAll(COL.donations, where('donorId', '==', donorId), where('financialYearId', '==', fy), where('status', '==', 'approved')),
    ]);
    const buf = await statementPdfBuffer({ donor, donations, settings: settings || {}, fyId: fy });
    return new NextResponse(buf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Donation-statement-${fy}.pdf"`, 'Cache-Control': 'private, no-store' } });
  } catch (e) { return fail(e); }
}

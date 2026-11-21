import 'server-only';
import { COL, isCashMode } from '@/lib/constants';
import { round2 } from '@/lib/format';
import { fetchAll, fetchOne, where } from './db';
import { sql } from '../pg';

// ------------------------------------------------------------------
// Form 10BD (statement of donations u/s 80G, filed every year by 31 May)
// and the data for Form 10BE (certificate to each donor).
// One row per donor + ID + donation type + mode, as the Income-tax portal expects.
// ------------------------------------------------------------------

/** Income-tax "ID Code" list */
export const ID_CODES = { PAN: 1, Aadhaar: 2, 'Tax ID (foreign)': 3, Passport: 4, 'Voter ID': 5, 'Driving Licence': 6, 'Ration card': 7 };
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MODE_CASH = 'Cash';
const MODE_ELECTRONIC = 'Electronic modes including account payee cheque/draft';
const MODE_OTHERS = 'Others';

function donorId(donor) {
  const pan = String(donor.pan || '').toUpperCase().replace(/\s/g, '');
  if (PAN_RE.test(pan)) return { idCode: ID_CODES.PAN, idName: 'PAN', uin: pan };
  const type = donor.idType;
  const num = String(donor.idNumber || '').replace(/\s/g, '').toUpperCase();
  if (!type || !num || !ID_CODES[type]) return null;
  if (type === 'Aadhaar' && !/^\d{12}$/.test(num)) return null;
  return { idCode: ID_CODES[type], idName: type, uin: num };
}

function modeOf(paymentMode) {
  if (isCashMode(paymentMode)) return MODE_CASH;
  if (paymentMode === 'Other') return MODE_OTHERS;
  return MODE_ELECTRONIC;
}

/**
 * @returns {{ rows, skipped, totals, trust }}
 *  rows:    aggregated 10BD rows (one per donor/ID/type/mode)
 *  skipped: donations that cannot go in 10BD (no PAN/ID, cash above ₹2,000 …) – shown to the user
 */
export async function form10bd(fyId) {
  if (!/^\d{4}-\d{2}$/.test(String(fyId || ''))) throw Object.assign(new Error('Select a financial year'), { status: 400 });
  const [donations, settings] = await Promise.all([
    fetchAll(COL.donations, where('financialYearId', '==', fyId), where('status', '==', 'approved')),
    fetchOne(COL.settings, 'trust'),
  ]);
  const donorIds = [...new Set(donations.map((d) => d.donorId).filter(Boolean))];
  const donors = new Map();
  if (donorIds.length) {
    const { rows } = await sql(`SELECT id, data FROM ${COL.donors} WHERE id = ANY($1::text[])`, [donorIds]);
    rows.forEach((r) => donors.set(r.id, { id: r.id, ...r.data }));
  }

  const groups = new Map();
  const skipped = [];
  let reported = 0;
  donations.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.receiptNo).localeCompare(String(b.receiptNo)));
  for (const d of donations) {
    const master = donors.get(d.donorId) || {};
    const donor = { ...(d.donor || {}), ...master, pan: master.pan || d.donor?.pan || '' };
    const base = { donationId: d.id, receiptNo: d.receiptNo, date: d.date, donor: donor.organizationName || donor.name, amount: d.amount };
    if (isCashMode(d.paymentMode) && Number(d.amount) > 2000) { skipped.push({ ...base, reason: 'cash' }); continue; }
    const id = donorId(donor);
    if (!id) { skipped.push({ ...base, reason: 'noId', donorRef: d.donorId }); continue; }
    const mode = modeOf(d.paymentMode);
    // split corpus / non-corpus lines
    const parts = { Corpus: 0, Others: 0 };
    (d.lines || []).forEach((l) => { parts[l.isCorpus ? 'Corpus' : 'Others'] += Number(l.amount) || 0; });
    if (!d.lines?.length) parts[d.isCorpus ? 'Corpus' : 'Others'] = Number(d.amount) || 0;
    Object.entries(parts).forEach(([type, amt]) => {
      if (!(amt > 0)) return;
      const key = [d.donorId || donor.name, id.idCode, id.uin, type, mode].join('|');
      const g = groups.get(key) || {
        donorRef: d.donorId || null,
        idCode: id.idCode, idName: id.idName, uin: id.uin,
        name: donor.organizationName || donor.name || '', address: donor.address || '',
        donationType: type, mode, amount: 0, receipts: [],
      };
      g.amount = round2(g.amount + amt);
      if (!g.receipts.includes(d.receiptNo)) g.receipts.push(d.receiptNo);
      groups.set(key, g);
      reported = round2(reported + amt);
    });
  }
  const rows = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).map((r, i) => ({ sr: i + 1, ...r }));
  return {
    fyId,
    rows,
    skipped,
    totals: {
      donations: donations.length,
      all: round2(donations.reduce((s, d) => s + (Number(d.amount) || 0), 0)),
      reported,
      skipped: round2(skipped.reduce((s, d) => s + (Number(d.amount) || 0), 0)),
    },
    trust: {
      section80G: settings?.section80G || '', section80GDate: settings?.section80GDate || '',
      filing: settings?.form10bd?.[fyId] || {},
    },
  };
}

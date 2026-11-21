import 'server-only';

import { COL, DONOR_TYPES } from '@/lib/constants';
import { buildKeywords } from '@/lib/keywords';
import {
  fetchAll, db, runTransaction, colRef, doc, readCounter, createdStamp, writeAudit, writeBatch,
} from './db';

// ------------------------------------------------------------------
// Donor import (CSV / Excel)
// ------------------------------------------------------------------
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const norm = (s) => String(s ?? '').trim();
const head = (h) => String(h).toLowerCase().replace(/[^a-z]/g, '');
const FIELD_FOR = {
  name: ['name', 'donorname', 'fullname', 'naam'],
  organizationName: ['organization', 'organisation', 'organizationname', 'company', 'firm'],
  donorType: ['type', 'donortype'],
  mobile: ['mobile', 'phone', 'mobileno', 'contact', 'phoneno'],
  email: ['email', 'emailid', 'mail'],
  address: ['address', 'pata', 'city'],
  pan: ['pan', 'panno', 'pannumber'],
  notes: ['notes', 'remarks', 'note'],
};

/** Parse rows (first row = header) into validated donor records */
export function parseDonorRows(rows) {
  if (!rows.length) return { donors: [], errors: ['File is empty'] };
  const header = rows[0].map(head);
  const col = {};
  Object.entries(FIELD_FOR).forEach(([f, keys]) => { col[f] = header.findIndex((h) => keys.includes(h)); });
  if (col.name < 0) return { donors: [], errors: ['A “Name” column is required'] };
  const donors = [];
  const errors = [];
  rows.slice(1).forEach((r, i) => {
    const get = (f) => (col[f] >= 0 ? norm(r[col[f]]) : '');
    const name = get('name');
    if (!name) return; // blank line
    const pan = get('pan').toUpperCase();
    const mobile = get('mobile').replace(/\D/g, '').slice(-10);
    const typeRaw = get('donorType');
    const donorType = DONOR_TYPES.find((t) => t.toLowerCase() === typeRaw.toLowerCase()) || 'Individual';
    const rowErr = [];
    if (pan && !PAN_RE.test(pan)) rowErr.push(`invalid PAN “${pan}”`);
    if (get('mobile') && mobile.length !== 10) rowErr.push('mobile must have 10 digits');
    if (rowErr.length) { errors.push(`Row ${i + 2} (${name}): ${rowErr.join(', ')}`); return; }
    donors.push({ name, organizationName: get('organizationName'), donorType, mobile, email: get('email'), address: get('address'), pan, notes: get('notes') });
  });
  return { donors, errors };
}

/**
 * Creates donors in chunks (Super Admin only). Donor codes are reserved in one transaction per chunk
 * (counter "donor"), so numbering stays gap-free and unique.
 * Existing donors with the same mobile or PAN are skipped.
 */
export async function importDonors(donors, user) {
  const existing = await fetchAll(COL.donors);
  const seenMobile = new Set(existing.map((d) => d.mobile).filter(Boolean));
  const seenPan = new Set(existing.map((d) => d.pan).filter(Boolean));
  const fresh = [];
  let skipped = 0;
  donors.forEach((d) => {
    if ((d.mobile && seenMobile.has(d.mobile)) || (d.pan && seenPan.has(d.pan))) { skipped += 1; return; }
    if (d.mobile) seenMobile.add(d.mobile);
    if (d.pan) seenPan.add(d.pan);
    fresh.push(d);
  });
  const CHUNK = 100;
  let created = 0;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const part = fresh.slice(i, i + CHUNK);
    // eslint-disable-next-line no-await-in-loop
    await runTransaction(db, async (tx) => {
      const counter = await readCounter(tx, 'donor');
      let next = counter.next;
      part.forEach((d) => {
        const code = `D-${String(next).padStart(5, '0')}`;
        next += 1;
        tx.set(doc(colRef(COL.donors)), {
          ...d,
          donorCode: code,
          code,
          idType: '',
          idNumber: '',
          nameLower: d.name.toLowerCase(),
          totalAmount: 0,
          donationCount: 0,
          fyTotals: {},
          firstDonationDate: null,
          lastDonationDate: null,
          status: 'active',
          searchKeywords: buildKeywords({ names: [d.name, d.organizationName], exact: [d.mobile, d.pan, code, d.email] }),
          ...createdStamp(user),
        });
      });
      // bulk reservation of donor codes (Super Admin only)
      tx.set(counter.ref, { next }, { merge: true });
      writeAudit(tx, user, { collection: COL.donors, docId: 'import', ref: `Import ${part.length}`, action: 'import', summary: `${part.length} donors imported (${part[0].name} …)` });
    });
    created += part.length;
  }
  return { created, skipped };
}


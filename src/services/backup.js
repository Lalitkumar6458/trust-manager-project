'use client';

import { COL, DONOR_TYPES } from '@/lib/constants';
import { openBlob } from '@/pdf/generate';
import { buildKeywords } from '@/lib/keywords';
import { todayStr } from '@/lib/format';
import {
  fetchAll, db, runTransaction, colRef, doc, readCounter, createdStamp, writeAudit, writeBatch,
} from './db';

/** Firestore value → plain cell (timestamps as ISO date-time, objects as JSON) */
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v?.toDate === 'function') return v.toDate().toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/**
 * Full backup of every collection into one Excel workbook (one sheet per collection).
 * Super Admin only. Keep the file safe – it contains donor PAN / mobile numbers.
 */
export async function exportAllData(user, onProgress) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Trust Manager backup';
  const names = Object.values(COL);
  const summary = [];
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    onProgress?.(Math.round((i / names.length) * 100), name);
    let rows = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      rows = await fetchAll(name);
    } catch {
      rows = null; // no permission / not used
    }
    summary.push([name, rows ? rows.length : 'not readable']);
    if (!rows || !rows.length) continue;
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => k !== 'searchKeywords');
    const ws = wb.addWorksheet(name.slice(0, 30));
    ws.addRow(keys).font = { bold: true };
    rows.forEach((r) => ws.addRow(keys.map((k) => cell(r[k]))));
    keys.forEach((k, idx) => { ws.getColumn(idx + 1).width = Math.min(40, Math.max(10, k.length + 4)); });
  }
  const info = wb.addWorksheet('_backup_info');
  info.addRow(['Backup taken', new Date().toISOString()]);
  info.addRow(['By', user?.name || user?.email || '']);
  info.addRow([]);
  info.addRow(['Collection', 'Documents']).font = { bold: true };
  summary.forEach((s) => info.addRow(s));
  const buf = await wb.xlsx.writeBuffer();
  openBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `trust-backup-${todayStr()}.xlsx`, true);
  try {
    const b = writeBatch(db);
    writeAudit(b, user, { collection: 'backup', docId: todayStr(), ref: 'Full backup', action: 'export', summary: `Full data backup (${summary.length} collections)` });
    await b.commit();
  } catch { /* audit is best-effort */ }
  onProgress?.(100, '');
  return summary;
}

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
export async function importDonors(donors, user, onProgress) {
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
      // bulk reservation of donor codes – allowed for the Super Admin only (security rules)
      tx.set(counter.ref, { next }, { merge: true });
      writeAudit(tx, user, { collection: COL.donors, docId: 'import', ref: `Import ${part.length}`, action: 'import', summary: `${part.length} donors imported (${part[0].name} …)` });
    });
    created += part.length;
    onProgress?.(Math.round((created / fresh.length) * 100));
  }
  return { created, skipped };
}


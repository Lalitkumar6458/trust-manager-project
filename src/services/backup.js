'use client';

import { COL, DONOR_TYPES } from '@/lib/constants';
import { openBlob } from '@/pdf/generate';
import { todayStr } from '@/lib/format';
import { fetchAll, rpc } from '@/lib/api';

/** Stored value → plain cell (timestamps as ISO date-time, objects as JSON) */
function cell(v) {
  if (v === null || v === undefined) return '';
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

/** Creates donors on the server (Super Admin only); existing mobile / PAN are skipped */
export async function importDonors(donors, _user, onProgress) {
  const CHUNK = 500;
  let created = 0;
  let skipped = 0;
  for (let i = 0; i < donors.length; i += CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    const r = await rpc('donors.import', donors.slice(i, i + CHUNK));
    created += r.created;
    skipped += r.skipped;
    onProgress?.(Math.round(((i + CHUNK > donors.length ? donors.length : i + CHUNK) / donors.length) * 100));
  }
  return { created, skipped };
}

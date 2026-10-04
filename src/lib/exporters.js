'use client';

import Papa from 'papaparse';
import { openBlob } from '@/pdf/generate';

/**
 * Export column definition:
 *  { title, key, value?: (row) => any, money?: boolean, align?, width? }
 */
const cellValue = (c, r) => (c.value ? c.value(r) : r[c.key]);
const fmtMoney = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fileSafe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '-');

export async function exportExcel({ title, subtitle, sections, settings, sheetName = 'Report' }) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = settings?.nameEn || 'Trust Manager';
  const ws = wb.addWorksheet(sheetName.slice(0, 30));
  const n = Math.max(...sections.map((x) => x.columns.length));
  const head = [settings?.name, title, subtitle].filter(Boolean);
  head.forEach((t, i) => {
    const row = ws.addRow([t]);
    ws.mergeCells(row.number, 1, row.number, n);
    row.font = { bold: true, size: i === 0 ? 14 : 12 };
    row.alignment = { horizontal: 'center' };
  });
  const widths = Array(n).fill(10);
  sections.forEach(({ title: secTitle, columns, rows, totals }) => {
    ws.addRow([]);
    if (secTitle) ws.addRow([secTitle]).font = { bold: true, color: { argb: 'FF7D1A12' } };
    const hr = ws.addRow(columns.map((c) => c.title));
    hr.font = { bold: true };
    hr.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2E6D0' } };
      cell.border = { bottom: { style: 'thin' } };
    });
    rows.forEach((r) => {
      const row = ws.addRow(columns.map((c) => {
        const v = cellValue(c, r);
        return c.money ? (v === '' || v === null || v === undefined ? null : Number(v)) : (v ?? '');
      }));
      columns.forEach((c, i) => { if (c.money) row.getCell(i + 1).numFmt = '#,##,##0.00'; });
    });
    if (totals) {
      const tr = ws.addRow(columns.map((c) => (totals[c.key] ?? '')));
      tr.font = { bold: true };
      columns.forEach((c, i) => { if (c.money) tr.getCell(i + 1).numFmt = '#,##,##0.00'; });
    }
    columns.forEach((c, i) => { widths[i] = Math.max(widths[i], c.money ? 16 : Math.min(45, (c.width || 1) * 14)); });
  });
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const buf = await wb.xlsx.writeBuffer();
  openBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileSafe(title)}.xlsx`, true);
}

export function exportCsv({ title, sections }) {
  const out = [];
  sections.forEach(({ title: secTitle, columns, rows, totals }, i) => {
    if (i > 0) out.push([]);
    if (secTitle) out.push([secTitle]);
    out.push(columns.map((c) => c.title));
    rows.forEach((r) => out.push(columns.map((c) => cellValue(c, r) ?? '')));
    if (totals) out.push(columns.map((c) => totals[c.key] ?? ''));
  });
  const csv = Papa.unparse(out);
  // BOM so Excel opens Hindi text correctly
  openBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `${fileSafe(title)}.csv`, true);
}

/** Converts rows into printable strings for the PDF report */
export function toPdfSection({ title, columns, rows, totals }) {
  const fmt = (c, v) => (c.money ? (v === '' || v === null || v === undefined ? '' : fmtMoney(v)) : String(v ?? ''));
  return {
    title,
    columns: columns.map((c) => ({ title: c.title, key: c.key, width: c.width || (c.money ? 1.2 : 1), align: c.money ? 'right' : c.align })),
    rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, fmt(c, cellValue(c, r))]))),
    totals: totals ? Object.fromEntries(columns.map((c) => [c.key, typeof totals[c.key] === 'number' && c.money ? fmtMoney(totals[c.key]) : totals[c.key] ?? ''])) : null,
  };
}

/** Print an HTML table in a new window (browser print dialog → printer / Save as PDF) */
export function printTable({ title, subtitle, settings, sections }) {
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
   @font-face{font-family:Hind;src:url('${window.location.origin}/fonts/Hind-Regular.ttf')}
   @font-face{font-family:Hind;font-weight:700;src:url('${window.location.origin}/fonts/Hind-Bold.ttf')}
   body{font-family:Hind,sans-serif;font-size:11px;margin:18px;color:#222}
   h1{font-size:18px;text-align:center;margin:0;color:#7d1a12} h2{font-size:14px;text-align:center;margin:4px 0}
   .sub{text-align:center;color:#666;margin-bottom:8px} h3{font-size:12px;margin:12px 0 4px;color:#7d1a12}
   table{border-collapse:collapse;width:100%;font-size:${sections.some((x) => x.columns.length > 9) ? 9 : 10.5}px}
   th,td{border:1px solid #d8c8ae;padding:3px 5px;vertical-align:top;overflow-wrap:anywhere;word-break:normal}
   th{background:#7d1a12;color:#fff;font-weight:700} td.r,th.r{text-align:right;white-space:nowrap}
   tbody tr:nth-child(even) td{background:#fbf7ef} tr.t td{font-weight:700;background:#f2e6d0;border-top:2px solid #7d1a12}
   thead{display:table-header-group} tr{page-break-inside:avoid}
   @page{size:A4 ${sections.some((x) => x.columns.length > 6) ? 'landscape' : 'portrait'};margin:10mm}
  </style></head><body>
  <h1>${esc(settings?.name)}</h1><div class="sub">${esc(settings?.address)}</div>
  <h2>${esc(title)}</h2>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
  ${sections.map((s) => `${s.title ? `<h3>${esc(s.title)}</h3>` : ''}<table><thead><tr>${s.columns.map((c) => `<th class="${c.align === 'right' ? 'r' : ''}">${esc(c.title)}</th>`).join('')}</tr></thead><tbody>
   ${s.rows.map((r) => `<tr>${s.columns.map((c) => `<td class="${c.align === 'right' ? 'r' : ''}">${esc(r[c.key])}</td>`).join('')}</tr>`).join('')}
   ${s.totals ? `<tr class="t">${s.columns.map((c) => `<td class="${c.align === 'right' ? 'r' : ''}">${esc(s.totals[c.key])}</td>`).join('')}</tr>` : ''}
  </tbody></table>`).join('')}
  <script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

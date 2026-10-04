import dayjs from 'dayjs';

// ---------------- Money ----------------
const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹1,25,000.00 */
export const money = (n) => `₹${inr.format(Number(n) || 0)}`;
/** ₹1,25,000 (no decimals – for cards/charts) */
export const money0 = (n) => `₹${inr0.format(Math.round(Number(n) || 0))}`;
export const num = (n) => inr.format(Number(n) || 0);

/** Round to 2 decimals safely (avoid floating point drift in sums) */
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const sum = (arr, fn = (x) => x) => round2(arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0));

/** Split amount into rupees and paise parts for the receipt table */
export const rupeePaise = (n) => {
  const v = round2(n);
  const rupees = Math.floor(v);
  const paise = Math.round((v - rupees) * 100);
  return { rupees: inr0.format(rupees), paise: String(paise).padStart(2, '0') };
};

// ---------------- Dates ----------------
// All business dates are stored as 'YYYY-MM-DD' strings (timezone-safe & sortable).
export const DATE_FMT = 'DD-MM-YYYY';
export const toDateStr = (d) => (d ? dayjs(d).format('YYYY-MM-DD') : null);
export const fmtDate = (s) => (s ? dayjs(s).format(DATE_FMT) : '');
export const fmtDateTime = (ts) => {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : ts;
  return dayjs(d).format('DD-MM-YYYY hh:mm A');
};
export const monthKeyOf = (dateStr) => (dateStr ? dateStr.slice(0, 7) : null);
export const monthLabel = (monthKey) => dayjs(`${monthKey}-01`).format('MMMM YYYY');
export const todayStr = () => dayjs().format('YYYY-MM-DD');

// ---------------- Financial Year (April – March) ----------------
/** '2026-04-15' → '2026-27' */
export function fyIdOf(dateStr) {
  const d = dayjs(dateStr);
  const y = d.month() >= 3 ? d.year() : d.year() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
export function fyRange(fyId) {
  const y = Number(fyId.slice(0, 4));
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}
export const fyLabel = (fyId) => (fyId ? `FY ${fyId}` : '');
export function nextFyId(fyId) {
  const y = Number(fyId.slice(0, 4)) + 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
/** List of 'YYYY-MM' month keys in a financial year */
export function fyMonths(fyId) {
  const { start } = fyRange(fyId);
  return Array.from({ length: 12 }, (_, i) => dayjs(start).add(i, 'month').format('YYYY-MM'));
}

// ---------------- Masking (sensitive data in UI) ----------------
export function maskAccount(no) {
  if (!no) return '';
  const s = String(no).replace(/\s/g, '');
  return s.length <= 4 ? s : `XXXX${s.slice(-4)}`;
}
export function maskId(no) {
  if (!no) return '';
  const s = String(no).replace(/\s/g, '');
  return s.length <= 4 ? s : `${'X'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

// ---------------- Validation ----------------
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const MOBILE_REGEX = /^[6-9]\d{9}$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const GST_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

export const padNo = (n, len = 5) => String(n).padStart(len, '0');

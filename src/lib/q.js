// ------------------------------------------------------------------
// Query constraints – plain, serialisable objects shared by the browser
// (sent to /api/query) and the server (translated to SQL in src/server/sql.js).
// The names mirror the old Firestore helpers so screens read the same:
//    where('financialYearId', '==', fy), orderBy('date', 'desc'), limit(100)
// ------------------------------------------------------------------

export const where = (field, op, value) => ({ t: 'where', f: field, op, v: value === undefined ? null : value });
export const orderBy = (field, dir = 'asc') => ({ t: 'order', f: field, d: dir === 'desc' ? 'desc' : 'asc' });
export const limit = (n) => ({ t: 'limit', n: Number(n) });
export const offset = (n) => ({ t: 'offset', n: Number(n) });
/** rows strictly before `row` in (field…, id) order – e.g. everything older than a ledger line */
export const before = (field, row) => (Array.isArray(field)
  ? { t: 'before', f: field, v: field.map((x) => row?.[x] ?? null), id: row?.id ?? '' }
  : { t: 'before', f: field, v: row?.[field] ?? null, id: row?.id ?? '' });

/** Timestamps are stored as ISO-8601 strings (they sort correctly as text) */
export const Timestamp = {
  fromDate: (d) => new Date(d).toISOString(),
  now: () => new Date().toISOString(),
};

/** Milliseconds of a stored timestamp (ISO string; also accepts old {seconds} objects) */
export function tsMillis(v) {
  if (!v) return 0;
  if (typeof v === 'string') return Date.parse(v) || 0;
  if (typeof v === 'number') return v;
  if (v.seconds !== undefined) return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  return 0;
}

/** Stored timestamp → Date (or null) */
export const tsDate = (v) => (v ? new Date(tsMillis(v)) : null);

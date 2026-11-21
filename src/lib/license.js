// ------------------------------------------------------------------
// Subscription maths (pure – unit tested).
//   active   – more than `warnDays` left
//   warning  – expiring soon (banner)
//   grace    – expired, still working for `graceDays`
//   readonly – grace over: data can be seen / downloaded, no new entries
//   locked   – suspended by the owner (sign-in refused)
// Dates are 'YYYY-MM-DD' strings (India time).
// ------------------------------------------------------------------
import { FEATURE_KEYS } from './features';

const DAY = 86_400_000;
const toUtc = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
export const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / DAY);
export const addDays = (d, n) => new Date(toUtc(d) + n * DAY).toISOString().slice(0, 10);
export const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** 2026-01-31 + 1 month → 2026-02-28 (end of month kept sensible) */
export function addMonths(d, months) {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1 + Number(months);
  const day = Number(d.slice(8, 10));
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function licenseState({ expiresOn, graceDays = 7, status = 'active', today = istToday(), warnDays = 15 }) {
  if (status === 'suspended') return { state: 'locked', locked: true, readOnly: true, daysLeft: expiresOn ? daysBetween(today, expiresOn) : null, graceEndsOn: null };
  if (!expiresOn) return { state: 'active', locked: false, readOnly: false, daysLeft: null, graceEndsOn: null }; // lifetime
  const daysLeft = daysBetween(today, expiresOn);
  const graceEndsOn = addDays(expiresOn, Number(graceDays) || 0);
  if (daysLeft >= 0) return { state: daysLeft <= warnDays ? 'warning' : 'active', locked: false, readOnly: false, daysLeft, graceEndsOn };
  if (today <= graceEndsOn) return { state: 'grace', locked: false, readOnly: false, daysLeft, graceEndsOn, graceLeft: daysBetween(today, graceEndsOn) };
  return { state: 'readonly', locked: false, readOnly: true, daysLeft, graceEndsOn };
}

/**
 * New expiry after paying for `months`.
 * Renewed before the grace ends → continues from the old expiry (no gap, no free days);
 * renewed after that (or first time) → starts today.
 */
export function extendExpiry({ expiresOn, graceDays = 7, today = istToday(), months }) {
  const base = expiresOn && addDays(expiresOn, Number(graceDays) || 0) >= today ? expiresOn : today;
  return { from: base === today && (!expiresOn || expiresOn < today) ? today : addDays(base, 1), to: addMonths(base, months) };
}

/** plan features ± per-sanstha changes */
export function effectiveFeatures(planFeatures = [], override = {}) {
  const set = new Set(planFeatures);
  (override.add || []).forEach((k) => set.add(k));
  (override.remove || []).forEach((k) => set.delete(k));
  return FEATURE_KEYS.filter((k) => set.has(k));
}

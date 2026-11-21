'use client';

import dayjs from 'dayjs';

/** Default list window: previous month + this month (clamped to the financial year) */
export function defaultRange(fy) {
  if (!fy) return { from: null, to: null };
  const today = dayjs().format('YYYY-MM-DD');
  const end = fy.endDate < today ? fy.endDate : today;
  const startCand = dayjs(end).subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
  return { from: startCand < fy.startDate ? fy.startDate : startCand, to: end < fy.startDate ? fy.endDate : end };
}

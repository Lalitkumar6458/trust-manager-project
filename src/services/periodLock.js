'use client';

import { COL } from '@/lib/constants';
import { fyIdOf, monthKeyOf, monthLabel } from '@/lib/format';
import { docRef } from './db';
import { nextFyId } from '@/lib/format';

/**
 * Per-transaction note of CLOSED years being posted into (Super Admin only), so that
 * postEntry can keep the closing balance + next year's opening balance in step.
 */
export const closedFyCarry = new WeakMap();

export class PeriodLockedError extends Error {}

/**
 * Reads month-closing + financial-year docs inside a transaction and throws
 * if the period is locked for this user.
 *  - Finalized FY  → locked for everyone (reopen FY first)
 *  - Closed FY     → only Super Admin
 *  - Closed month  → only Super Admin
 * Returns { fy } (FY doc data or null).
 */
export async function assertPeriodOpen(tx, dateStr, user) {
  const fyId = fyIdOf(dateStr);
  const monthKey = monthKeyOf(dateStr);
  const [fySnap, mSnap] = await Promise.all([
    tx.get(docRef(COL.financialYears, fyId)),
    tx.get(docRef(COL.monthlyClosings, monthKey)),
  ]);
  const fy = fySnap.exists() ? fySnap.data() : null;
  const isSuper = user?.role === 'superAdmin';
  if (!fy) {
    throw new PeriodLockedError(`Financial year ${fyId} is not created yet. Ask the Super Admin to create it in Financial Year settings.`);
  }
  if (fy.status === 'finalized') {
    throw new PeriodLockedError(`FY ${fyId} is FINALIZED. Entries cannot be added or changed. Record an adjustment entry in the current year instead.`);
  }
  if (fy.status === 'closed' && !isSuper) {
    throw new PeriodLockedError(`FY ${fyId} is closed. Only the Super Admin can make changes.`);
  }
  if (mSnap.exists() && mSnap.data().status === 'closed' && !isSuper) {
    throw new PeriodLockedError(`${monthLabel(monthKey)} is closed (monthly closing). Only the Super Admin can make changes in a closed month.`);
  }
  if (fy.status === 'closed') {
    // Super Admin correction in a closed year → carry the change into the next year (read now: reads must precede writes)
    const nextId = nextFyId(fyId);
    const nx = await tx.get(docRef(COL.financialYears, nextId));
    const map = closedFyCarry.get(tx) || {};
    map[fyId] = { nextId, nextExists: nx.exists(), nextStatus: nx.exists() ? nx.data().status : null };
    closedFyCarry.set(tx, map);
    if (nx.exists() && nx.data().status === 'finalized') {
      throw new PeriodLockedError(`FY ${nextId} is finalized, so FY ${fyId} can no longer be changed.`);
    }
  }
  return { fy, fyId, monthKey };
}

/** Light-weight check outside a transaction – used to disable buttons in the UI */
export function isPeriodLocked({ dateStr, user, fys = [], closings = {} }) {
  if (!dateStr) return false;
  const fy = fys.find((f) => f.id === fyIdOf(dateStr));
  if (!fy) return true;
  if (fy.status === 'finalized') return true;
  if (user?.role === 'superAdmin') return false;
  if (fy.status === 'closed') return true;
  return closings[monthKeyOf(dateStr)]?.status === 'closed';
}

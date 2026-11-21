// Light-weight period-lock check for the UI (the server checks again inside the transaction)
import { fyIdOf, monthKeyOf } from '@/lib/format';

export class PeriodLockedError extends Error {}

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

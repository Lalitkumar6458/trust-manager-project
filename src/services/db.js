'use client';

// Browser-side data helpers (reads go through /api/query; writes through /api/rpc)
export { fetchAll, fetchOne } from '@/lib/api';
export { where, orderBy, limit } from '@/lib/q';

/** Permission that makes a custom-role user receive a notification type */
export const NOTIFY_PERM = {
  donation_new: 'donations.verify',
  donation_verified: 'donations.approve',
  expense_pending: 'expenses.approve',
  large_expense: 'expenses.approve',
  expense_approved: 'expenses.pay',
  adjustment: 'ledger.view',
  month_closed: 'closing.view',
  fy_closed: 'fy.view',
  audit_pending: 'audit.view',
};

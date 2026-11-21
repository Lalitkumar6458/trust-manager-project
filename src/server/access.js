import 'server-only';
import { userCan } from '@/lib/permissions';

// ------------------------------------------------------------------
// Who may READ which collection, and which fields are hidden from whom.
// Writes never come from the browser – they go through /api/rpc, which checks
// the permission of every action (src/server/rpc.js).
// ------------------------------------------------------------------
const STAFF = ['superAdmin', 'accountant', 'operator', 'auditor', 'custom'];
const role = (u) => u?.role;
export const isStaff = (u) => !!u && u.active !== false && STAFF.includes(role(u));
export const isSuper = (u) => role(u) === 'superAdmin';
const isFinOrAud = (u) => ['superAdmin', 'accountant', 'auditor'].includes(role(u));
const any = (u, perms) => isStaff(u) && perms.some((p) => userCan(u, p));
const hasAny = (u, perms) => role(u) === 'custom' && (u.permissions || []).some((p) => perms.includes(p));

export const canReadLedger = (u) => isFinOrAud(u) || hasAny(u, ['ledger.view', 'accounts.view', 'reports.view', 'reconciliation.view',
  'closing.view', 'closing.close', 'audit.view', 'audit.manage', 'fy.view']);

/** may see balances, closing figures, year totals */
const MONEY = ['accounts.view', 'ledger.view', 'reports.view', 'reconciliation.view', 'closing.view', 'closing.close', 'audit.view', 'audit.manage', 'fy.view', 'fy.manage'];
export const canSeeMoney = (u) => any(u, MONEY);

const DON_READ = ['donations.view', 'donations.create', 'donations.verify', 'donations.approve', 'reports.view', 'dashboard.view', 'audit.view', 'closing.view', 'fy.view', 'ledger.view', 'funds.view'];
const EXP_READ = ['expenses.view', 'expenses.create', 'expenses.approve', 'expenses.pay', 'reports.view', 'dashboard.view', 'audit.view', 'closing.view', 'fy.view', 'ledger.view', 'funds.view'];
/** may see donor PAN / mobile / address */
const DONOR_PII = ['donations.view', 'donors.view', 'donations.create', 'donations.verify', 'donations.approve', 'reports.view'];
const PAYEE_PII = ['expenses.view', 'beneficiaries.view', 'expenses.create', 'expenses.approve', 'expenses.pay', 'reports.view'];

const READ = {
  settings: isStaff,
  counters: isStaff,
  trustees: isStaff,
  funds: isStaff,
  donationCategories: isStaff,
  expenseCategories: isStaff,
  roles: isStaff,
  notifications: isStaff,
  monthlyClosings: isStaff,
  financialYears: isStaff,
  accounts: isStaff,
  donors: (u) => any(u, ['donors.view', 'donors.edit', 'donations.create', 'donations.verify', 'reports.view']),
  beneficiaries: (u) => any(u, ['beneficiaries.view', 'beneficiaries.edit', 'expenses.create', 'expenses.approve', 'reports.view']),
  donations: (u) => any(u, DON_READ),
  expenses: (u) => any(u, EXP_READ),
  documents: (u) => any(u, ['documents.view', 'documents.upload', 'documents.archive', 'audit.view']),
  transactions: canReadLedger,
  stats: (u) => canReadLedger(u) || canSeeMoney(u),
  reports: (u) => any(u, ['reports.view', 'closing.view', 'audit.view']),
  bankStatements: (u) => isFinOrAud(u) || hasAny(u, ['reconciliation.view']),
  statementLines: (u) => isFinOrAud(u) || hasAny(u, ['reconciliation.view']),
  auditLogs: (u) => isFinOrAud(u) || hasAny(u, ['auditLogs.view']),
  users: isStaff, // non-super users only ever get their own record (see below)
  cashCounts: (u) => any(u, ['cash.count', 'accounts.view']),
  messageLogs: (u) => any(u, ['messages.send', 'settings.manage', 'auditLogs.view']),
  pledges: (u) => any(u, ['pledges.view', 'pledges.manage']),
  budgets: (u) => any(u, ['budget.view', 'budget.manage']),
  onlinePayments: (u) => any(u, ['online.view', 'donations.approve']),
  bookingResources: isStaff,
  bookings: (u) => any(u, ['bookings.view', 'bookings.manage']),
  sevaTypes: isStaff,
  sevaBookings: (u) => any(u, ['seva.view', 'seva.manage']),
  inventoryItems: (u) => any(u, ['inventory.view', 'inventory.manage']),
  stockMoves: (u) => any(u, ['inventory.view', 'inventory.manage']),
  assets: (u) => any(u, ['assets.view', 'assets.manage', 'audit.view']),
  staff: (u) => any(u, ['payroll.view', 'payroll.manage']),
  payslips: (u) => any(u, ['payroll.view', 'payroll.manage']),
  errorLogs: (u) => any(u, ['system.monitor']),
};

/** fields hidden from a user in a collection */
function hiddenFields(user, coll) {
  switch (coll) {
    case 'accounts': return canSeeMoney(user) ? [] : ['currentBalance', 'openingBalance', 'lastTxnId'];
    case 'financialYears': return canSeeMoney(user) ? [] : ['openingBalances', 'closingBalances', 'closingTotal', 'totals', 'assets', 'liabilities'];
    case 'monthlyClosings': return canSeeMoney(user) ? [] : ['donationTotal', 'expenseTotal', 'otherIncome', 'adjustment', 'openingTotal', 'closingBank', 'closingCash', 'closingTotal', 'accountClosing'];
    case 'donations': return any(user, DONOR_PII) ? [] : ['donor.pan', 'donor.mobile', 'donor.email', 'donor.address'];
    case 'expenses': return any(user, PAYEE_PII) ? [] : ['payee.pan', 'payee.mobile', 'payee.accountNumber', 'payee.address'];
    // blind cash count: the counter does not see the system balance
    case 'cashCounts': return canSeeMoney(user) ? [] : ['systemBalance', 'difference'];
    case 'staff': return any(user, ['payroll.manage']) ? [] : ['bankAccount', 'ifsc', 'pan', 'aadhaar', 'salary'];
    default: return [];
  }
}

export function redact(user, coll, row) {
  const hide = hiddenFields(user, coll);
  if (!hide.length || !row) return row;
  const out = { ...row };
  hide.forEach((f) => {
    const [a, b] = f.split('.');
    if (!b) delete out[a];
    else if (out[a] && typeof out[a] === 'object') { out[a] = { ...out[a] }; delete out[a][b]; }
  });
  return out;
}

export function assertCanRead(user, coll, constraints = []) {
  const fn = READ[coll];
  if (!fn) throw Object.assign(new Error(`Unknown collection: ${coll}`), { status: 400 });
  if (!fn(user)) throw Object.assign(new Error('You do not have permission to view this'), { status: 403 });
  // no filtering / sorting on hidden fields (it would reveal them)
  const hide = hiddenFields(user, coll);
  if (hide.length && constraints.some((c) => c && c.f && [].concat(c.f).some((f) => hide.some((h) => f === h || f.startsWith(`${h}.`) || h.startsWith(`${f}.`))))) {
    throw Object.assign(new Error('You do not have permission to view this'), { status: 403 });
  }
}

export function assertCanSum(user, coll, fields) {
  const hide = hiddenFields(user, coll);
  if (fields.some((f) => hide.some((h) => f === h || f.startsWith(`${h}.`)))) {
    throw Object.assign(new Error('You do not have permission to view this'), { status: 403 });
  }
}

/** Uploaded file: logo / signature images for everyone; documents need document access */
export function canReadFile(user, rel) {
  if (!isStaff(user)) return false;
  if (rel.startsWith('settings/')) return true;
  return READ.documents(user);
}

/** Extra filter forced onto a query (users: only yourself unless Super Admin) */
export function forcedFilter(user, coll) {
  if (coll === 'users' && !isSuper(user)) return [{ t: 'where', f: '__name__', op: '==', v: user.uid }];
  return [];
}

export const can = (user, perm) => userCan(user, perm);

export function assertCan(user, ...perms) {
  if (!perms.some((p) => userCan(user, p))) {
    throw Object.assign(new Error('You do not have permission for this action'), { status: 403 });
  }
}

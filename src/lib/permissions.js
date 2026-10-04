import { ROLES } from './constants';

const { superAdmin, accountant, operator, auditor } = ROLES;

/**
 * Permission matrix. Every UI action checks `can(role, permission)`.
 * The same rules are enforced server-side in firestore.rules.
 */
export const PERMISSIONS = {
  // viewing
  'dashboard.view': [superAdmin, accountant, operator, auditor],
  'donations.view': [superAdmin, accountant, operator, auditor],
  'expenses.view': [superAdmin, accountant, operator, auditor],
  'donors.view': [superAdmin, accountant, operator, auditor],
  'beneficiaries.view': [superAdmin, accountant, operator, auditor],
  'accounts.view': [superAdmin, accountant, auditor],
  'ledger.view': [superAdmin, accountant, auditor],
  'reports.view': [superAdmin, accountant, auditor],
  'reports.export': [superAdmin, accountant, auditor],
  'documents.view': [superAdmin, accountant, operator, auditor],
  'auditLogs.view': [superAdmin, accountant, auditor],
  'audit.view': [superAdmin, accountant, auditor],
  'fy.view': [superAdmin, accountant, auditor],
  'closing.view': [superAdmin, accountant, auditor],
  'reconciliation.view': [superAdmin, accountant, auditor],
  'trustees.view': [superAdmin, accountant, operator, auditor],
  'funds.view': [superAdmin, accountant, operator, auditor],

  // data entry
  'donations.create': [superAdmin, accountant, operator],
  'expenses.create': [superAdmin, accountant, operator],
  'donors.edit': [superAdmin, accountant, operator],
  'beneficiaries.edit': [superAdmin, accountant, operator],
  'documents.upload': [superAdmin, accountant, operator],

  // workflow
  'donations.verify': [superAdmin, accountant],
  'donations.approve': [superAdmin, accountant],
  'expenses.approve': [superAdmin, accountant],
  'expenses.pay': [superAdmin, accountant],
  'finance.void': [superAdmin, accountant],
  'documents.archive': [superAdmin, accountant],

  // accounting
  'accounts.manage': [superAdmin],
  'ledger.manual': [superAdmin, accountant],
  'reconciliation.manage': [superAdmin, accountant],
  'closing.close': [superAdmin, accountant],
  'closing.reopen': [superAdmin],
  'funds.manage': [superAdmin, accountant],

  // admin
  'fy.manage': [superAdmin],
  'audit.manage': [superAdmin, accountant],
  'audit.finalize': [superAdmin],
  'settings.manage': [superAdmin],
  'users.manage': [superAdmin],
  'trustees.manage': [superAdmin],
  'lockedPeriod.override': [superAdmin],
};

export function can(role, permission) {
  if (!role) return false;
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return allowed.includes(role);
}

// ------------------------------------------------------------------
// Custom roles
// A custom role is a named set of permission keys created by the Super Admin
// (collection `roles`). The keys are copied onto users/{uid}.permissions so
// that Firestore / Storage security rules can enforce them.
// ------------------------------------------------------------------
export const CUSTOM_ROLE = 'custom';

/** Actions that stay with the Super Admin – never grantable to a custom role */
export const SUPER_ONLY = ['users.manage', 'lockedPeriod.override', 'closing.reopen', 'fy.manage', 'audit.finalize', 'accounts.manage'];

/** Screen-wise catalogue used by the role editor: screen access + actions on that screen */
export const PERMISSION_GROUPS = [
  { key: 'dashboard', label: 'Dashboard', view: 'dashboard.view', actions: [] },
  {
    key: 'donations', label: 'Donations', view: 'donations.view',
    actions: [
      { perm: 'donations.create', label: 'Add / edit own donations' },
      { perm: 'donations.verify', label: 'Verify (and edit any entry)' },
      { perm: 'donations.approve', label: 'Approve (post to ledger)' },
    ],
  },
  { key: 'donors', label: 'Donors', view: 'donors.view', actions: [{ perm: 'donors.edit', label: 'Add / edit donors' }] },
  {
    key: 'expenses', label: 'Expenses', view: 'expenses.view',
    actions: [
      { perm: 'expenses.create', label: 'Add / edit own expenses' },
      { perm: 'expenses.approve', label: 'Approve (and edit any entry)' },
      { perm: 'expenses.pay', label: 'Mark paid (post to ledger)' },
    ],
  },
  { key: 'beneficiaries', label: 'Beneficiaries & Vendors', view: 'beneficiaries.view', actions: [{ perm: 'beneficiaries.edit', label: 'Add / edit beneficiaries & vendors' }] },
  { key: 'accounts', label: 'Bank Accounts & Cash Book', view: 'accounts.view', actions: [{ perm: 'accounts.manage', label: 'Add / edit bank & cash accounts' }] },
  {
    key: 'ledger', label: 'Transactions / Ledger', view: 'ledger.view',
    actions: [
      { perm: 'ledger.manual', label: 'Manual entries (deposit, withdrawal, transfer, adjustment)' },
      { perm: 'finance.void', label: 'Void entries (reversal)' },
    ],
  },
  { key: 'funds', label: 'Funds / Projects', view: 'funds.view', actions: [{ perm: 'funds.manage', label: 'Add / edit funds' }] },
  { key: 'reports', label: 'Reports', view: 'reports.view', actions: [{ perm: 'reports.export', label: 'Export PDF / Excel / CSV' }] },
  { key: 'reconciliation', label: 'Bank Reconciliation', view: 'reconciliation.view', actions: [{ perm: 'reconciliation.manage', label: 'Import statements & match' }] },
  {
    key: 'closing', label: 'Monthly Closing', view: 'closing.view',
    actions: [{ perm: 'closing.close', label: 'Close month' }, { perm: 'closing.reopen', label: 'Reopen month' }],
  },
  { key: 'fy', label: 'Financial Year', view: 'fy.view', actions: [{ perm: 'fy.manage', label: 'Close / finalize financial year' }] },
  {
    key: 'audit', label: 'Audit', view: 'audit.view',
    actions: [{ perm: 'audit.manage', label: 'Update audit status, assets & liabilities' }, { perm: 'audit.finalize', label: 'Finalize audit' }],
  },
  {
    key: 'documents', label: 'Documents', view: 'documents.view',
    actions: [{ perm: 'documents.upload', label: 'Upload documents' }, { perm: 'documents.archive', label: 'Archive documents' }],
  },
  { key: 'trustees', label: 'Trustees', view: 'trustees.view', actions: [{ perm: 'trustees.manage', label: 'Add / edit trustees' }] },
  { key: 'auditLogs', label: 'Audit Logs', view: 'auditLogs.view', actions: [] },
  { key: 'settings', label: 'Settings', view: 'settings.manage', actions: [] },
  { key: 'users', label: 'Users & Roles', view: 'users.manage', actions: [] },
];

/** English label for a permission key (screen access or action) */
export function permLabel(perm) {
  for (const g of PERMISSION_GROUPS) {
    if (g.view === perm) return g.label;
    const a = g.actions.find((x) => x.perm === perm);
    if (a) return `${g.label} – ${a.label}`;
  }
  return perm;
}

/** Keeps only grantable keys and adds the screen access an action needs */
export function normalizePerms(list = []) {
  const set = new Set(list.filter((p) => PERMISSIONS[p] && !SUPER_ONLY.includes(p)));
  PERMISSION_GROUPS.forEach((g) => {
    if (g.actions.some((a) => set.has(a.perm)) && !SUPER_ONLY.includes(g.view)) set.add(g.view);
  });
  // creating a donation / expense needs to pick (and create) donors / payees
  if (set.has('donations.create')) { set.add('donors.view'); }
  if (set.has('expenses.create')) { set.add('beneficiaries.view'); }
  return Object.keys(PERMISSIONS).filter((p) => set.has(p));
}

/** Permission keys a built-in role has (used to copy a built-in role into a custom one) */
export const builtInPerms = (role) => Object.keys(PERMISSIONS).filter((p) => PERMISSIONS[p].includes(role) && !SUPER_ONLY.includes(p));

/** Permission check for a user profile (built-in or custom role) */
export function userCan(user, permission) {
  if (!user || user.active === false) return false;
  if (user.role === CUSTOM_ROLE) return !SUPER_ONLY.includes(permission) && (user.permissions || []).includes(permission);
  return can(user.role, permission);
}

export const ROLE_DESCRIPTIONS = {
  superAdmin: 'Full access – trust settings, users, categories, financial years, finalisation, all financial data.',
  accountant: 'Donations, expenses, verification/approval, bank & cash transactions, reconciliation, reports, export, monthly closing.',
  operator: 'Add donations & expenses, upload documents, view records. Cannot approve, void, delete or change locked periods.',
  auditor: 'Read-only access to donations, expenses, ledger, reports, documents, audit logs and financial-year data.',
};

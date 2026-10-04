// ------------------------------------------------------------------
// Central constants for the Trust Financial Management System
// ------------------------------------------------------------------

export const COL = {
  settings: 'settings',
  counters: 'counters',
  users: 'users',
  trustees: 'trustees',
  donors: 'donors',
  beneficiaries: 'beneficiaries', // beneficiaries + vendors + other payees (field: type)
  accounts: 'accounts', // bank + cash accounts (field: type)
  funds: 'funds',
  donationCategories: 'donationCategories',
  expenseCategories: 'expenseCategories',
  donations: 'donations',
  expenses: 'expenses',
  transactions: 'transactions', // the ledger – every money movement on every account
  bankStatements: 'bankStatements',
  statementLines: 'statementLines',
  monthlyClosings: 'monthlyClosings',
  financialYears: 'financialYears',
  reports: 'reports',
  auditLogs: 'auditLogs',
  documents: 'documents',
  notifications: 'notifications',
  roles: 'roles',
  stats: 'stats',
};

// ---------------- Roles ----------------
export const ROLES = {
  superAdmin: 'superAdmin',
  accountant: 'accountant',
  operator: 'operator',
  auditor: 'auditor',
};

export const ROLE_LABELS = {
  superAdmin: 'Super Admin',
  accountant: 'Accountant',
  operator: 'Data Entry Operator',
  auditor: 'Auditor / CA',
  custom: 'Custom role',
};

export const ROLE_COLORS = {
  superAdmin: 'red',
  accountant: 'blue',
  operator: 'green',
  auditor: 'purple',
  custom: 'gold',
};

// ---------------- Donation ----------------
export const DONOR_TYPES = ['Individual', 'Company', 'Organization', 'Trust', 'Government', 'Other'];

export const PAYMENT_MODES = ['Cash', 'Bank Transfer', 'UPI', 'NEFT', 'RTGS', 'IMPS', 'Cheque', 'Demand Draft', 'Other'];

/** Payment modes that need a bank account (everything except Cash) */
export const isCashMode = (mode) => mode === 'Cash';

export const ID_TYPES = ['Aadhaar', 'Passport', 'Voter ID', 'Driving Licence', 'Other'];

export const DONATION_STATUS = {
  draft: 'draft',
  submitted: 'submitted',
  verified: 'verified',
  approved: 'approved',
  void: 'void',
};

export const DONATION_FLOW = ['draft', 'submitted', 'verified', 'approved'];

export const EXPENSE_STATUS = {
  draft: 'draft',
  submitted: 'submitted',
  approved: 'approved',
  paid: 'paid',
  void: 'void',
};

export const EXPENSE_FLOW = ['draft', 'submitted', 'approved', 'paid'];

export const STATUS_META = {
  draft: { label: 'Draft', color: 'default' },
  submitted: { label: 'Submitted', color: 'gold' },
  verified: { label: 'Verified', color: 'cyan' },
  approved: { label: 'Approved', color: 'green' },
  paid: { label: 'Paid', color: 'green' },
  void: { label: 'Void / Cancelled', color: 'red' },
  open: { label: 'Open', color: 'blue' },
  closed: { label: 'Closed', color: 'orange' },
  finalized: { label: 'Finalized', color: 'red' },
  active: { label: 'Active', color: 'green' },
  inactive: { label: 'Inactive', color: 'default' },
  reversed: { label: 'Reversed', color: 'red' },
  matched: { label: 'Matched', color: 'green' },
  unmatched: { label: 'Unmatched', color: 'orange' },
  ignored: { label: 'Ignored', color: 'default' },
  under_review: { label: 'Under Review', color: 'gold' },
  completed: { label: 'Audit Completed', color: 'cyan' },
};

// ---------------- Beneficiary / payee ----------------
export const PAYEE_TYPES = [
  { value: 'beneficiary', label: 'Beneficiary' },
  { value: 'vendor', label: 'Vendor / Supplier' },
  { value: 'staff', label: 'Staff' },
  { value: 'organization', label: 'Organization / Institution' },
  { value: 'other', label: 'Other' },
];
export const payeeTypeLabel = (t) => PAYEE_TYPES.find((p) => p.value === t)?.label || t || '';

// ---------------- Accounts & ledger ----------------
export const ACCOUNT_TYPES = ['Savings', 'Current', 'Fixed Deposit', 'Other'];

export const TXN_TYPES = {
  opening: 'Opening Balance',
  donation: 'Donation',
  expense: 'Expense',
  transfer: 'Bank Transfer',
  cash_deposit: 'Cash Deposit',
  cash_withdrawal: 'Cash Withdrawal',
  bank_charges: 'Bank Charges',
  interest: 'Interest',
  other_income: 'Other Income',
  adjustment: 'Adjustment',
  reversal: 'Reversal',
};

/** Manual entries that can be created from the Transactions screen */
export const MANUAL_TXN_TYPES = [
  { value: 'transfer', label: 'Bank → Bank Transfer', pair: true },
  { value: 'cash_deposit', label: 'Cash Deposit (Cash → Bank)', pair: true },
  { value: 'cash_withdrawal', label: 'Cash Withdrawal (Bank → Cash)', pair: true },
  { value: 'bank_charges', label: 'Bank Charges (Out)', direction: 'out' },
  { value: 'interest', label: 'Interest Received (In)', direction: 'in' },
  { value: 'other_income', label: 'Other Income (In)', direction: 'in' },
  { value: 'adjustment', label: 'Adjustment (In / Out)', direction: 'either' },
];

// ---------------- Funds ----------------
export const FUND_TYPES = [
  { value: 'general', label: 'General / Unrestricted' },
  { value: 'restricted', label: 'Restricted / Specific Purpose' },
  { value: 'corpus', label: 'Corpus Fund' },
  { value: 'project', label: 'Project / Program' },
];

// ---------------- Documents ----------------
export const DOC_TYPES = [
  'Donation Receipt',
  'Bank Statement',
  'Cheque',
  'Invoice',
  'Bill',
  'Medical Document',
  'Education Document',
  'Beneficiary Document',
  'Approval Document',
  'Audit Document',
  'Government Document',
  'ID Proof',
  'Other',
];

// ---------------- Audit ----------------
export const AUDIT_STATUS = ['draft', 'under_review', 'completed', 'finalized'];

export const DESIGNATIONS = ['President', 'Vice President', 'Secretary', 'Joint Secretary', 'Treasurer', 'Trustee', 'Member', 'Accountant', 'Auditor', 'Other'];

// ---------------- Default master data (used by first-time setup) ----------------
export const DEFAULT_DONATION_CATEGORIES = [
  { name: 'General Donation', nameHi: 'सामान्य दान' },
  { name: 'Marriage Assistance', nameHi: 'शादी सहायता के लिए' , showOnReceipt: true },
  { name: 'Family Assistance', nameHi: 'परिवार सहायता के लिए' , showOnReceipt: true },
  { name: 'Women Development', nameHi: 'महिला सर्वांगीण विकास' , showOnReceipt: true },
  { name: 'Education / Medical Assistance', nameHi: 'शिक्षा / चिकित्सा सहायता' , showOnReceipt: true },
  { name: 'Elderly Assistance', nameHi: 'बुजुर्ग सहायता' , showOnReceipt: true },
  { name: 'Education', nameHi: 'शिक्षा' },
  { name: 'Medical Assistance', nameHi: 'चिकित्सा सहायता' },
  { name: 'Food Distribution', nameHi: 'भोजन वितरण' },
  { name: 'Poor / Needy Assistance', nameHi: 'गरीब / जरूरतमंद सहायता' },
  { name: 'Religious Activity', nameHi: 'धार्मिक कार्य' },
  { name: 'Social Welfare', nameHi: 'समाज कल्याण' },
  { name: 'Disaster Relief', nameHi: 'आपदा राहत' },
  { name: 'Building / Fund Development', nameHi: 'भवन / कोष विकास' },
  { name: 'Corpus Donation', nameHi: 'स्थायी कोष दान', isCorpus: true },
  { name: 'Specific Project Donation', nameHi: 'विशेष परियोजना दान' },
  { name: 'Other', nameHi: 'अन्य', showOnReceipt: true },
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  ['Education', 'शिक्षा'],
  ['Medical', 'चिकित्सा'],
  ['Food', 'भोजन'],
  ['Marriage Assistance', 'शादी सहायता'],
  ['Salary', 'वेतन'],
  ['Staff Expense', 'स्टाफ खर्च'],
  ['Office Expense', 'कार्यालय खर्च'],
  ['Rent', 'किराया'],
  ['Electricity', 'बिजली'],
  ['Internet', 'इंटरनेट'],
  ['Travel', 'यात्रा'],
  ['Transportation', 'परिवहन'],
  ['Event', 'कार्यक्रम'],
  ['Social Welfare', 'समाज कल्याण'],
  ['Religious Activity', 'धार्मिक कार्य'],
  ['Donation Given', 'दिया गया दान'],
  ['Government Fees', 'सरकारी शुल्क'],
  ['Professional Fees', 'व्यावसायिक शुल्क'],
  ['Audit Fees', 'ऑडिट शुल्क'],
  ['Legal Fees', 'कानूनी शुल्क'],
  ['Bank Charges', 'बैंक शुल्क'],
  ['Printing', 'छपाई'],
  ['Advertisement', 'विज्ञापन'],
  ['Maintenance', 'रखरखाव'],
  ['Capital / Asset Purchase', 'संपत्ति खरीद', true],
  ['Other', 'अन्य'],
].map(([name, nameHi, isCapital]) => ({ name, nameHi, isCapital: !!isCapital }));

export const DEFAULT_TRUST_SETTINGS = {
  name: 'श्री शावलाजी सेवा संस्थान',
  nameEn: 'Shri Shavlaji Seva Sansthan',
  invocationLines: ['॥ श्री गणेशाय नमः ॥', '॥ श्री साँवरिया जी भगवान नमः ॥'],
  address: '20/2, शिवम फ्लेट, ग्राउण्ड फ्लोर, पुलिस चौकी के पास, बापुनगर, अहमदाबाद - 380024',
  phones: '9723878021 / 8511878021 / 9408323975',
  email: '',
  website: '',
  registrationNo: 'E / 24833 / अहमदाबाद',
  registrationDate: '17/3/26',
  pan: 'ABOTS3964Q',
  taxDetails: '',
  section80G: '',
  section12A: '',
  authorizedSignatory: '',
  president: '',
  secretary: '',
  treasurer: '',
  auditor: '',
  receiptPrefix: 'DR',
  voucherPrefix: 'PV',
  receiptNote: '',
  receiptTitle: 'दान रसीद',
  receiptIntro: 'आप श्री तरफ से संस्थान को नीचे विगत से दान मिला है:-',
  voucherTitle: 'भुगतान वाउचर / रसीद',
  receiptBeforeApproval: 'provisional',
  largeExpenseThreshold: 50000,
  cashLimitWarning: 2000,
  leftImageUrl: '',
  rightImageUrl: '',
  logoUrl: '',
  signatureUrl: '',
  stampUrl: '',
};

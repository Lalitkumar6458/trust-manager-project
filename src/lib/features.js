// ------------------------------------------------------------------
// Sellable modules (features) for the multi-sanstha (SaaS) setup.
// "Core" (donations, receipts, donors, expenses, books, reports, users …) is always on.
// Each add-on below is switched on per plan / per sanstha in the owner control panel.
// Pure – used by the browser and the server.
// ------------------------------------------------------------------

export const FEATURES = [
  { key: 'pledges', en: 'Sankalp / pledges (regular donation)', hi: 'संकल्प (नियमित दान)' },
  { key: 'messaging', en: 'WhatsApp & email messages', hi: 'WhatsApp / ईमेल संदेश' },
  { key: 'reconciliation', en: 'Bank reconciliation (statement import)', hi: 'बैंक मिलान (स्टेटमेंट इम्पोर्ट)' },
  { key: 'budget', en: 'Budget vs actual', hi: 'बजट बनाम वास्तविक' },
  { key: 'form10bd', en: '80G Form 10BD / 10BE', hi: '80G फॉर्म 10BD / 10BE' },
  { key: 'tally', en: 'Tally export', hi: 'Tally एक्सपोर्ट' },
  { key: 'online', en: 'Online donation (Razorpay)', hi: 'ऑनलाइन दान (Razorpay)' },
  { key: 'portal', en: 'Donor portal', hi: 'दाता पोर्टल' },
  { key: 'seva', en: 'Seva / pooja booking', hi: 'सेवा / पूजा बुकिंग' },
  { key: 'bookings', en: 'Hall / room booking', hi: 'हॉल / कमरा बुकिंग' },
  { key: 'inventory', en: 'Store / inventory', hi: 'भंडार / स्टॉक' },
  { key: 'assets', en: 'Asset register', hi: 'संपत्ति रजिस्टर' },
  { key: 'payroll', en: 'Staff & salary', hi: 'कर्मचारी व वेतन' },
];
export const FEATURE_KEYS = FEATURES.map((f) => f.key);
export const featureLabel = (key, lang = 'en') => {
  const f = FEATURES.find((x) => x.key === key);
  return f ? (lang === 'hi' ? f.hi : f.en) : key;
};

/** What the core always includes (shown on plan cards) */
export const CORE_INCLUDES = {
  en: 'Donations & receipts, quick counter entry, donors, 80G receipts with QR check, expenses & vouchers, bank / cash books, cash count, funds, monthly closing, financial year, reports, audit, documents, users & roles',
  hi: 'दान व रसीद, काउंटर प्रविष्टि, दाता, 80G रसीद व QR जाँच, खर्च व वाउचर, बैंक / रोकड़ बही, नोट गिनती, फंड, मासिक बंदी, वित्तीय वर्ष, रिपोर्ट, ऑडिट, दस्तावेज़, उपयोगकर्ता',
};

// permission prefix → feature
const PERM_FEATURE = {
  pledges: 'pledges', messages: 'messaging', reconciliation: 'reconciliation', budget: 'budget', online: 'online',
  seva: 'seva', bookings: 'bookings', inventory: 'inventory', assets: 'assets', payroll: 'payroll',
};
export const permFeature = (perm) => PERM_FEATURE[String(perm).split('.')[0]] || null;

// server action name → feature (longest prefix first)
const RPC_FEATURE = [
  ['reports.form10bd', 'form10bd'], ['reports.tally', 'tally'], ['pledges.', 'pledges'], ['messages.sendReceipt', 'messaging'], ['rec.', 'reconciliation'],
  ['budget.', 'budget'], ['online.', 'online'], ['seva.', 'seva'], ['bookings.', 'bookings'], ['inventory.', 'inventory'], ['assets.', 'assets'], ['payroll.', 'payroll'],
];
export const rpcFeature = (name) => (RPC_FEATURE.find(([p]) => String(name).startsWith(p)) || [])[1] || null;

// panel page → feature
const PATH_FEATURE = [
  ['/pledges', 'pledges'], ['/reconciliation', 'reconciliation'], ['/budget', 'budget'], ['/reports/form-10bd', 'form10bd'], ['/reports/tally', 'tally'],
  ['/online-donations', 'online'], ['/seva', 'seva'], ['/bookings', 'bookings'], ['/inventory', 'inventory'], ['/assets', 'assets'], ['/payroll', 'payroll'],
];
export const pathFeature = (path) => (PATH_FEATURE.find(([p]) => path === p || String(path).startsWith(`${p}/`)) || [])[1] || null;

// read API collection → feature
const COLL_FEATURE = {
  pledges: 'pledges', bankStatements: 'reconciliation', statementLines: 'reconciliation', budgets: 'budget',
  onlinePayments: 'online', sevaTypes: 'seva', sevaBookings: 'seva', bookingResources: 'bookings', bookings: 'bookings',
  inventoryItems: 'inventory', stockMoves: 'inventory', assets: 'assets', staff: 'payroll', payslips: 'payroll',
};
export const collectionFeature = (coll) => COLL_FEATURE[coll] || null;

/** server actions still allowed when the plan has expired (read-only mode) */
export const READ_SAFE_RPC = new Set([
  'search.global', 'closing.pending', 'fy.checklist', 'messages.status', 'online.status', 'system.health', 'reports.tally', 'reports.form10bd',
  'receipts.verifyTokens', 'notifications.read', 'donations.printed', 'users.changeOwnPassword', 'users.twoFactorList', 'users.updateLogin', 'users.reset2fa',
  'auth.totpStatus', 'auth.totpSetup', 'auth.totpEnable', 'auth.totpDisable',
]);
/** permissions still allowed in read-only mode (everything else = a change) */
const READ_PERM = (p) => /\.view$/.test(p) || ['reports.export', 'system.monitor', 'users.manage'].includes(p);

/** Full licence = single install (no control panel) – everything on, no expiry */
export const FULL_LICENSE = { mode: 'single', features: FEATURE_KEYS, state: 'active', readOnly: false, locked: false };

/** may this permission be used under this licence? */
export function permAllowed(lic, perm) {
  if (!lic || lic.mode === 'single') return true;
  if (lic.locked) return false;
  const f = permFeature(perm);
  if (f && !(lic.features || []).includes(f)) return false;
  if (lic.readOnly && !READ_PERM(perm)) return false;
  return true;
}
export const hasFeature = (lic, key) => !lic || lic.mode === 'single' || (lic.features || []).includes(key);

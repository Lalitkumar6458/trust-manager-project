// ------------------------------------------------------------------
// Receipt design – every option the trust can change in Settings → Receipt design.
// Stored in settings/trust as `receiptDesign`. Missing values fall back to these defaults,
// so old receipts keep looking exactly like before.
// ------------------------------------------------------------------

export const RECEIPT_TEMPLATES = [
  { value: 'classic', label: 'Classic (traditional border)' },
  { value: 'modern', label: 'Modern (colour header)' },
  { value: 'simple', label: 'Simple (black & white, ink saving)' },
];

export const RECEIPT_SIZES = [
  { value: 'A5', label: 'A5 portrait (half A4)' },
  { value: 'A5L', label: 'A5 landscape' },
  { value: 'A4', label: 'A4 portrait' },
  { value: 'A4x2', label: 'A4 – donor copy + office copy on one page' },
  { value: 'T80', label: 'Thermal printer 80 mm' },
];

export const RECEIPT_LANGUAGES = [
  { value: 'hi', label: 'Hindi' },
  { value: 'en', label: 'English' },
  { value: 'both', label: 'Hindi + English' },
];

/** Default printed words per language (the trust can override each one) */
export const RECEIPT_LABELS = {
  hi: {
    title: 'दान रसीद', number: 'नंबर', date: 'तारीख', donor: 'श्री', address: 'पता', mobile: 'मोबाइल', pan: 'पैन', email: 'ईमेल',
    intro: 'आप श्री तरफ से संस्थान को नीचे विगत से दान मिला है:-', sn: 'क्र.सं.', particulars: 'विगत', rupees: 'रु.', paise: 'पैसा', total: 'कुल',
    inWords: 'शब्दों में', payment: 'रोकड़ा / चैक / Online UTR', purpose: 'उद्देश्य', fy: 'वित्तीय वर्ष', signature: 'आभार [मुहर/हस्ताक्षर]',
    thankYou: 'आपके सहयोग के लिए हार्दिक धन्यवाद', donorCopy: 'दाता प्रति', officeCopy: 'कार्यालय प्रति', duplicate: 'प्रतिलिपि / DUPLICATE',
    phone: 'फोन', registration: 'पंजीकरण संख्या', trustPan: 'पैन संख्या', computer: 'कंप्यूटर द्वारा जारी रसीद', scanToVerify: 'स्कैन कर रसीद जाँचें',
  },
  en: {
    title: 'DONATION RECEIPT', number: 'Receipt No.', date: 'Date', donor: 'Received with thanks from', address: 'Address', mobile: 'Mobile', pan: 'PAN', email: 'Email',
    intro: 'the following donation:', sn: 'S.No.', particulars: 'Particulars', rupees: 'Rs.', paise: 'Ps.', total: 'Total',
    inWords: 'In words', payment: 'Payment', purpose: 'Purpose', fy: 'Financial year', signature: 'Authorised Signatory',
    thankYou: 'Thank you for your generous support', donorCopy: 'Donor copy', officeCopy: 'Office copy', duplicate: 'DUPLICATE',
    phone: 'Phone', registration: 'Regn. No.', trustPan: 'PAN', computer: 'Computer generated receipt', scanToVerify: 'Scan to verify',
  },
};
RECEIPT_LABELS.both = Object.fromEntries(Object.keys(RECEIPT_LABELS.hi).map((k) => {
  const h = RECEIPT_LABELS.hi[k];
  const e = RECEIPT_LABELS.en[k];
  if (['intro', 'thankYou', 'donor'].includes(k)) return [k, `${h} / ${e}`];
  return [k, h === e ? h : `${h} / ${e}`];
}));

export const LABEL_FIELDS = [
  ['title', 'Receipt title'], ['number', 'Receipt number'], ['date', 'Date'], ['donor', 'Donor name label'], ['address', 'Address'],
  ['mobile', 'Mobile'], ['pan', 'PAN'], ['intro', 'Intro line'], ['sn', 'S.No. column'], ['particulars', 'Particulars column'],
  ['rupees', 'Rupees column'], ['paise', 'Paise column'], ['total', 'Total'], ['inWords', 'Amount in words'], ['payment', 'Payment details'],
  ['purpose', 'Purpose'], ['fy', 'Financial year'], ['signature', 'Signature line'], ['thankYou', 'Thank-you line'],
  ['donorCopy', 'Donor copy'], ['officeCopy', 'Office copy'], ['scanToVerify', 'Under the QR code'],
];

/** what can be switched on / off */
export const SHOW_FIELDS = [
  ['invocation', 'Top invocation lines'], ['leftImage', 'Left image / logo'], ['rightImage', 'Right image'], ['address', 'Trust address'],
  ['phones', 'Trust phone numbers'], ['email', 'Trust email / website'], ['registration', 'Registration no. & trust PAN'], ['tax', '80G / 12A numbers'],
  ['donorAddress', 'Donor address'], ['donorMobile', 'Donor mobile'], ['donorPan', 'Donor PAN'], ['donorEmail', 'Donor email'],
  ['wordsHi', 'Amount in words (Hindi)'], ['wordsEn', 'Amount in words (English)'], ['payment', 'Payment details (mode / UTR / cheque)'],
  ['purpose', 'Purpose'], ['fy', 'Financial year'], ['signature', 'Signature image'], ['stamp', 'Stamp image'], ['qr', 'QR code – online verification'],
  ['watermark', 'Faint logo watermark'], ['thankYou', 'Thank-you line'], ['computer', '“Computer generated” line'],
];

export const DEFAULT_RECEIPT_DESIGN = {
  template: 'classic',
  pageSize: 'A5',
  language: 'hi',
  colors: { primary: '#7d1a12', accent: '#c8963e', text: '#2a1a12', paper: '#fcf3dc' },
  paperTint: true,
  fontScale: 1,
  categoryRows: 'all', // all receipt categories as tick rows | only donated lines
  show: {
    invocation: true, leftImage: true, rightImage: true, address: true, phones: true, email: false, registration: true, tax: true,
    donorAddress: true, donorMobile: true, donorPan: true, donorEmail: false, wordsHi: true, wordsEn: true, payment: true, purpose: true,
    fy: true, signature: true, stamp: true, qr: false, watermark: false, thankYou: false, computer: true,
  },
  labels: {},
  footerText: '',
  verifyBaseUrl: '', // public website address for the QR link; empty = the address the panel is opened on
};

/** Effective design = defaults + saved design (+ older single settings like receiptTitle / receiptIntro) */
export function receiptDesignOf(settings = {}) {
  const saved = settings.receiptDesign || {};
  const d = {
    ...DEFAULT_RECEIPT_DESIGN,
    ...saved,
    colors: { ...DEFAULT_RECEIPT_DESIGN.colors, ...(saved.colors || {}) },
    show: { ...DEFAULT_RECEIPT_DESIGN.show, ...(saved.show || {}) },
  };
  const base = RECEIPT_LABELS[d.language] || RECEIPT_LABELS.hi;
  const legacy = {};
  if (d.language === 'hi') {
    if (settings.receiptTitle) legacy.title = settings.receiptTitle;
    if (settings.receiptIntro) legacy.intro = settings.receiptIntro;
  }
  const custom = Object.fromEntries(Object.entries(saved.labels || {}).filter(([, v]) => v && String(v).trim()));
  d.labels = { ...base, ...legacy, ...custom };
  return d;
}

/** Public verification link printed as QR:  https://site/r/<token> */
export function receiptVerifyUrl(design, token) {
  let base = String(design.verifyBaseUrl || '').trim().replace(/\/+$/, '');
  if (!base && typeof window !== 'undefined') base = window.location.origin;
  if (base && !/^https?:\/\//i.test(base)) base = `https://${base}`;
  return `${base}/r/${token}`;
}

/** Text inside the receipt QR code (fallback when no verification link) – anyone can read it with a phone camera to check the receipt */
export function receiptQrText(d, t) {
  return [
    t.nameEn || t.name,
    `Receipt: ${d.receiptNo || 'DRAFT'}`,
    `Date: ${d.date}`,
    `Amount: Rs ${Number(d.amount || 0).toFixed(2)}`,
    `Donor: ${d.donor?.name || ''}`,
    t.pan ? `Trust PAN: ${t.pan}` : null,
  ].filter(Boolean).join('\n');
}

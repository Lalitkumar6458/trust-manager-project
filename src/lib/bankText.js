// Reading the bank statement narration (pure – also used by the tests)

/** UPI / NEFT / IMPS / RTGS / cheque from the bank narration */
export function guessMode(text = '') {
  const t = String(text).toUpperCase();
  if (/\bUPI\b|UPI\//.test(t)) return 'UPI';
  if (/\bIMPS\b/.test(t)) return 'IMPS';
  if (/\bNEFT\b/.test(t)) return 'NEFT';
  if (/\bRTGS\b/.test(t)) return 'RTGS';
  if (/\b(CHQ|CHEQUE|CLG|CLEARING)\b/.test(t)) return 'Cheque';
  return 'Bank Transfer';
}

/** UTR / reference: explicit reference column, else the longest 10-22 char alphanumeric token with digits */
export function guessUtr(line) {
  if (line.reference && String(line.reference).trim().length >= 6) return String(line.reference).trim();
  const toks = String(line.description || '').split(/[\s/:|-]+/).filter((x) => /^[A-Z0-9]{10,22}$/i.test(x) && /\d{6,}/.test(x));
  return toks.sort((a, b) => b.length - a.length)[0] || '';
}

// Unit tests for the pure business rules:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { amountInWordsEn, amountInWordsHi } from '../src/lib/amountInWords.js';
import { round2, sum, fyIdOf, fyRange, PAN_REGEX, MOBILE_REGEX } from '../src/lib/format.js';
import { hotp, verifyTotp, base32Encode, base32Decode, recoveryCodes, hashCode } from '../src/lib/totp.js';
import { guessMode, guessUtr } from '../src/lib/bankText.js';
import { receiptDesignOf, RECEIPT_LABELS, receiptVerifyUrl } from '../src/lib/receiptDesign.js';
import { withRunningBalance } from '../src/lib/ledgerMath.js';
import { can, PERMISSIONS } from '../src/lib/permissions.js';

test('money rounding never drifts', () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(sum([{ a: 0.1 }, { a: 0.2 }, { a: 0.7 }], (x) => x.a), 1);
  assert.equal(round2('12.345'), 12.35);
});

test('financial year (April–March)', () => {
  assert.equal(fyIdOf('2026-03-31'), '2025-26');
  assert.equal(fyIdOf('2026-04-01'), '2026-27');
  const r = fyRange('2026-27');
  assert.equal(r.start, '2026-04-01');
  assert.equal(r.end, '2027-03-31');
});

test('amount in words (Indian system)', () => {
  assert.match(amountInWordsEn(1100), /One Thousand One Hundred/i);
  assert.match(amountInWordsEn(250000), /Two Lakh Fifty Thousand/i);
  assert.match(amountInWordsEn(1234.5), /Fifty Paise/i);
  assert.ok(amountInWordsHi(1100).length > 5);
});

test('PAN / mobile validation', () => {
  assert.ok(PAN_REGEX.test('ABCDE1234F'));
  assert.ok(!PAN_REGEX.test('ABCDE12345'));
  assert.ok(MOBILE_REGEX.test('9876543210'));
  assert.ok(!MOBILE_REGEX.test('1234567890'));
});

test('TOTP matches RFC 6238 test vector', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  // RFC 6238 SHA1 at T=59s → 94287082 → last 6 digits
  assert.equal(hotp(secret, 1), '287082');
  assert.ok(verifyTotp(secret, '287082', { now: 59_000 }));
  assert.ok(!verifyTotp(secret, '287083', { now: 59_000 }));
  assert.ok(!verifyTotp(secret, '287082', { now: 59_000 + 120_000 }));
  const codes = recoveryCodes();
  assert.equal(codes.length, 8);
  assert.equal(hashCode(codes[0].toLowerCase()), hashCode(codes[0]));
});

test('bank narration → payment mode and UTR', () => {
  assert.equal(guessMode('UPI/CR/432198765432/RAMESH'), 'UPI');
  assert.equal(guessMode('NEFT-SBIN0001-XYZ'), 'NEFT');
  assert.equal(guessMode('BY CLG CHQ 000123'), 'Cheque');
  assert.equal(guessMode('TRANSFER FROM 1234'), 'Bank Transfer');
  assert.equal(guessUtr({ description: 'UPI/CR/432198765432/RAMESH/SBIN', reference: '' }), '432198765432');
  assert.equal(guessUtr({ description: 'x', reference: 'REF998877' }), 'REF998877');
});

test('receipt design defaults + labels', () => {
  const d = receiptDesignOf({});
  assert.equal(d.template, 'classic');
  assert.equal(d.labels.title, RECEIPT_LABELS.hi.title);
  const e = receiptDesignOf({ receiptDesign: { language: 'en', labels: { title: 'RECEIPT' } } });
  assert.equal(e.labels.title, 'RECEIPT');
  assert.equal(e.labels.total, 'Total');
  assert.equal(receiptVerifyUrl({ verifyBaseUrl: 'trust.org/' }, 'abc.def'), 'https://trust.org/r/abc.def');
});

test('running balance', () => {
  const rows = withRunningBalance([{ credit: 100, debit: 0 }, { credit: 0, debit: 30 }, { credit: 5.5, debit: 0 }], 10);
  assert.deepEqual(rows.map((r) => r.balance), [110, 80, 85.5]);
});

test('permissions', () => {
  assert.ok(can('superAdmin', 'settings.manage'));
  assert.ok(!can('operator', 'settings.manage'));
  assert.ok(can('operator', 'cash.count'));
  assert.ok(!can('auditor', 'donations.create'));
  for (const [k, roles] of Object.entries(PERMISSIONS)) assert.ok(roles.includes('superAdmin') || k === 'none', `${k} must include superAdmin`);
});

// ---------------- subscription / licence ----------------
test('licence states: active → warning → grace → read-only, suspended = locked', async () => {
  const { licenseState } = await import('@/lib/license');
  const base = { expiresOn: '2026-12-31', graceDays: 7, warnDays: 15 };
  assert.equal(licenseState({ ...base, today: '2026-11-01' }).state, 'active');
  assert.equal(licenseState({ ...base, today: '2026-12-20' }).state, 'warning');
  assert.equal(licenseState({ ...base, today: '2026-12-31' }).daysLeft, 0);
  const g = licenseState({ ...base, today: '2027-01-03' });
  assert.equal(g.state, 'grace');
  assert.equal(g.readOnly, false);
  assert.equal(g.graceEndsOn, '2027-01-07');
  const r = licenseState({ ...base, today: '2027-01-08' });
  assert.equal(r.state, 'readonly');
  assert.equal(r.readOnly, true);
  assert.equal(licenseState({ ...base, status: 'suspended', today: '2026-11-01' }).locked, true);
  assert.equal(licenseState({ expiresOn: null }).state, 'active');
});

test('renewal continues from old expiry inside grace, from today after it', async () => {
  const { extendExpiry, addMonths } = await import('@/lib/license');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-11-15', 12), '2027-11-15');
  assert.deepEqual(extendExpiry({ expiresOn: '2026-12-31', graceDays: 7, today: '2026-12-20', months: 12 }), { from: '2027-01-01', to: '2027-12-31' });
  assert.deepEqual(extendExpiry({ expiresOn: '2026-12-31', graceDays: 7, today: '2027-01-05', months: 12 }), { from: '2027-01-01', to: '2027-12-31' });
  assert.deepEqual(extendExpiry({ expiresOn: '2026-12-31', graceDays: 7, today: '2027-02-10', months: 12 }), { from: '2027-02-10', to: '2028-02-10' });
  assert.deepEqual(extendExpiry({ expiresOn: null, today: '2026-11-19', months: 1 }), { from: '2026-11-19', to: '2026-12-19' });
});

test('features: plan ± override, permissions, server actions, read-only', async () => {
  const { effectiveFeatures } = await import('@/lib/license');
  const f = await import('@/lib/features');
  assert.deepEqual(effectiveFeatures(['pledges', 'tally'], { add: ['seva'], remove: ['tally'] }), ['pledges', 'seva']);
  const lic = { mode: 'saas', features: ['pledges'], readOnly: false };
  assert.equal(f.permAllowed(lic, 'pledges.manage'), true);
  assert.equal(f.permAllowed(lic, 'seva.view'), false);
  assert.equal(f.permAllowed(lic, 'donations.create'), true);
  assert.equal(f.permAllowed({ ...lic, readOnly: true }, 'donations.create'), false);
  assert.equal(f.permAllowed({ ...lic, readOnly: true }, 'donations.view'), true);
  assert.equal(f.permAllowed(f.FULL_LICENSE, 'payroll.manage'), true);
  assert.equal(f.rpcFeature('reports.form10bdFiling'), 'form10bd');
  assert.equal(f.rpcFeature('donations.create'), null);
  assert.equal(f.pathFeature('/reports/tally'), 'tally');
  assert.equal(f.pathFeature('/reports'), null);
  assert.equal(f.collectionFeature('stockMoves'), 'inventory');
});

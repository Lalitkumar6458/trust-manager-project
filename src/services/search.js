'use client';

import { COL } from '@/lib/constants';
import { normalizeSearch } from '@/lib/keywords';
import { fetchAll, where, limit } from './db';

/**
 * Global search across donations, expenses, donors, beneficiaries & ledger.
 * Matches on searchKeywords (name prefixes, receipt/voucher no, UTR, mobile, PAN …)
 */
export async function globalSearch(text, { canLedger = false } = {}) {
  const term = normalizeSearch(text);
  if (term.length < 2) return [];
  const q = (coll) => fetchAll(coll, where('searchKeywords', 'array-contains', term), limit(15)).catch(() => []);
  const [dons, exps, donors, payees, txns] = await Promise.all([
    q(COL.donations), q(COL.expenses), q(COL.donors), q(COL.beneficiaries), canLedger ? q(COL.transactions) : [],
  ]);
  return [
    ...dons.map((d) => ({ kind: 'Donation', id: d.id, title: `${d.receiptNo || 'Draft'} – ${d.donor?.name}`, sub: `${d.date} · ₹${d.amount} · ${d.status}`, href: `/donations/${d.id}` })),
    ...exps.map((e) => ({ kind: 'Expense', id: e.id, title: `${e.voucherNo || 'Draft'} – ${e.payee?.name}`, sub: `${e.date} · ₹${e.amount} · ${e.categoryName} · ${e.status}`, href: `/expenses/${e.id}` })),
    ...donors.map((d) => ({ kind: 'Donor', id: d.id, title: `${d.name}${d.organizationName ? ` (${d.organizationName})` : ''}`, sub: `${d.donorCode || ''} · ${d.mobile || ''} · Total ₹${d.totalAmount || 0}`, href: `/donors/${d.id}` })),
    ...payees.map((p) => ({ kind: p.type === 'vendor' ? 'Vendor' : 'Beneficiary', id: p.id, title: p.name, sub: `${p.code || ''} · ${p.mobile || ''} · Paid ₹${p.totalAmount || 0}`, href: `/beneficiaries/${p.id}` })),
    ...txns.map((t) => ({ kind: 'Ledger', id: t.id, title: `${t.reference || t.type} – ${t.accountName}`, sub: `${t.date} · In ₹${t.credit} / Out ₹${t.debit}`, href: `/transactions?highlight=${t.id}` })),
  ];
}

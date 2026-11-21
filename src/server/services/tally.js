import 'server-only';
import { COL } from '@/lib/constants';
import { round2 } from '@/lib/format';
import { fetchAll, fetchOne, where } from './db';
import { sql } from '../pg';

// ------------------------------------------------------------------
// Tally export (Tally Prime / ERP 9 "Import Data" XML) built from the ledger
// (transactions), so it always equals the books shown in the panel.
//   masters.xml  – ledgers (bank, cash, donation / expense heads …)
//   vouchers.xml – Receipt / Payment / Contra vouchers for the period
// Gateway of Tally → Import → Masters, then Import → Transactions.
// ------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const tdate = (d) => String(d).replace(/-/g, '');
const amt = (n) => round2(n).toFixed(2);

const FIXED = {
  bank_charges: { name: 'Bank Charges', parent: 'Indirect Expenses' },
  interest: { name: 'Bank Interest Received', parent: 'Indirect Incomes' },
  other_income: { name: 'Other Income', parent: 'Indirect Incomes' },
  adjustment: { name: 'Suspense – Adjustments', parent: 'Suspense A/c' },
};

function envelope(company, reportName, messages) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>${reportName}</REPORTNAME>
    ${company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : ''}
   </REQUESTDESC>
   <REQUESTDATA>
${messages.join('\n')}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`;
}

const ledgerXml = (name, parent) => `    <TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(name)}" ACTION="Create"><NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST><PARENT>${esc(parent)}</PARENT><ISBILLWISEON>No</ISBILLWISEON><AFFECTSSTOCK>No</AFFECTSSTOCK></LEDGER></TALLYMESSAGE>`;

/** Tally entry: debit → negative amount + ISDEEMEDPOSITIVE Yes; credit → positive + No */
const entryXml = (ledger, debit, credit) => {
  const dr = debit > 0;
  const a = dr ? -debit : credit;
  return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${dr ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amt(a)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
};

/**
 * @param opts { from, to, prefix: 'Donation - ', company }
 */
export async function tallyExport({ from, to, company = '', donationPrefix = 'Donation - ', corpusPrefix = 'Corpus - ' }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) throw Object.assign(new Error('Select a valid date range'), { status: 400 });
  const [accounts, txns] = await Promise.all([
    fetchAll(COL.accounts),
    fetchAll(COL.transactions, where('date', '>=', from), where('date', '<=', to)),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const accLedger = (id) => acc.get(id)?.tallyName || acc.get(id)?.name || 'Unknown account';
  const ledgers = new Map(); // name → parent
  accounts.forEach((a) => ledgers.set(accLedger(a.id), a.type === 'cash' ? 'Cash-in-Hand' : 'Bank Accounts'));

  // donation lines (a donation can have several heads)
  const donIds = [...new Set(txns.filter((t) => t.sourceType === 'donation' && t.sourceId).map((t) => t.sourceId))];
  const dons = new Map();
  for (let i = 0; i < donIds.length; i += 1000) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await sql('SELECT id, data FROM donations WHERE id = ANY($1::text[])', [donIds.slice(i, i + 1000)]);
    rows.forEach((r) => dons.set(r.id, r.data));
  }
  const expIds = [...new Set(txns.filter((t) => t.sourceType === 'expense' && t.sourceId).map((t) => t.sourceId))];
  const exps = new Map();
  for (let i = 0; i < expIds.length; i += 1000) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await sql('SELECT id, data FROM expenses WHERE id = ANY($1::text[])', [expIds.slice(i, i + 1000)]);
    rows.forEach((r) => exps.set(r.id, r.data));
  }

  const counterOf = (t) => {
    const total = round2(t.credit || t.debit);
    if (t.sourceType === 'donation') {
      const d = dons.get(t.sourceId);
      const lines = d?.lines?.length ? d.lines : [{ categoryName: t.categoryName || 'General', amount: total }];
      const sumLines = round2(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)) || total;
      return lines.map((l) => {
        const name = `${l.isCorpus ? corpusPrefix : donationPrefix}${l.categoryName || 'General'}`;
        ledgers.set(name, l.isCorpus ? 'Capital Account' : 'Indirect Incomes');
        return { name, amount: round2((Number(l.amount) || 0) * (total / sumLines)) };
      });
    }
    if (t.sourceType === 'expense') {
      const e = exps.get(t.sourceId);
      const name = e?.categoryName || t.categoryName || 'General Expenses';
      ledgers.set(name, 'Indirect Expenses');
      return [{ name, amount: total }];
    }
    const type = t.type === 'reversal' ? (t.originalType || 'adjustment') : t.type;
    const f = FIXED[type] || FIXED.adjustment;
    ledgers.set(f.name, f.parent);
    return [{ name: f.name, amount: total }];
  };

  const vouchers = [];
  const skipped = { opening: 0, pairIn: 0 };
  const seenPairs = new Set();
  txns.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const t of txns) {
    if (t.type === 'opening') { skipped.opening += 1; continue; }
    const narration = [t.description, t.partyName, t.reference, t.utr && `UTR ${t.utr}`, t.chequeNo && `Chq ${t.chequeNo}`].filter(Boolean).join(' | ');
    // Contra: transfer / cash deposit / withdrawal (two ledger rows → one voucher)
    if (t.linkedTxnId && ['transfer', 'cash_deposit', 'cash_withdrawal'].includes(t.originalType || t.type)) {
      const key = [t.id, t.linkedTxnId].sort().join('|');
      if (seenPairs.has(key)) { skipped.pairIn += 1; continue; }
      seenPairs.add(key);
      const other = txns.find((x) => x.id === t.linkedTxnId) || await fetchOne(COL.transactions, t.linkedTxnId); // eslint-disable-line no-await-in-loop
      if (!other) continue;
      const outLeg = t.debit > 0 ? t : other;
      const inLeg = t.debit > 0 ? other : t;
      vouchers.push(`    <TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Contra" ACTION="Create"><DATE>${tdate(t.date)}</DATE><VOUCHERTYPENAME>Contra</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(t.reference || t.id.slice(0, 8))}</VOUCHERNUMBER><NARRATION>${esc(narration)}</NARRATION>${entryXml(accLedger(inLeg.accountId), inLeg.credit, 0)}${entryXml(accLedger(outLeg.accountId), 0, outLeg.debit)}</VOUCHER></TALLYMESSAGE>`);
      continue;
    }
    const isIn = (t.credit || 0) > 0;
    const counters = counterOf(t);
    // rounding: put any paisa difference on the first head
    const diff = round2((isIn ? t.credit : t.debit) - counters.reduce((s, c) => s + c.amount, 0));
    if (diff && counters[0]) counters[0].amount = round2(counters[0].amount + diff);
    const vtype = isIn ? 'Receipt' : 'Payment';
    const entries = isIn
      ? [entryXml(accLedger(t.accountId), t.credit, 0), ...counters.map((c) => entryXml(c.name, 0, c.amount))]
      : [...counters.map((c) => entryXml(c.name, c.amount, 0)), entryXml(accLedger(t.accountId), 0, t.debit)];
    vouchers.push(`    <TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${vtype}" ACTION="Create"><DATE>${tdate(t.date)}</DATE><VOUCHERTYPENAME>${vtype}</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(t.reference || t.id.slice(0, 8))}</VOUCHERNUMBER><NARRATION>${esc(narration)}</NARRATION>${entries.join('')}</VOUCHER></TALLYMESSAGE>`);
  }
  const masters = envelope(company, 'All Masters', [...ledgers.entries()].map(([n, p]) => ledgerXml(n, p)));
  return {
    masters,
    vouchers: envelope(company, 'Vouchers', vouchers),
    counts: { vouchers: vouchers.length, ledgers: ledgers.size, ...skipped },
  };
}

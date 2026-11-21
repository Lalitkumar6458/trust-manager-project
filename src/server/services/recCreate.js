import 'server-only';
import { COL } from '@/lib/constants';
import { fetchAll, fetchOne, where } from './db';
import { createDonation } from './donations';
import { createManualEntry } from './ledger';
import { manualMatch } from './reconciliation';
import { guessMode, guessUtr } from '@/lib/bankText';

export { guessMode, guessUtr };

// Bank statement line → new entry in the books, matched straight away.
//  • credit line (money came in) that is a donation → approved donation
//  • bank charges / interest → manual ledger entry

const bad = (m) => Object.assign(new Error(m), { status: 400 });

async function lineAndStatement(statementId, lineId) {
  const [st, line] = await Promise.all([fetchOne(COL.bankStatements, statementId), fetchOne(COL.statementLines, lineId)]);
  if (!st || !line || line.statementId !== statementId) throw bad('Statement line not found');
  if (line.status !== 'unmatched') throw bad('This line is already matched or ignored');
  return { st, line };
}

async function ledgerIdOf(sourceId) {
  const t = await fetchAll(COL.transactions, where('sourceId', '==', sourceId));
  return t.find((x) => !x.reversed && !x.isReversal)?.id || t[0]?.id || null;
}

/**
 * @param input { statementId, lineId, donorId | newDonor, categoryId, fundId, purpose }
 * @param ctx donation context (categories, accounts, funds, settings) with approveNow
 */
export async function donationFromLine(input, ctx) {
  const { st, line } = await lineAndStatement(input.statementId, input.lineId);
  if (!(line.credit > 0)) throw bad('Only money received (credit) can become a donation');
  if (!input.categoryId) throw bad('Select category');
  const mode = guessMode(`${line.description} ${line.reference || ''}`);
  const utr = guessUtr(line);
  const donation = {
    date: line.date,
    paymentMode: mode,
    accountId: st.accountId,
    utr: mode === 'Cheque' ? null : (utr || `BANK-${line.date}-${line.seq}`),
    chequeNo: mode === 'Cheque' ? (utr || String(line.seq)) : null,
    txnDate: line.date,
    purpose: input.purpose || '',
    remarks: `From bank statement: ${String(line.description || '').slice(0, 120)}`,
    lines: [{ categoryId: input.categoryId, amount: line.credit, fundId: input.fundId || null }],
    donorId: input.donorId || null,
    newDonor: input.donorId ? null : input.newDonor,
  };
  const id = await createDonation(donation, { ...ctx, submit: true, approveNow: true });
  const txnId = await ledgerIdOf(id);
  if (txnId) await manualMatch({ statementId: input.statementId, lineId: input.lineId, txnId, user: ctx.user });
  return { donationId: id, matched: !!txnId };
}

/** type: bank_charges | interest | other_income */
export async function ledgerFromLine({ statementId, lineId, type, description }, user) {
  const { st, line } = await lineAndStatement(statementId, lineId);
  const isIn = line.credit > 0;
  if (type === 'bank_charges' && isIn) throw bad('Bank charges must be a debit line');
  if (['interest', 'other_income'].includes(type) && !isIn) throw bad('Interest / income must be a credit line');
  if (!['bank_charges', 'interest', 'other_income'].includes(type)) throw bad('Bad entry type');
  const created = await createManualEntry({
    type, date: line.date, amount: isIn ? line.credit : line.debit, accountId: st.accountId, direction: isIn ? 'in' : 'out',
    description: description || String(line.description || '').slice(0, 120), reference: guessUtr(line) || '',
  }, user);
  const txnId = Array.isArray(created) ? created[0] : created;
  if (txnId) await manualMatch({ statementId, lineId, txnId, user });
  return { txnId };
}

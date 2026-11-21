import 'server-only';
import { COL } from '@/lib/constants';
import { round2, todayStr } from '@/lib/format';
import { fetchOne } from './db';
import { saveRecord, bad, dateOf } from './crud';

// Cash count with note-wise denomination (नोट गिनती). Compared with the system cash balance.
export const DENOMS = [500, 200, 100, 50, 20, 10];

export async function saveCashCount(input, user) {
  const account = await fetchOne(COL.accounts, input?.accountId);
  if (!account || account.type !== 'cash') throw bad('Select a cash account');
  const notes = {};
  let total = 0;
  DENOMS.forEach((d) => {
    const n = Math.max(0, Math.floor(Number(input.notes?.[d]) || 0));
    if (n > 1e6) throw bad('Too many notes');
    if (n) notes[d] = n;
    total += d * n;
  });
  const coins = round2(Math.max(0, Number(input.coins) || 0));
  total = round2(total + coins);
  const system = round2(Number(account.currentBalance) || 0);
  const date = dateOf(input.date || todayStr());
  return saveRecord(COL.cashCounts, null, {
    accountId: account.id,
    accountName: account.name,
    date,
    notes,
    coins,
    total,
    systemBalance: system,
    difference: round2(total - system),
    remarks: String(input.remarks || '').trim().slice(0, 500),
  }, user, { ref: (n) => `Cash count ${n.date} ${n.accountName}`, summary: (n) => `Counted ₹${n.total} vs system ₹${n.systemBalance} (diff ₹${n.difference})` });
}

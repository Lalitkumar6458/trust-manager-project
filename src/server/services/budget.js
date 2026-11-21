import 'server-only';
import { COL } from '@/lib/constants';
import { round2 } from '@/lib/format';
import { db, runTransaction, docRef, createdStamp, updatedStamp, writeAudit, diffObjects } from './db';

// Yearly budget per income (donation) and expense head. One document per financial year: budgets/<fyId>
export async function saveBudget(fyId, input, user) {
  if (!/^\d{4}-\d{2}$/.test(String(fyId || ''))) throw Object.assign(new Error('Select a financial year'), { status: 400 });
  const clean = (m) => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {})
    .filter(([k]) => /^[A-Za-z0-9_-]{1,64}$/.test(k))
    .map(([k, v]) => [k, round2(Math.max(0, Number(v) || 0))])
    .filter(([, v]) => v > 0));
  const data = { financialYearId: fyId, income: clean(input?.income), expense: clean(input?.expense), notes: String(input?.notes || '').slice(0, 1000) };
  return runTransaction(db, async (tx) => {
    const ref = docRef(COL.budgets, fyId);
    const s = await tx.get(ref);
    const before = s.exists() ? s.data() : null;
    if (before) tx.set(ref, { ...data, createdAt: before.createdAt || null, createdBy: before.createdBy || null, createdByName: before.createdByName || '', ...updatedStamp(user) });
    else tx.set(ref, { ...data, ...createdStamp(user) });
    writeAudit(tx, user, { collection: COL.budgets, docId: fyId, ref: `Budget ${fyId}`, action: before ? 'update' : 'create', changes: before ? diffObjects(before, data) : [] });
    return fyId;
  });
}

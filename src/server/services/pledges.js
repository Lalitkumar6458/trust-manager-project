import 'server-only';
import dayjs from 'dayjs';
import { COL } from '@/lib/constants';
import { round2, todayStr } from '@/lib/format';
import { fetchOne, docRef, runTransaction, db, updatedStamp, writeAudit } from './db';
import { saveRecord, bad, amountOf, dateOf, pickFields } from './crud';

// Sankalp (pledge): a donor promises an amount every month / quarter / year.
// Receiving a donation against it moves "next due" forward.
export const FREQUENCIES = { monthly: 1, quarterly: 3, halfYearly: 6, yearly: 12, once: 0 };

export const nextDueAfter = (due, frequency) => (FREQUENCIES[frequency] ? dayjs(due).add(FREQUENCIES[frequency], 'month').format('YYYY-MM-DD') : null);

export async function savePledge(id, input, user) {
  const d = pickFields(input, ['donorId', 'categoryId', 'amount', 'frequency', 'startDate', 'endDate', 'remindDaysBefore', 'notes', 'status', 'purpose']);
  if (!(d.frequency in FREQUENCIES)) throw bad('Select how often');
  d.amount = amountOf(d.amount);
  d.startDate = dateOf(d.startDate, 'Start date');
  d.endDate = d.endDate ? dateOf(d.endDate, 'End date') : '';
  if (d.endDate && d.endDate < d.startDate) throw bad('End date is before start date');
  d.remindDaysBefore = Math.min(30, Math.max(0, Math.floor(Number(d.remindDaysBefore ?? 3))));
  if (d.status && !['active', 'paused', 'completed', 'cancelled'].includes(d.status)) throw bad('Bad status');
  const donor = await fetchOne(COL.donors, d.donorId);
  if (!donor) throw bad('Select donor');
  const cat = d.categoryId ? await fetchOne(COL.donationCategories, d.categoryId) : null;
  Object.assign(d, {
    donorName: donor.name, donorCode: donor.donorCode || '', mobile: donor.mobile || '',
    categoryName: cat?.name || '', categoryNameHi: cat?.nameHi || '',
  });
  if (!id) Object.assign(d, { status: d.status || 'active', nextDue: d.startDate, receivedCount: 0, receivedTotal: 0, lastReceivedDate: null });
  else {
    const old = await fetchOne(COL.pledges, id);
    if (!old) throw bad('Pledge not found');
    // start date moved before anything was received → move next due too
    if (!old.receivedCount && d.startDate !== old.startDate) d.nextDue = d.startDate;
  }
  return saveRecord(COL.pledges, id || null, d, user, {
    number: id ? null : { key: 'pledge', prefix: 'SK-', field: 'pledgeNo', width: 5 },
    keywords: (n) => ({ names: [n.donorName], exact: [n.pledgeNo, n.mobile, n.donorCode] }),
    ref: (n) => n.pledgeNo,
  });
}

/** called after a donation is created with pledgeId */
export async function pledgeReceived(pledgeId, donationId, user) {
  return runTransaction(db, async (tx) => {
    const ps = await tx.get(docRef(COL.pledges, pledgeId));
    const ds = await tx.get(docRef(COL.donations, donationId));
    if (!ps.exists() || !ds.exists()) return null;
    const p = ps.data();
    const d = ds.data();
    if (d.donorId !== p.donorId) throw bad('This donation is from another donor');
    let next = nextDueAfter(p.nextDue || p.startDate, p.frequency);
    let status = p.status;
    if (!next || (p.endDate && next > p.endDate)) { next = null; status = 'completed'; }
    tx.update(docRef(COL.pledges, pledgeId), {
      nextDue: next, status, receivedCount: (p.receivedCount || 0) + 1, receivedTotal: round2((p.receivedTotal || 0) + (Number(d.amount) || 0)),
      lastReceivedDate: d.date || todayStr(), lastDonationId: donationId, lastReminderFor: null, ...updatedStamp(user),
    });
    tx.update(docRef(COL.donations, donationId), { pledgeId, pledgeNo: p.pledgeNo || '' });
    writeAudit(tx, user, { collection: COL.pledges, docId: pledgeId, ref: p.pledgeNo, action: 'received', summary: `Received ${d.receiptNo || ''} ₹${d.amount}; next due ${next || '—'}` });
    return next;
  });
}

/** skip one instalment (donor informed in advance) */
export async function skipInstalment(pledgeId, reason, user) {
  return runTransaction(db, async (tx) => {
    const ps = await tx.get(docRef(COL.pledges, pledgeId));
    if (!ps.exists()) throw bad('Pledge not found');
    const p = ps.data();
    let next = nextDueAfter(p.nextDue || p.startDate, p.frequency);
    let { status } = p;
    if (!next || (p.endDate && next > p.endDate)) { next = null; status = 'completed'; }
    tx.update(docRef(COL.pledges, pledgeId), { nextDue: next, status, lastReminderFor: null, ...updatedStamp(user) });
    writeAudit(tx, user, { collection: COL.pledges, docId: pledgeId, ref: p.pledgeNo, action: 'skip', reason: String(reason || ''), summary: `Skipped ${p.nextDue}` });
    return next;
  });
}

import 'server-only';
import { COL } from '@/lib/constants';
import { round2, todayStr, MOBILE_REGEX } from '@/lib/format';
import { fetchAll, fetchOne, where, db, runTransaction, docRef, updatedStamp, writeAudit } from './db';
import { saveRecord, bad, amountOf, dateOf, pickFields } from './crud';
import { createDonation } from './donations';

// ------------------------------------------------------------------
// Seva / pooja booking (abhishek, annadaan, aarti …).
// Each seva type is linked to a donation category: the payment becomes a normal
// donation receipt, so the books, 80G and reports stay in one place.
// ------------------------------------------------------------------

export async function saveSevaType(id, input, user) {
  const d = pickFields(input, ['name', 'nameHi', 'amount', 'categoryId', 'dailyLimit', 'time', 'description', 'active']);
  if (!d.name) throw bad('Name is required');
  d.amount = amountOf(d.amount || 0, { allowZero: true });
  d.dailyLimit = Math.max(0, Math.floor(Number(d.dailyLimit) || 0)); // 0 = no limit
  const cat = await fetchOne(COL.donationCategories, d.categoryId);
  if (!cat) throw bad('Select the donation category for the receipt');
  d.categoryName = cat.name;
  d.active = d.active !== false;
  return saveRecord(COL.sevaTypes, id || null, d, user, { ref: (n) => n.name });
}

/**
 * Book a seva. With `receipt` the donation is made at once (cash / UPI at the counter).
 * ctx = donation context (categories, accounts, settings, funds, user, approveNow)
 */
export async function bookSeva(input, ctx) {
  const user = ctx.user;
  const type = await fetchOne(COL.sevaTypes, input?.sevaTypeId);
  if (!type || type.active === false) throw bad('Select seva');
  const sevaDate = dateOf(input?.sevaDate, 'Seva date');
  const qty = Math.max(1, Math.min(100, Math.floor(Number(input?.qty) || 1)));
  const amount = round2(input?.amount !== undefined && input?.amount !== null && input?.amount !== '' ? amountOf(input.amount) : type.amount * qty);
  if (!(amount > 0)) throw bad('Amount is required');
  const dv = input?.devotee || {};
  const devotee = {
    name: String(dv.name || '').trim().slice(0, 120), mobile: String(dv.mobile || '').replace(/\D/g, '').slice(-10),
    gotra: String(dv.gotra || '').trim().slice(0, 60), names: String(dv.names || '').trim().slice(0, 500), address: String(dv.address || '').trim().slice(0, 300),
  };
  if (!devotee.name) throw bad('Devotee name is required');
  if (devotee.mobile && !MOBILE_REGEX.test(devotee.mobile)) throw bad('10 digit mobile');

  const id = await saveRecord(COL.sevaBookings, null, {
    sevaTypeId: type.id, sevaName: type.name, sevaNameHi: type.nameHi || '', sevaTime: type.time || '', sevaDate, qty, amount, devotee,
    note: String(input?.note || '').slice(0, 300), status: 'booked', donationId: null, receiptNo: null,
  }, user, {
    number: { key: 'seva', prefix: 'SV-', field: 'sevaNo', width: 5 },
    keywords: (n) => ({ names: [n.devotee.name], exact: [n.sevaNo, n.devotee.mobile] }),
    ref: (n) => n.sevaNo,
    validate: async (tx, next) => {
      if (!type.dailyLimit) return;
      await tx.lock(`seva:${type.id}:${sevaDate}`);
      const { rows } = await tx.client.query(
        "SELECT COALESCE(sum((data->>'qty')::int), 0)::int AS n FROM seva_bookings WHERE data->>'sevaTypeId' = $1 AND data->>'sevaDate' = $2 AND data->>'status' <> 'cancelled'",
        [type.id, sevaDate],
      );
      if (rows[0].n + next.qty > type.dailyLimit) throw bad(`Only ${Math.max(0, type.dailyLimit - rows[0].n)} left for this day`);
    },
  });
  if (input?.receipt) await sevaReceipt(id, input.receipt, ctx);
  return id;
}

/** make the donation receipt for a booked seva */
export async function sevaReceipt(id, pay, ctx) {
  const b = await fetchOne(COL.sevaBookings, id);
  if (!b) throw bad('Seva booking not found');
  if (b.donationId) throw bad('Receipt already made');
  if (b.status === 'cancelled') throw bad('Seva is cancelled');
  const type = await fetchOne(COL.sevaTypes, b.sevaTypeId);
  const existing = b.devotee.mobile ? (await fetchAll(COL.donors, where('mobile', '==', b.devotee.mobile))).find((d) => d.status !== 'inactive') : null;
  const cat = ctx.categories.find((c) => c.id === type?.categoryId);
  if (!cat) throw bad('The donation category of this seva is missing');
  const donationId = await createDonation({
    date: todayStr(),
    paymentMode: pay.paymentMode || 'Cash',
    accountId: pay.accountId,
    utr: pay.utr || null,
    chequeNo: pay.chequeNo || null,
    purpose: `${b.sevaNameHi || b.sevaName} – ${b.sevaDate}${b.devotee.names ? ` (${b.devotee.names})` : ''}`.slice(0, 200),
    remarks: `Seva ${b.sevaNo}`,
    lines: [{ categoryId: cat.id, amount: b.amount, fundId: cat.defaultFundId || null }],
    donorId: existing?.id || null,
    newDonor: existing ? null : { name: b.devotee.name, mobile: b.devotee.mobile, address: b.devotee.address, donorType: 'Individual' },
  }, { ...ctx, submit: true });
  const d = await fetchOne(COL.donations, donationId);
  await runTransaction(db, async (tx) => {
    await tx.get(docRef(COL.sevaBookings, id));
    tx.update(docRef(COL.sevaBookings, id), { donationId, receiptNo: d?.receiptNo || '', paidAt: new Date().toISOString(), ...updatedStamp(ctx.user) });
    writeAudit(tx, ctx.user, { collection: COL.sevaBookings, docId: id, ref: b.sevaNo, action: 'receipt', summary: `Receipt ${d?.receiptNo}` });
  });
  return donationId;
}

export async function setSevaStatus(id, status, reason, user) {
  if (!['booked', 'done', 'cancelled'].includes(status)) throw bad('Bad status');
  return runTransaction(db, async (tx) => {
    const s = await tx.get(docRef(COL.sevaBookings, id));
    if (!s.exists()) throw bad('Not found');
    const cur = s.data();
    if (status === 'cancelled' && cur.donationId) {
      const ds = await tx.get(docRef(COL.donations, cur.donationId));
      if (ds.exists() && ds.data().status !== 'void') throw bad('Receipt already made – cancel (void) the receipt first, then cancel the seva');
    }
    tx.update(docRef(COL.sevaBookings, id), { status, statusReason: String(reason || ''), ...updatedStamp(user) });
    writeAudit(tx, user, { collection: COL.sevaBookings, docId: id, ref: cur.sevaNo, action: status, reason: String(reason || '') });
    return true;
  });
}

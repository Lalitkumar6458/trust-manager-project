import 'server-only';
import dayjs from 'dayjs';
import { COL } from '@/lib/constants';
import { round2, todayStr, MOBILE_REGEX } from '@/lib/format';
import { fetchOne, db, runTransaction, docRef, updatedStamp, writeAudit } from './db';
import { saveRecord, bad, amountOf, dateOf, pickFields } from './crud';
import { createManualEntry } from './ledger';

// ------------------------------------------------------------------
// Hall / room / dharamshala booking.
// Rent and deposit received are posted to the books as "Other income" in the chosen
// cash / bank account; a refunded deposit as an outgoing adjustment.
// No two active bookings of the same hall / room can overlap (checked under a lock).
// ------------------------------------------------------------------
export const RESOURCE_TYPES = ['hall', 'room', 'dharamshala', 'ground', 'other'];
const ACTIVE = ['tentative', 'confirmed', 'checked_in'];

export async function saveResource(id, input, user) {
  const d = pickFields(input, ['name', 'type', 'capacity', 'rentPerDay', 'deposit', 'notes', 'active']);
  if (!d.name) throw bad('Name is required');
  if (d.type && !RESOURCE_TYPES.includes(d.type)) throw bad('Bad type');
  d.capacity = Math.max(0, Math.floor(Number(d.capacity) || 0));
  d.rentPerDay = amountOf(d.rentPerDay || 0, { allowZero: true, label: 'Rent' });
  d.deposit = amountOf(d.deposit || 0, { allowZero: true, label: 'Deposit' });
  d.active = d.active !== false;
  return saveRecord(COL.bookingResources, id || null, d, user, { ref: (n) => n.name });
}

const days = (from, to) => dayjs(to).diff(dayjs(from), 'day') + 1;

export async function saveBooking(id, input, user) {
  const d = pickFields(input, ['resourceId', 'fromDate', 'toDate', 'purpose', 'persons', 'rent', 'deposit', 'discount', 'notes', 'status']);
  const g = input?.guest || {};
  d.guest = {
    name: String(g.name || '').trim().slice(0, 120), mobile: String(g.mobile || '').replace(/\D/g, '').slice(-10),
    address: String(g.address || '').trim().slice(0, 300), idType: String(g.idType || '').slice(0, 40), idNumber: String(g.idNumber || '').trim().slice(0, 40),
  };
  if (!d.guest.name) throw bad('Guest name is required');
  if (d.guest.mobile && !MOBILE_REGEX.test(d.guest.mobile)) throw bad('10 digit mobile');
  d.fromDate = dateOf(d.fromDate, 'From date');
  d.toDate = dateOf(d.toDate || d.fromDate, 'To date');
  if (d.toDate < d.fromDate) throw bad('To date is before from date');
  if (days(d.fromDate, d.toDate) > 120) throw bad('Booking longer than 120 days');
  const res = await fetchOne(COL.bookingResources, d.resourceId);
  if (!res || res.active === false) throw bad('Select hall / room');
  d.resourceName = res.name;
  d.persons = Math.max(0, Math.floor(Number(d.persons) || 0));
  d.days = days(d.fromDate, d.toDate);
  d.rent = amountOf(d.rent ?? res.rentPerDay * d.days, { allowZero: true, label: 'Rent' });
  d.deposit = amountOf(d.deposit ?? res.deposit, { allowZero: true, label: 'Deposit' });
  d.discount = amountOf(d.discount || 0, { allowZero: true, label: 'Discount' });
  if (d.discount > d.rent) throw bad('Discount is more than rent');
  d.total = round2(d.rent - d.discount + d.deposit);
  if (d.status && !['tentative', 'confirmed', 'checked_in', 'completed', 'cancelled'].includes(d.status)) throw bad('Bad status');
  if (!id) Object.assign(d, { status: d.status || 'confirmed', payments: [], paid: 0, depositRefunded: 0 });
  return saveRecord(COL.bookings, id || null, d, user, {
    number: id ? null : { key: 'booking', prefix: 'BK-', field: 'bookingNo', width: 5 },
    keywords: (n) => ({ names: [n.guest?.name], exact: [n.bookingNo, n.guest?.mobile] }),
    ref: (n) => n.bookingNo,
    validate: async (tx, next) => {
      if (!ACTIVE.includes(next.status)) return;
      await tx.lock(`booking:${next.resourceId}`);
      const { rows } = await tx.client.query(
        `SELECT id, data->>'bookingNo' AS no, data->>'fromDate' AS f, data->>'toDate' AS t FROM bookings
          WHERE data->>'resourceId' = $1 AND data->>'status' = ANY($2::text[]) AND id <> $3
            AND data->>'fromDate' <= $5 AND data->>'toDate' >= $4 LIMIT 1`,
        [next.resourceId, ACTIVE, id || '', next.fromDate, next.toDate],
      );
      if (rows[0]) throw bad(`Already booked: ${rows[0].no} (${rows[0].f} – ${rows[0].t})`);
    },
  });
}

/** money received for a booking (rent / deposit) → ledger "other income" */
export async function bookingPayment(id, input, user) {
  const b = await fetchOne(COL.bookings, id);
  if (!b) throw bad('Booking not found');
  if (b.status === 'cancelled') throw bad('Booking is cancelled');
  const amount = amountOf(input?.amount);
  const kind = input?.kind === 'deposit' ? 'deposit' : 'rent';
  const date = dateOf(input?.date || todayStr());
  const account = await fetchOne(COL.accounts, input?.accountId);
  if (!account) throw bad('Select cash / bank account');
  if (round2((b.paid || 0) + amount) > round2(b.total) + 0.001) throw bad('More than the booking total');
  const created = await createManualEntry({
    type: 'other_income', date, amount, accountId: account.id, direction: 'in',
    description: `${kind === 'deposit' ? 'Security deposit' : 'Hall / room rent'} – ${b.bookingNo} ${b.resourceName} (${b.guest?.name})`,
    reference: b.bookingNo, utr: input?.utr || '',
  }, user);
  const txnId = Array.isArray(created) ? created[0] : created;
  await runTransaction(db, async (tx) => {
    const s = await tx.get(docRef(COL.bookings, id));
    const cur = s.data();
    tx.update(docRef(COL.bookings, id), {
      payments: [...(cur.payments || []), { date, amount, kind, accountId: account.id, accountName: account.name, txnId, by: user?.name || '' }],
      paid: round2((cur.paid || 0) + amount),
      ...updatedStamp(user),
    });
    writeAudit(tx, user, { collection: COL.bookings, docId: id, ref: cur.bookingNo, action: 'payment', summary: `${kind} ₹${amount} received in ${account.name}` });
  });
  return txnId;
}

/** deposit returned to the guest → outgoing adjustment */
export async function refundDeposit(id, input, user) {
  const b = await fetchOne(COL.bookings, id);
  if (!b) throw bad('Booking not found');
  const depositPaid = (b.payments || []).filter((p) => p.kind === 'deposit').reduce((s, p) => s + p.amount, 0);
  const amount = amountOf(input?.amount);
  if (round2((b.depositRefunded || 0) + amount) > round2(depositPaid) + 0.001) throw bad('More than the deposit received');
  const account = await fetchOne(COL.accounts, input?.accountId);
  if (!account) throw bad('Select cash / bank account');
  const date = dateOf(input?.date || todayStr());
  const created = await createManualEntry({
    type: 'adjustment', date, amount, accountId: account.id, direction: 'out',
    description: `Deposit refund – ${b.bookingNo} (${b.guest?.name})${input?.note ? ` – ${input.note}` : ''}`, reference: b.bookingNo,
  }, user);
  const txnId = Array.isArray(created) ? created[0] : created;
  await runTransaction(db, async (tx) => {
    const s = await tx.get(docRef(COL.bookings, id));
    const cur = s.data();
    tx.update(docRef(COL.bookings, id), {
      depositRefunded: round2((cur.depositRefunded || 0) + amount),
      refunds: [...(cur.refunds || []), { date, amount, accountId: account.id, accountName: account.name, txnId, note: input?.note || '' }],
      ...updatedStamp(user),
    });
    writeAudit(tx, user, { collection: COL.bookings, docId: id, ref: cur.bookingNo, action: 'refund', summary: `Deposit ₹${amount} refunded from ${account.name}` });
  });
  return txnId;
}

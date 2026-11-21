import 'server-only';
import { COL } from '@/lib/constants';
import { round2, todayStr } from '@/lib/format';
import { db, runTransaction, docRef, colRef, doc, createdStamp, updatedStamp, writeAudit } from './db';
import { saveRecord, bad, amountOf, dateOf, pickFields } from './crud';

// ------------------------------------------------------------------
// Store / inventory: prasad, pooja samagri, kitchen, other items.
// Stock moves: purchase in, donation in kind (वस्तु दान), issue / use out, adjustment (count correction).
// Stock never goes below zero; each move and the new stock are written in one transaction.
// Purchases are paid through Expenses as usual – a move can carry the voucher number.
// ------------------------------------------------------------------
export const ITEM_CATEGORIES = ['prasad', 'pooja', 'kitchen', 'stationery', 'maintenance', 'other'];
export const MOVE_TYPES = { purchase: 1, donation: 1, return: 1, issue: -1, wastage: -1, adjust: 0 };

export async function saveItem(id, input, user) {
  const d = pickFields(input, ['name', 'nameHi', 'unit', 'category', 'minStock', 'rate', 'location', 'active']);
  if (!d.name) throw bad('Name is required');
  if (!d.unit) throw bad('Unit is required (kg, litre, piece …)');
  d.minStock = Math.max(0, Number(d.minStock) || 0);
  d.rate = amountOf(d.rate || 0, { allowZero: true, label: 'Rate' });
  d.active = d.active !== false;
  if (!id) Object.assign(d, { stock: 0, value: 0 });
  return saveRecord(COL.inventoryItems, id || null, d, user, {
    number: id ? null : { key: 'item', prefix: 'IT-', field: 'code', width: 4 },
    keywords: (n) => ({ names: [n.name, n.nameHi], exact: [n.code] }),
    ref: (n) => n.name,
  });
}

/**
 * input { itemId, type, qty, rate, date, reference, note, party }
 * adjust: qty = the counted stock (sets the stock to this number)
 */
export async function stockMove(input, user) {
  const type = input?.type;
  if (!(type in MOVE_TYPES)) throw bad('Select in / out type');
  const qtyIn = Number(input?.qty);
  if (!Number.isFinite(qtyIn) || qtyIn < 0 || (type !== 'adjust' && qtyIn === 0)) throw bad('Quantity is not valid');
  const date = dateOf(input?.date || todayStr());
  if (date > todayStr()) throw bad('Future dates are not allowed');
  return runTransaction(db, async (tx) => {
    const ref = docRef(COL.inventoryItems, input.itemId);
    const s = await tx.get(ref);
    if (!s.exists()) throw bad('Item not found');
    const item = s.data();
    const before = Number(item.stock) || 0;
    const delta = type === 'adjust' ? round2(qtyIn - before) : round2(MOVE_TYPES[type] * qtyIn);
    const after = round2(before + delta);
    if (after < 0) throw bad(`Not enough stock – only ${before} ${item.unit} available`);
    const rate = round2(Number(input?.rate ?? item.rate) || 0);
    const moveRef = doc(colRef(COL.stockMoves));
    tx.set(moveRef, {
      itemId: s.id, itemName: item.name, unit: item.unit, type, qty: Math.abs(delta), delta, rate, value: round2(Math.abs(delta) * rate),
      stockAfter: after, date, reference: String(input?.reference || '').slice(0, 80), party: String(input?.party || '').slice(0, 120),
      note: String(input?.note || '').slice(0, 300), ...createdStamp(user),
    });
    const patch = { stock: after, value: round2(after * (rate || item.rate || 0)), lastMoveDate: date, ...updatedStamp(user) };
    if (['purchase', 'donation'].includes(type) && rate) patch.rate = rate;
    tx.update(ref, patch);
    writeAudit(tx, user, { collection: COL.stockMoves, docId: moveRef.id, ref: item.name, action: type, summary: `${type} ${Math.abs(delta)} ${item.unit} → stock ${after}` });
    return moveRef.id;
  });
}

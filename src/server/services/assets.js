import 'server-only';
import { COL } from '@/lib/constants';
import { round2 } from '@/lib/format';
import { saveRecord, bad, amountOf, dateOf, pickFields } from './crud';

// Fixed asset register (land, building, furniture, vehicle, computers, ornaments …) with
// depreciation (WDV or straight line) – the yearly schedule is worked out in src/lib/depreciation.js.
export const ASSET_CATEGORIES = ['land', 'building', 'furniture', 'vehicle', 'electronics', 'machinery', 'ornaments', 'other'];

export async function saveAsset(id, input, user) {
  const d = pickFields(input, ['name', 'category', 'purchaseDate', 'cost', 'location', 'custodian', 'depRate', 'depMethod', 'vendor', 'billNo',
    'weight', 'notes', 'status', 'disposalDate', 'disposalValue', 'disposalNote', 'fundId']);
  if (!d.name) throw bad('Name is required');
  if (!ASSET_CATEGORIES.includes(d.category)) throw bad('Select category');
  d.purchaseDate = dateOf(d.purchaseDate, 'Purchase date');
  d.cost = amountOf(d.cost, { label: 'Cost' });
  d.depRate = Math.max(0, Math.min(100, Number(d.depRate) || 0));
  d.depMethod = d.depMethod === 'slm' ? 'slm' : 'wdv';
  d.status = d.status === 'disposed' ? 'disposed' : 'active';
  if (d.status === 'disposed') {
    d.disposalDate = dateOf(d.disposalDate, 'Disposal date');
    if (d.disposalDate < d.purchaseDate) throw bad('Disposal date is before purchase date');
    d.disposalValue = round2(Math.max(0, Number(d.disposalValue) || 0));
  } else {
    d.disposalDate = null; d.disposalValue = null;
  }
  return saveRecord(COL.assets, id || null, d, user, {
    number: id ? null : { key: 'asset', prefix: 'AS-', field: 'assetNo', width: 4 },
    keywords: (n) => ({ names: [n.name, n.location, n.custodian], exact: [n.assetNo, n.billNo] }),
    ref: (n) => n.assetNo,
  });
}

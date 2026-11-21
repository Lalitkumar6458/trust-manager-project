// Depreciation schedule per financial year (April–March), Indian practice:
//  • WDV (written down value): rate % on the opening book value each year
//  • SLM (straight line): rate % of the original cost each year, never below zero
//  • asset bought in a year → half-year depreciation if used less than 180 days in that year (Income-tax rule)
//  • land and ornaments are not depreciated
import { round2 } from './format';

const fyStart = (fyId) => `${fyId.slice(0, 4)}-04-01`;
const fyEnd = (fyId) => `${Number(fyId.slice(0, 4)) + 1}-03-31`;
const fyOf = (date) => { const [y, m] = date.split('-').map(Number); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; };
const nextFy = (fyId) => { const s = Number(fyId.slice(0, 4)) + 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;

const NO_DEP = new Set(['land', 'ornaments']);

/** rows for the given financial year: { opening, addition, depreciation, disposal, closing } */
export function assetYear(asset, fyId) {
  const start = fyStart(fyId);
  const end = fyEnd(fyId);
  if (asset.purchaseDate > end) return null;
  if (asset.status === 'disposed' && asset.disposalDate && asset.disposalDate < start) return null;
  let book = asset.cost;
  let fy = fyOf(asset.purchaseDate);
  const rate = NO_DEP.has(asset.category) ? 0 : (Number(asset.depRate) || 0) / 100;
  // walk year by year up to (but not including) the requested year
  while (fy !== fyId && fy < fyId) {
    const firstYear = fy === fyOf(asset.purchaseDate);
    const half = firstYear && daysBetween(asset.purchaseDate, fyEnd(fy)) < 180;
    const dep = asset.depMethod === 'slm' ? Math.min(book, asset.cost * rate * (half ? 0.5 : 1)) : book * rate * (half ? 0.5 : 1);
    book = round2(book - dep);
    fy = nextFy(fy);
  }
  const boughtThisYear = asset.purchaseDate >= start;
  const opening = boughtThisYear ? 0 : book;
  const addition = boughtThisYear ? asset.cost : 0;
  const base = opening + addition;
  const disposedThisYear = asset.status === 'disposed' && asset.disposalDate && asset.disposalDate <= end;
  let depreciation = 0;
  if (!disposedThisYear) {
    const half = boughtThisYear && daysBetween(asset.purchaseDate, end) < 180;
    depreciation = round2(asset.depMethod === 'slm' ? Math.min(base, asset.cost * rate * (half ? 0.5 : 1)) : base * rate * (half ? 0.5 : 1));
  }
  const disposal = disposedThisYear ? round2(base) : 0;
  return { opening: round2(opening), addition: round2(addition), depreciation, disposal, closing: round2(base - depreciation - disposal), disposalValue: disposedThisYear ? asset.disposalValue || 0 : 0 };
}

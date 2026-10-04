// Firestore has no full-text search. Every searchable document stores a
// `searchKeywords` array (lower-case tokens + name prefixes) and the global
// search uses `array-contains`.

const clean = (s) => String(s ?? '').toLowerCase().trim();

function prefixes(word, min = 2, max = 15) {
  const out = [];
  for (let i = min; i <= Math.min(word.length, max); i += 1) out.push(word.slice(0, i));
  return out;
}

/**
 * @param {{ names?: string[], exact?: string[] }} input
 *  names – words that should be searchable by prefix (donor name, payee name…)
 *  exact – identifiers searched by full value (receipt no, UTR, mobile, PAN…)
 */
export function buildKeywords({ names = [], exact = [] }) {
  const set = new Set();
  names.filter(Boolean).forEach((n) => {
    const full = clean(n);
    if (!full) return;
    set.add(full);
    full.split(/[\s,./-]+/).filter(Boolean).forEach((w) => prefixes(w).forEach((p) => set.add(p)));
    prefixes(full.replace(/\s+/g, ' '), 3, 20).forEach((p) => set.add(p));
  });
  exact.filter(Boolean).forEach((e) => {
    const v = clean(e);
    if (!v) return;
    set.add(v);
    // also allow searching receipt numbers by their numeric tail, e.g. "125" for DR/2026-27/00125
    const tail = v.split('/').pop();
    if (tail && tail !== v) {
      set.add(tail);
      set.add(String(Number(tail)) === 'NaN' ? tail : String(Number(tail)));
    }
  });
  return Array.from(set).slice(0, 120);
}

export const normalizeSearch = (s) => clean(s);

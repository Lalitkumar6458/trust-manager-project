import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { C } from './theme';

// ------------------------------------------------------------------
// Column layout engine
// Widths are computed from the actual text (Hind font metrics, approximated),
// so short columns (date, PAN, amount) stay narrow and long text gets the room.
// Long unbreakable tokens (receipt no., UTR) never overflow into the next column:
// the font shrinks first, and as a last resort the token gets a clean line break
// (no hyphen – a "-" inside a receipt number would change its meaning).
// ------------------------------------------------------------------
const PAGE = { landscape: { w: 842, h: 595 }, portrait: { w: 595, h: 842 } };
const MARGIN = 24;
const PAD_X = 3.5; // cell padding left / right
const FONT_STEPS = [8.5, 8, 7.5, 7, 6.5];

function charW(cp) {
  if ((cp >= 0x0900 && cp <= 0x0903) || (cp >= 0x093a && cp <= 0x094f && cp !== 0x093d) || (cp >= 0x0951 && cp <= 0x0957) || cp === 0x0962 || cp === 0x0963) return 0; // combining marks
  if (cp >= 0x0900 && cp <= 0x097f) return 0.6; // Devanagari letters
  if (cp === 0x20) return 0.26;
  if (cp >= 0x30 && cp <= 0x39) return 0.55; // digits
  if (cp >= 0x41 && cp <= 0x5a) return 0.64; // A-Z
  if (cp >= 0x61 && cp <= 0x7a) return 0.5; // a-z
  if (cp === 0x20b9) return 0.6; // ₹
  if (',.:;\'|!il'.includes(String.fromCodePoint(cp))) return 0.27;
  if ('/-()'.includes(String.fromCodePoint(cp))) return 0.36;
  return 0.58;
}
export function textWidth(str, fs, bold = false) {
  let w = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const ch of String(str ?? '')) w += charW(ch.codePointAt(0));
  return w * fs * (bold ? 1.07 : 1);
}
const tokens = (s) => String(s ?? '').split(/\s+/).filter(Boolean);
const longestToken = (s, fs, bold) => tokens(s).reduce((m, t) => Math.max(m, textWidth(t, fs, bold)), 0);

function layoutSection(sec, pageAvail) {
  const cols = sec.columns;
  const sample = sec.rows.length > 600 ? sec.rows.filter((_, i) => i % Math.ceil(sec.rows.length / 600) === 0) : sec.rows;
  const cells = (c) => [...sample.map((r) => r[c.key]), sec.totals ? sec.totals[c.key] : ''];
  const avail = pageAvail;
  const measure = (fs) => cols.map((c) => {
    const isMoney = c.align === 'right';
    const vals = cells(c);
    const headMin = longestToken(c.title, fs, true);
    let min;
    let pref;
    if (isMoney) {
      // amounts never wrap
      min = Math.max(headMin, ...vals.map((v) => textWidth(v, fs, true)));
      pref = Math.max(min, textWidth(c.title, fs, true));
    } else {
      min = Math.max(headMin, ...vals.map((v) => longestToken(v, fs)));
      const full = Math.max(textWidth(c.title, fs, true), ...vals.map((v) => textWidth(v, fs)));
      pref = Math.max(min, Math.min(full, avail * 0.42));
    }
    // 6 % safety margin on the estimated glyph widths
    return { min: min * 1.06 + PAD_X * 2 + 1, pref: pref * 1.06 + PAD_X * 2 + 1, money: isMoney, hint: c.width || 1 };
  });

  let fs = FONT_STEPS[0];
  let m = measure(fs);
  // eslint-disable-next-line no-restricted-syntax
  for (const step of FONT_STEPS) {
    fs = step;
    m = measure(fs);
    if (m.reduce((s, x) => s + x.min, 0) <= avail) break;
  }
  // still too wide at the smallest font → cap the widest minimums (their tokens get split later)
  let sumMin = m.reduce((s, x) => s + x.min, 0);
  if (sumMin > avail) {
    const cap = avail / cols.length;
    m = m.map((x) => (x.money ? x : { ...x, min: Math.min(x.min, Math.max(cap, 40)), pref: Math.min(x.pref, Math.max(cap, 40)) }));
    sumMin = m.reduce((s, x) => s + x.min, 0);
    if (sumMin > avail) { const k = avail / sumMin; m = m.map((x) => ({ ...x, min: x.min * k, pref: x.pref * k })); sumMin = avail; }
  }
  const sumPref = m.reduce((s, x) => s + x.pref, 0);
  // small summary tables (2–3 columns) don't stretch across a landscape page
  const tableW = cols.length <= 3 ? Math.min(pageAvail, Math.max(sumPref * 1.5, 380)) : pageAvail;
  let widths;
  if (sumPref <= tableW) {
    // everything fits on one line: give the spare room to text columns (by their width hint)
    const spare = tableW - sumPref;
    const textHints = m.reduce((s, x) => s + (x.money ? 0 : x.hint), 0) || 1;
    widths = m.map((x) => x.pref + (x.money ? 0 : (spare * x.hint) / textHints));
  } else {
    const flex = m.reduce((s, x) => s + (x.pref - x.min), 0) || 1;
    widths = m.map((x) => x.min + ((tableW - sumMin) * (x.pref - x.min)) / flex);
  }
  return { fs, widths };
}

/** Insert line breaks into tokens that are wider than the column (no hyphen) */
function fitText(v, width, fs, bold) {
  const s = String(v ?? '');
  const room = width - PAD_X * 2 - 1;
  if (!s || textWidth(s, fs, bold) <= room || longestToken(s, fs, bold) <= room) return s;
  return s.split(/(\s+)/).map((tok) => {
    if (/^\s+$/.test(tok) || textWidth(tok, fs, bold) <= room) return tok;
    const parts = [];
    let cur = '';
    // eslint-disable-next-line no-restricted-syntax
    for (const ch of tok) {
      if (cur && textWidth(cur + ch, fs, bold) > room) { parts.push(cur); cur = ''; }
      cur += ch;
    }
    if (cur) parts.push(cur);
    return parts.join('\n');
  }).join('');
}

const s = StyleSheet.create({
  page: { fontFamily: 'Hind', color: C.ink, paddingTop: MARGIN, paddingBottom: MARGIN + 14, paddingHorizontal: MARGIN },
  head: { borderBottomWidth: 1.4, borderBottomColor: C.maroon, paddingBottom: 5, marginBottom: 2, minHeight: 36 },
  trust: { fontSize: 14, fontWeight: 700, color: C.maroon, textAlign: 'center' },
  sub: { fontSize: 8, textAlign: 'center', color: C.muted },
  rule2: { borderBottomWidth: 0.5, borderBottomColor: C.maroon, marginBottom: 6 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 },
  title: { fontSize: 12.5, fontWeight: 700, color: C.ink },
  filters: { fontSize: 8, color: C.muted, textAlign: 'right' },
  section: { fontSize: 9.5, fontWeight: 700, color: C.maroon, marginTop: 8, marginBottom: 3, paddingLeft: 5, borderLeftWidth: 2.5, borderLeftColor: C.saffron },
  table: { borderTopWidth: 0.6, borderBottomWidth: 0.6, borderColor: '#b9a58a' },
  sides: { borderLeftWidth: 0.6, borderRightWidth: 0.6, borderColor: '#b9a58a' },
  tr: { flexDirection: 'row', borderBottomWidth: 0.4, borderBottomColor: '#e2d6c2' },
  zebra: { backgroundColor: '#fbf7ef' },
  th: { flexDirection: 'row', backgroundColor: C.maroon },
  thCell: { color: '#ffffff', fontWeight: 600, paddingHorizontal: PAD_X, paddingVertical: 3.5, borderRightWidth: 0.4, borderRightColor: '#a3463b' },
  td: { paddingHorizontal: PAD_X, paddingVertical: 2.4, borderRightWidth: 0.4, borderRightColor: '#e2d6c2' },
  total: { flexDirection: 'row', backgroundColor: '#f2e6d0', borderTopWidth: 1, borderTopColor: C.maroon },
  totalCell: { fontWeight: 700 },
  empty: { fontSize: 9, color: C.muted, padding: 8, textAlign: 'center' },
  footer: { position: 'absolute', bottom: 14, left: MARGIN, right: MARGIN, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: C.muted, borderTopWidth: 0.5, borderTopColor: '#d8c8ae', paddingTop: 3 },
});

/**
 * Generic tabular report.
 * sections: [{ title?, columns:[{title, key, width?, align?}], rows:[{}], totals?:{} }]
 */
export default function ReportPdf({ settings: t, title, filtersText, sections, generatedBy, landscape = true, labels = {}, logo = null }) {
  // wide tables are always printed landscape
  const maxCols = Math.max(0, ...sections.map((sec) => sec.columns.length));
  const orient = landscape || maxCols > 6 ? 'landscape' : 'portrait';
  const avail = PAGE[orient].w - MARGIN * 2;
  const regLine = [t?.registrationNo ? `Reg: ${t.registrationNo}` : '', t?.pan ? `PAN: ${t.pan}` : '', t?.section80G ? `80G: ${t.section80G}` : ''].filter(Boolean).join('   |   ');
  const now = new Date();
  const stamp = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return (
    <Document title={title} author={t?.nameEn || t?.name} creator="Trust Manager">
      <Page size="A4" orientation={orient} style={s.page} wrap>
        <View style={s.head} fixed>
          {logo ? <Image src={logo} style={{ position: 'absolute', left: 0, top: 0, height: 34, width: 34, objectFit: 'contain' }} /> : null}
          <Text style={s.trust}>{t?.name}</Text>
          {t?.address ? <Text style={s.sub}>{t.address}</Text> : null}
          {regLine ? <Text style={s.sub}>{regLine}</Text> : null}
        </View>
        <View style={s.rule2} fixed />
        <View style={s.titleRow}>
          <Text style={s.title}>{title}</Text>
          {filtersText ? <Text style={s.filters}>{filtersText}</Text> : null}
        </View>

        {sections.map((sec, si) => {
          const { fs, widths } = layoutSection(sec, avail);
          const cellStyle = (i, c) => ({ width: widths[i], textAlign: c.align || 'left', fontSize: fs });
          const last = sec.columns.length - 1;
          return (
            // eslint-disable-next-line react/no-array-index-key
            <View key={si} style={{ marginBottom: 8 }}>
              {sec.title ? <Text style={s.section} minPresenceAhead={40}>{sec.title}</Text> : null}
              <View style={[s.table, { width: widths.reduce((a, b) => a + b, 0) + 1.2 }]}>
                <View style={[s.th, s.sides]} fixed>
                  {sec.columns.map((c, i) => (
                    <Text key={c.key} style={[s.thCell, cellStyle(i, c), i === last ? { borderRightWidth: 0 } : null]}>{fitText(c.title, widths[i], fs, true)}</Text>
                  ))}
                </View>
                {sec.rows.length ? sec.rows.map((r, ri) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <View key={ri} style={[s.tr, s.sides, ri % 2 ? s.zebra : null]} wrap={false}>
                    {sec.columns.map((c, i) => (
                      <Text key={c.key} style={[s.td, cellStyle(i, c), i === last ? { borderRightWidth: 0 } : null]}>{fitText(r[c.key], widths[i], fs, false)}</Text>
                    ))}
                  </View>
                )) : <Text style={s.empty}>{labels.empty || 'No records'}</Text>}
                {sec.totals ? (
                  <View style={[s.total, s.sides]} wrap={false}>
                    {sec.columns.map((c, i) => (
                      <Text key={c.key} style={[s.td, s.totalCell, cellStyle(i, c), i === last ? { borderRightWidth: 0 } : null]}>{fitText(sec.totals[c.key], widths[i], fs, true)}</Text>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}

        <View style={s.footer} fixed>
          <Text>{labels.generated || 'Generated'} {stamp}{generatedBy ? ` – ${generatedBy}` : ''}</Text>
          <Text>{t?.name}</Text>
          <Text render={({ pageNumber, totalPages }) => `${labels.page || 'Page'} ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

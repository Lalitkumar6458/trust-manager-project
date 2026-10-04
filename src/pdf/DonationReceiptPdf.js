import { Document, Page, View, Text, Image, StyleSheet, Svg, Path } from '@react-pdf/renderer';
import { C } from './theme';
import { amountInWordsHi, amountInWordsEn } from '../lib/amountInWords';
import { rupeePaise, fmtDate } from '../lib/format';

const s = StyleSheet.create({
  page: { backgroundColor: C.paper, fontFamily: 'Hind', fontSize: 10, color: C.ink, padding: 10 },
  outer: { borderWidth: 2.5, borderColor: C.maroon, borderRadius: 4, padding: 3, flexGrow: 1 },
  inner: { borderWidth: 0.8, borderColor: C.gold, borderRadius: 3, paddingHorizontal: 12, paddingVertical: 5, flexGrow: 1 },
  invocation: { textAlign: 'center', color: C.maroon, fontSize: 8.5, lineHeight: 1.25 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  deity: { width: 40, height: 46, objectFit: 'contain' },
  deityBox: { width: 40, height: 46 },
  trustName: { flex: 1, textAlign: 'center', color: C.red, fontSize: 20, fontWeight: 700, lineHeight: 1.1 },
  centerSmall: { textAlign: 'center', fontSize: 8.2, fontWeight: 600, lineHeight: 1.25 },
  rule: { borderBottomWidth: 1.6, borderBottomColor: C.maroon, marginTop: 4 },
  rule2: { borderBottomWidth: 0.6, borderBottomColor: C.maroon, marginTop: 1.5, marginBottom: 4 },
  pill: { alignSelf: 'center', backgroundColor: C.maroon, color: '#fff', fontSize: 9.5, fontWeight: 600, paddingHorizontal: 12, paddingTop: 2.5, paddingBottom: 1, borderRadius: 8, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 3.5 },
  half: { flexDirection: 'row', alignItems: 'flex-end' },
  label: { fontSize: 11, fontWeight: 700, marginRight: 4 },
  fill: { flex: 1, borderBottomWidth: 0.7, borderBottomColor: C.ink, borderBottomStyle: 'dotted', fontSize: 10.5, paddingHorizontal: 4, minHeight: 14 },
  intro: { fontSize: 10, fontWeight: 600, marginTop: 3, marginBottom: 3 },
  th: { flexDirection: 'row', backgroundColor: C.maroon, color: '#fff', fontWeight: 600, fontSize: 10 },
  thCell: { paddingVertical: 3, paddingHorizontal: 4, borderRightWidth: 1, borderRightColor: '#fff' },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 15 },
  box: { width: 9, height: 9, borderWidth: 0.9, borderColor: C.ink, marginRight: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  tick: { fontSize: 7.5, fontWeight: 700, color: C.red, marginTop: 1 },
  amtBox: { borderBottomWidth: 0.7, borderBottomColor: C.ink, textAlign: 'right', paddingHorizontal: 3, fontSize: 10.5 },
  totalRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3, borderTopWidth: 1, borderTopColor: C.ink, paddingTop: 2 },
  small: { fontSize: 8, color: C.muted, lineHeight: 1.3 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 'auto', paddingTop: 4 },
  void: { position: 'absolute', top: 230, left: 40, fontSize: 70, color: '#d4380d', opacity: 0.22, transform: 'rotate(-30deg)', fontWeight: 700 },
});

const COLW = { sn: '11%', item: '51%', rs: '24%', ps: '14%' };

// rows whose value wraps to 2 lines: keep the label at the top, aligned with the first line
const wrapRow = (txt) => (String(txt || '').length > 55 ? { alignItems: 'flex-start' } : null);

function modeLine(d) {
  const ref = [d.utr && `UTR: ${d.utr}`, d.chequeNo && `चैक नं.: ${d.chequeNo}${d.chequeDate ? ` (${fmtDate(d.chequeDate)})` : ''}`, d.bankName && d.bankName]
    .filter(Boolean).join(', ');
  const label = d.paymentMode === 'Cash' ? 'रोकड़ा (Cash)' : d.paymentMode === 'Cheque' ? 'चैक (Cheque)' : `Online (${d.paymentMode})`;
  return ref ? `${label} – ${ref}` : label;
}

/**
 * Donation receipt in the trust's Hindi format.
 * @param {{ donation, settings, categories, images:{left,right,signature,stamp}, copyLabel }} props
 */
export default function DonationReceiptPdf({ donation: d, settings: t, categories = [], images = {}, copyLabel, duplicate = false }) {
  const cashOver80G = String(d.paymentMode || '').toLowerCase() === 'cash' && Number(d.amount) > 2000;
  // receipt rows: categories flagged "show on receipt" + any donated category not in that list
  const donatedIds = new Set(d.lines.map((l) => l.categoryId));
  const listed = categories.filter((c) => c.showOnReceipt && c.active !== false);
  const extra = d.lines.filter((l) => !listed.some((c) => c.id === l.categoryId))
    .map((l) => ({ id: l.categoryId, name: l.categoryName, nameHi: l.categoryNameHi }));
  const rows = [...listed, ...extra];
  const amountFor = (id) => d.lines.filter((l) => l.categoryId === id).reduce((a, l) => a + l.amount, 0);
  const total = rupeePaise(d.amount);
  const regLine = [
    t.registrationNo && `पंजीकरण संख्या: ${t.registrationNo}${t.registrationDate ? ` (${t.registrationDate})` : ''}`,
    t.pan && `पैन संख्या : ${t.pan}`,
  ].filter(Boolean).join(' / ');

  return (
    <Document title={`Receipt ${d.receiptNo || ''}`} author={t.nameEn || t.name}>
      <Page size="A5" style={s.page}>
        <View style={s.outer}>
          <View style={s.inner}>
            {(t.invocationLines || []).filter(Boolean).map((line) => <Text key={line} style={s.invocation}>{line}</Text>)}
            <View style={s.headRow}>
              <View style={s.deityBox}>{images.left ? <Image src={images.left} style={s.deity} /> : null}</View>
              <Text style={s.trustName}>{t.name}</Text>
              <View style={s.deityBox}>{images.right ? <Image src={images.right} style={s.deity} /> : null}</View>
            </View>
            <Text style={s.centerSmall}>{t.address}</Text>
            {t.phones ? <Text style={s.centerSmall}>फोन : {t.phones}</Text> : null}
            {regLine ? <Text style={s.centerSmall}>{regLine}</Text> : null}
            {t.section80G ? <Text style={[s.centerSmall, { fontWeight: 400 }]}>80G: {t.section80G}{t.section12A ? `   12A: ${t.section12A}` : ''}</Text> : null}
            <View style={s.rule} />
            <View style={s.rule2} />

            <Text style={s.pill}>{t.receiptTitle || 'दान रसीद'}{copyLabel ? ` – ${copyLabel}` : ''}</Text>
            {duplicate ? <Text style={[s.centerSmall, { color: C.red, fontWeight: 700, marginTop: -2 }]}>प्रतिलिपि / DUPLICATE</Text> : null}

            <View style={s.row}>
              <View style={[s.half, { width: '56%' }]}>
                <Text style={s.label}>नंबर:</Text>
                <Text style={s.fill}>{d.receiptNo || 'DRAFT'}</Text>
              </View>
              <View style={{ width: '8%' }} />
              <View style={[s.half, { width: '36%' }]}>
                <Text style={s.label}>तारीख:</Text>
                <Text style={[s.fill, { textAlign: 'center' }]}>{fmtDate(d.date)}</Text>
              </View>
            </View>
            <View style={[s.row, wrapRow(`${d.donor?.name || ''} ${d.donor?.organizationName || ''}`)]}>
              <Text style={s.label}>श्री</Text>
              <Text style={s.fill}>{d.donor?.name}{d.donor?.organizationName ? ` (${d.donor.organizationName})` : ''}</Text>
            </View>
            <View style={[s.row, wrapRow(d.donor?.address)]}>
              <Text style={s.label}>पता</Text>
              <Text style={s.fill}>{d.donor?.address || ' '}</Text>
            </View>
            {(d.donor?.mobile || d.donor?.pan) ? (
              <View style={s.row}>
                <Text style={[s.label, { fontSize: 9.5 }]}>मोबाइल:</Text>
                <Text style={[s.fill, { fontSize: 10 }]}>{d.donor?.mobile || '-'}</Text>
                <Text style={[s.label, { fontSize: 9.5, marginLeft: 8 }]}>पैन:</Text>
                <Text style={[s.fill, { fontSize: 10 }]}>{d.donor?.pan || '-'}</Text>
              </View>
            ) : null}

            <Text style={s.intro}>{t.receiptIntro || 'आप श्री तरफ से संस्थान को नीचे विगत से दान मिला है:-'}</Text>

            <View style={s.th}>
              <Text style={[s.thCell, { width: COLW.sn, textAlign: 'center' }]}>क्र.सं.</Text>
              <Text style={[s.thCell, { width: COLW.item, textAlign: 'center' }]}>विगत</Text>
              <Text style={[s.thCell, { width: COLW.rs, textAlign: 'center' }]}>रु.</Text>
              <Text style={[s.thCell, { width: COLW.ps, textAlign: 'center', borderRightWidth: 0 }]}>पैसा</Text>
            </View>
            {rows.map((c, i) => {
              const amt = amountFor(c.id);
              const rp = amt ? rupeePaise(amt) : null;
              return (
                <View style={s.tr} key={c.id || i} wrap={false}>
                  <View style={{ width: COLW.sn, flexDirection: 'row', alignItems: 'center', paddingLeft: 2 }}>
                    <View style={s.box}>{donatedIds.has(c.id) ? <Svg width={8} height={8} viewBox="0 0 10 10"><Path d="M1 5.5 L4 8.5 L9 1.5" stroke={C.red} strokeWidth={1.8} fill="none" /></Svg> : null}</View>
                  </View>
                  <Text style={{ width: COLW.item, fontSize: 10.5, fontWeight: donatedIds.has(c.id) ? 600 : 400 }}>{i + 1}. {c.nameHi || c.name}</Text>
                  <View style={{ width: COLW.rs, paddingHorizontal: 3 }}><Text style={s.amtBox}>{rp ? rp.rupees : ' '}</Text></View>
                  <View style={{ width: COLW.ps, paddingHorizontal: 3 }}><Text style={[s.amtBox, { textAlign: 'center' }]}>{rp ? rp.paise : ' '}</Text></View>
                </View>
              );
            })}
            <View style={s.totalRow}>
              <Text style={{ width: COLW.sn }} />
              <Text style={{ width: COLW.item, textAlign: 'right', paddingRight: 8, fontSize: 12, fontWeight: 700 }}>कुल</Text>
              <View style={{ width: COLW.rs, paddingHorizontal: 3 }}><Text style={[s.amtBox, { fontWeight: 700, fontSize: 11.5 }]}>₹ {total.rupees}</Text></View>
              <View style={{ width: COLW.ps, paddingHorizontal: 3 }}><Text style={[s.amtBox, { fontWeight: 700, textAlign: 'center' }]}>{total.paise}</Text></View>
            </View>

            <View style={[s.row, { marginTop: 5 }]}>
              <Text style={s.label}>शब्दों में</Text>
              <Text style={[s.fill, { fontSize: 10.5, fontWeight: 600 }]}>{amountInWordsHi(d.amount)}</Text>
            </View>
            <Text style={[s.small, { marginTop: -1, marginBottom: 3 }]}>({amountInWordsEn(d.amount)})</Text>
            <View style={[s.row, wrapRow(modeLine(d).length > 40 ? 'x'.repeat(60) : '')]}>
              <Text style={[s.label, { fontSize: 10 }]}>रोकड़ा / चैक / Online UTR:</Text>
              <Text style={[s.fill, { fontSize: 9.5 }]}>{modeLine(d)}</Text>
            </View>
            {d.purpose ? (
              <View style={[s.row, wrapRow(d.purpose)]}>
                <Text style={[s.label, { fontSize: 10 }]}>उद्देश्य:</Text>
                <Text style={[s.fill, { fontSize: 9.5 }]}>{d.purpose}</Text>
              </View>
            ) : null}

            <View style={s.footer}>
              <View style={{ width: '50%' }}>
                <Text style={s.small}>वित्तीय वर्ष (FY): {d.financialYearId}</Text>
                {d.isCorpus ? <Text style={s.small}>Corpus donation (स्थायी कोष दान)</Text> : null}
                {cashOver80G && t.section80G ? <Text style={[s.small, { color: C.red }]}>नकद ₹2,000 से अधिक दान पर 80G कटौती लागू नहीं (Cash above ₹2,000 not eligible u/s 80G)</Text> : null}
                {t.receiptNote ? <Text style={s.small}>{t.receiptNote}</Text> : null}
                <Text style={[s.small, { fontSize: 7 }]}>Computer generated receipt</Text>
              </View>
              <View style={{ alignItems: 'center', width: '48%' }}>
                <View style={{ flexDirection: 'row', height: 30, alignItems: 'flex-end' }}>
                  {images.stamp ? <Image src={images.stamp} style={{ height: 30, width: 30, objectFit: 'contain', marginRight: 4 }} /> : null}
                  {images.signature ? <Image src={images.signature} style={{ height: 30, width: 80, objectFit: 'contain' }} /> : null}
                </View>
                <Text style={{ fontSize: 11, fontWeight: 600, color: C.maroon }}>आभार [मुहर/हस्ताक्षर]</Text>
                <Text style={{ fontSize: 11, fontWeight: 700, color: C.maroon }}>{t.name}</Text>
                {t.authorizedSignatory ? <Text style={s.small}>{t.authorizedSignatory}</Text> : null}
              </View>
            </View>
          </View>
        </View>
        {d.status === 'void' ? <Text style={s.void} fixed>{d.bounced ? 'अनादरित / BOUNCED' : 'रद्द / VOID'}</Text> : null}
        {d.status !== 'void' && d.status !== 'approved' && t.receiptBeforeApproval !== 'allow' ? <Text style={[s.void, { fontSize: 46, color: '#8c8c8c', top: 250 }]} fixed>PROVISIONAL</Text> : null}
      </Page>
    </Document>
  );
}

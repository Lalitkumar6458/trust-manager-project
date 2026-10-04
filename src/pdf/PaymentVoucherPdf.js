import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { C } from './theme';
import { amountInWordsHi, amountInWordsEn } from '../lib/amountInWords';
import { num, fmtDate } from '../lib/format';

const s = StyleSheet.create({
  page: { backgroundColor: C.paper, fontFamily: 'Hind', fontSize: 10, color: C.ink, paddingVertical: 18, paddingHorizontal: 22 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  deity: { width: 44, height: 50, objectFit: 'contain' },
  deityBox: { width: 44, height: 50, borderWidth: 0 },
  trustName: { flex: 1, textAlign: 'center', fontSize: 21, fontWeight: 700, color: C.ink },
  line: { fontSize: 9.5, textAlign: 'center', lineHeight: 1.3 },
  title: { fontSize: 17, fontWeight: 700, textAlign: 'center', marginTop: 6, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 6 },
  label: { fontSize: 10.5, fontWeight: 600, marginRight: 4 },
  fill: { flex: 1, borderBottomWidth: 0.7, borderBottomColor: C.ink, fontSize: 10.5, paddingHorizontal: 4, minHeight: 14 },
  table: { borderWidth: 1, borderColor: C.ink, marginTop: 4 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.8, borderBottomColor: C.ink, minHeight: 19 },
  cell: { paddingHorizontal: 5, paddingVertical: 3, borderRightWidth: 0.8, borderRightColor: C.ink, fontSize: 10.5 },
  th: { fontWeight: 600, textAlign: 'center', fontSize: 10, lineHeight: 1.2 },
  small: { fontSize: 8.5, color: C.muted, lineHeight: 1.35 },
  sign: { borderTopWidth: 0.8, borderTopColor: C.ink, paddingTop: 2, textAlign: 'center', fontSize: 9.5, width: 130 },
  void: { position: 'absolute', top: 260, left: 60, fontSize: 70, color: '#d4380d', opacity: 0.22, transform: 'rotate(-30deg)', fontWeight: 700 },
});

const W = { sn: '13%', part: '62%', amt: '25%' };

/**
 * Payment voucher (भुगतान वाउचर / रसीद) – matches the trust's printed voucher.
 */
export default function PaymentVoucherPdf({ expense: e, settings: t, images = {} }) {
  // adaptive layout: long text → compact A5 (no blank rows, smaller type); very long → A4. Never spills to page 2.
  const len = (x) => String(x || '').length;
  const heavy = e.lines.reduce((n, l) => n + Math.ceil(Math.max(1, len(l.particulars)) / 48), 0)
    + Math.ceil(len(e.purpose) / 90) + Math.ceil((len(e.payee?.name) + len(e.payee?.address)) / 80);
  const size = heavy > 11 ? 'A4' : 'A5';
  const compact = size === 'A5' && heavy > 4;
  const minRows = Math.max(compact ? 1 : 4, e.lines.length);
  const rows = Array.from({ length: minRows }, (_, i) => e.lines[i] || null);
  const k = compact ? { tr: { minHeight: 15 }, cell: { fontSize: 9.5, paddingVertical: 2 }, title: { fontSize: 15, marginTop: 3, marginBottom: 5 }, trust: { fontSize: 18 } } : {};
  const wrapRow = (txt) => (len(txt) > 55 ? { alignItems: 'flex-start' } : null);
  const ref = [e.utr && `UTR: ${e.utr}`, e.chequeNo && `Cheque: ${e.chequeNo}`, e.cashRef && `Ref: ${e.cashRef}`].filter(Boolean).join(', ');
  const reg = [t.registrationNo && `पंजीकरण संख्या: ${t.registrationNo}`, t.registrationDate && `दिनांक: ${t.registrationDate}`].filter(Boolean).join('   ');

  return (
    <Document title={`Voucher ${e.voucherNo || ''}`} author={t.nameEn || t.name}>
      <Page size={size} style={s.page}>
        <View style={s.headRow}>
          <View style={s.deityBox}>{images.left ? <Image src={images.left} style={s.deity} /> : null}</View>
          <Text style={[s.trustName, k.trust]}>{t.name}</Text>
          <View style={s.deityBox}>{images.right ? <Image src={images.right} style={s.deity} /> : null}</View>
        </View>
        {reg ? <Text style={s.line}>{reg}</Text> : null}
        <Text style={s.line}>पता: {t.address}</Text>
        {t.pan ? <Text style={s.line}>PAN: {t.pan}{t.phones ? `   फोन: ${t.phones}` : ''}</Text> : null}

        <Text style={[s.title, k.title]}>{t.voucherTitle || 'भुगतान वाउचर / रसीद'}</Text>

        <View style={s.row}>
          <View style={{ width: '58%', flexDirection: 'row', alignItems: 'flex-end' }}>
            <Text style={s.label}>वाउचर नं.:</Text>
            <Text style={s.fill}>{e.voucherNo || 'DRAFT'}</Text>
          </View>
          <View style={{ width: '6%' }} />
          <View style={{ width: '36%', flexDirection: 'row', alignItems: 'flex-end' }}>
            <Text style={s.label}>दिनांक:</Text>
            <Text style={[s.fill, { textAlign: 'center' }]}>{fmtDate(e.date)}</Text>
          </View>
        </View>
        <View style={[s.row, wrapRow(e.payee?.name)]}>
          <Text style={s.label}>श्री / नाम:</Text>
          <Text style={s.fill}>{e.payee?.name}{e.payee?.mobile ? `  (${e.payee.mobile})` : ''}</Text>
        </View>
        {(e.payee?.address || e.payee?.pan) ? (
          <View style={[s.row, wrapRow(`${e.payee?.address || ''} ${e.payee?.pan || ''}`)]}>
            <Text style={[s.label, { fontSize: 9.5 }]}>पता / PAN:</Text>
            <Text style={[s.fill, { fontSize: 9.5 }]}>{[e.payee?.address, e.payee?.pan, e.payee?.gstin && `GST: ${e.payee.gstin}`].filter(Boolean).join(' | ')}</Text>
          </View>
        ) : null}

        <View style={s.table}>
          <View style={[s.tr, { backgroundColor: C.paperDark }]}>
            <Text style={[s.cell, s.th, { width: W.sn }]}>क्र. सं.{'\n'}(S.No.)</Text>
            <Text style={[s.cell, s.th, { width: W.part }]}>विवरण / विगत{'\n'}Particulars</Text>
            <Text style={[s.cell, s.th, { width: W.amt, borderRightWidth: 0 }]}>रकम / राशि{'\n'}Amount ₹</Text>
          </View>
          {rows.map((l, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <View style={[s.tr, k.tr]} key={i} wrap={false}>
              <Text style={[s.cell, k.cell, { width: W.sn, textAlign: 'center' }]}>{i + 1}.</Text>
              <Text style={[s.cell, k.cell, { width: W.part }]}>{l?.particulars || ''}</Text>
              <Text style={[s.cell, k.cell, { width: W.amt, textAlign: 'right', borderRightWidth: 0 }]}>{l ? num(l.amount) : ''}</Text>
            </View>
          ))}
          <View style={[s.tr, { borderBottomWidth: 0 }]}>
            <Text style={[s.cell, { width: '75%', textAlign: 'right', fontWeight: 700, fontSize: 12 }]}>कुल</Text>
            <Text style={[s.cell, { width: W.amt, textAlign: 'right', fontWeight: 700, borderRightWidth: 0, fontSize: 11 }]}>₹ {num(e.amount)}</Text>
          </View>
        </View>

        <View style={[s.row, { marginTop: 10 }]}>
          <Text style={s.label}>कुल राशि (शब्दांकन में / In Words):</Text>
        </View>
        <Text style={{ borderBottomWidth: 0.7, borderBottomColor: C.ink, fontSize: 10.5, paddingHorizontal: 4, fontWeight: 600, marginBottom: 2 }}>{amountInWordsHi(e.amount)}</Text>
        <Text style={[s.small, { marginBottom: 6 }]}>({amountInWordsEn(e.amount)})</Text>

        <Text style={s.small}>मद / Category: {e.categoryNameHi ? `${e.categoryNameHi} (${e.categoryName})` : e.categoryName}{e.purpose ? `   |   उद्देश्य: ${e.purpose}` : ''}</Text>
        <Text style={s.small}>भुगतान माध्यम / Mode: {e.paymentMode || '-'}{e.accountName ? ` – ${e.accountName}` : ''}{ref ? `   |   ${ref}` : ''}</Text>
        {e.billNo ? <Text style={s.small}>Bill / Invoice: {e.billNo}{e.billDate ? ` dt. ${fmtDate(e.billDate)}` : ''}</Text> : null}
        {e.projectName ? <Text style={s.small}>Fund / Project: {e.projectName}</Text> : null}
        <Text style={s.small}>FY: {e.financialYearId}{e.approvedByName ? `   |   Approved by: ${e.approvedByName}` : ''}</Text>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 'auto', paddingTop: compact ? 4 : 10 }} wrap={false}>
          <View style={{ alignItems: 'center' }}>
            <View style={{ height: 30 }} />
            <Text style={s.sign}>प्राप्तकर्ता हस्ताक्षर{'\n'}(Receiver)</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <View style={{ height: 30, flexDirection: 'row', alignItems: 'flex-end' }}>
              {images.stamp ? <Image src={images.stamp} style={{ height: 30, width: 30, objectFit: 'contain' }} /> : null}
              {images.signature ? <Image src={images.signature} style={{ height: 26, width: 70, objectFit: 'contain' }} /> : null}
            </View>
            <Text style={s.sign}>दस्तखत / हस्ताक्षर{'\n'}(Signature)</Text>
          </View>
        </View>
        {e.status === 'void' ? <Text style={s.void} fixed>रद्द / VOID</Text> : null}
      </Page>
    </Document>
  );
}

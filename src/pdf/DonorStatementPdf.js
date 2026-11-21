import { Document, Page, View, Text, Image } from '@react-pdf/renderer';
import { amountInWordsEn, amountInWordsHi } from '../lib/amountInWords';
import { fmtDate, money, fyRange } from '../lib/format';
import { receiptDesignOf } from '../lib/receiptDesign';

// Donor's yearly donation statement (useful for 80G claim / income-tax file).
// Only approved donations are listed. Colours follow Settings → Receipt design.

export default function DonorStatementPdf({ donor = {}, donations = [], settings: t = {}, fyId, images = {}, generatedBy }) {
  const design = receiptDesignOf(t);
  const col = design.template === 'simple' ? { primary: '#111111', accent: '#555555', text: '#111111' } : design.colors;
  const rows = donations.filter((d) => d.status === 'approved').sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.receiptNo).localeCompare(String(b.receiptNo)));
  const total = rows.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const cash = rows.filter((d) => String(d.paymentMode).toLowerCase() === 'cash').reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const corpus = rows.filter((d) => d.isCorpus).reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const range = fyId ? fyRange(fyId) : null;
  const cell = { paddingVertical: 3, paddingHorizontal: 4, fontSize: 9 };
  const W = ['6%', '20%', '13%', '31%', '14%', '16%'];
  const small = { fontSize: 8, color: '#555', lineHeight: 1.35 };
  const logo = images.logo || images.left;

  return (
    <Document title={`Donation statement ${donor.name || ''} ${fyId || ''}`} author={t.nameEn || t.name}>
      <Page size="A4" style={{ fontFamily: 'Hind', padding: 32, color: col.text, fontSize: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: col.primary, paddingBottom: 8 }}>
          {logo ? <Image src={logo} style={{ width: 54, height: 54, objectFit: 'contain', marginRight: 10 }} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: 700, color: col.primary }}>{t.name}</Text>
            {t.nameEn && t.nameEn !== t.name ? <Text style={{ fontSize: 10, fontWeight: 600 }}>{t.nameEn}</Text> : null}
            {t.address ? <Text style={small}>{t.address}</Text> : null}
            <Text style={small}>{[t.phones && `Ph: ${t.phones}`, t.email, t.pan && `PAN: ${t.pan}`].filter(Boolean).join('  ·  ')}</Text>
            <Text style={small}>{[t.registrationNo && `Regn: ${t.registrationNo}`, t.section80G && `80G: ${t.section80G}`, t.section12A && `12A: ${t.section12A}`].filter(Boolean).join('  ·  ')}</Text>
          </View>
        </View>

        <Text style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: col.primary, marginTop: 12 }}>दान विवरण पत्र / DONATION STATEMENT</Text>
        <Text style={{ textAlign: 'center', fontSize: 9.5, marginBottom: 10 }}>
          वित्तीय वर्ष / Financial year {fyId}{range ? `  (${fmtDate(range.start)} – ${fmtDate(range.end)})` : ''}
        </Text>

        <View style={{ borderWidth: 0.8, borderColor: col.accent, borderRadius: 3, padding: 8, marginBottom: 10 }}>
          <Text style={{ fontSize: 11, fontWeight: 700 }}>{donor.name}{donor.organizationName ? ` (${donor.organizationName})` : ''}</Text>
          {donor.address ? <Text style={{ fontSize: 9 }}>{donor.address}</Text> : null}
          <Text style={{ fontSize: 9 }}>{[donor.donorCode && `Donor ID: ${donor.donorCode}`, donor.mobile && `Mobile: ${donor.mobile}`, donor.pan ? `PAN: ${donor.pan}` : 'PAN: —'].filter(Boolean).join('    ')}</Text>
        </View>

        <View style={{ flexDirection: 'row', backgroundColor: col.primary, color: '#fff', fontWeight: 600 }} fixed>
          {['#', 'रसीद नं. / Receipt', 'तारीख / Date', 'विगत / Particulars', 'माध्यम / Mode', 'राशि / Amount'].map((h, i) => (
            <Text key={h} style={[cell, { width: W[i], textAlign: i === 5 ? 'right' : 'left', fontSize: 8.5 }]}>{h}</Text>
          ))}
        </View>
        {rows.length ? rows.map((d, i) => (
          <View key={d.id || d.receiptNo} wrap={false} style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#ddd', backgroundColor: i % 2 ? '#fafafa' : '#fff' }}>
            <Text style={[cell, { width: W[0] }]}>{i + 1}</Text>
            <Text style={[cell, { width: W[1] }]}>{d.receiptNo}</Text>
            <Text style={[cell, { width: W[2] }]}>{fmtDate(d.date)}</Text>
            <Text style={[cell, { width: W[3] }]}>{(d.lines || []).map((l) => l.categoryNameHi || l.categoryName).filter(Boolean).join(', ')}{d.isCorpus ? ' (Corpus)' : ''}</Text>
            <Text style={[cell, { width: W[4] }]}>{d.paymentMode}{d.utr ? `\n${d.utr}` : d.chequeNo ? `\nChq ${d.chequeNo}` : ''}</Text>
            <Text style={[cell, { width: W[5], textAlign: 'right' }]}>{money(d.amount)}</Text>
          </View>
        )) : <Text style={[cell, { textAlign: 'center', color: '#888', paddingVertical: 12 }]}>इस वर्ष कोई दान नहीं / No donation in this year</Text>}
        <View style={{ flexDirection: 'row', borderTopWidth: 1.2, borderTopColor: col.primary, marginTop: 2 }}>
          <Text style={[cell, { width: '84%', textAlign: 'right', fontWeight: 700, fontSize: 10.5 }]}>कुल / Total ({rows.length})</Text>
          <Text style={[cell, { width: '16%', textAlign: 'right', fontWeight: 700, fontSize: 10.5 }]}>{money(total)}</Text>
        </View>
        {total ? <Text style={{ fontSize: 9, marginTop: 4 }}>शब्दों में: {amountInWordsHi(total)}</Text> : null}
        {total ? <Text style={{ fontSize: 8.5, color: '#444' }}>({amountInWordsEn(total)})</Text> : null}

        <View style={{ marginTop: 10 }}>
          {corpus ? <Text style={small}>• स्थायी कोष (Corpus) दान: {money(corpus)}</Text> : null}
          {cash ? <Text style={small}>• नकद (Cash) दान: {money(cash)} – ₹2,000 से अधिक नकद दान पर धारा 80G कटौती लागू नहीं होती।</Text> : null}
          {t.section80G ? <Text style={small}>• यह संस्थान आयकर अधिनियम की धारा 80G के अंतर्गत पंजीकृत है (No. {t.section80G}). Donations are eligible as per law; final 80G claim is as per Form 10BE issued by the trust.</Text> : null}
          {t.receiptNote ? <Text style={small}>• {t.receiptNote}</Text> : null}
          <Text style={small}>• This statement lists approved receipts only. Cancelled / bounced receipts are not included.</Text>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 28 }}>
          <View>
            <Text style={small}>Date: {fmtDate(new Date())}</Text>
            {generatedBy ? <Text style={small}>Prepared by: {generatedBy}</Text> : null}
          </View>
          <View style={{ alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', height: 40, alignItems: 'flex-end' }}>
              {images.stamp ? <Image src={images.stamp} style={{ height: 40, width: 40, objectFit: 'contain', marginRight: 4 }} /> : null}
              {images.signature ? <Image src={images.signature} style={{ height: 36, width: 100, objectFit: 'contain' }} /> : null}
            </View>
            <Text style={{ fontSize: 10, fontWeight: 600, color: col.primary }}>अधिकृत हस्ताक्षर / Authorised Signatory</Text>
            {t.authorizedSignatory ? <Text style={small}>{t.authorizedSignatory}</Text> : null}
          </View>
        </View>
        <Text style={{ position: 'absolute', bottom: 16, left: 32, right: 32, fontSize: 7, color: '#999', textAlign: 'center' }} fixed render={({ pageNumber, totalPages }) => `${t.nameEn || t.name} · ${pageNumber}/${totalPages}`} />
      </Page>
    </Document>
  );
}

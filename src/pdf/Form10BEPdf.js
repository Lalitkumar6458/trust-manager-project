import { Document, Page, View, Text, Image } from '@react-pdf/renderer';
import { amountInWordsEn } from '../lib/amountInWords';
import { fmtDate, money } from '../lib/format';

// Form 10BE – certificate of donation u/s 80G (one page per donor).
// Data comes from the Form 10BD statement (reports.form10bd). The ARN / date of the
// filed Form 10BD is entered on the Form 10BD page.

const maskUin = (r) => (r.idName === 'Aadhaar' ? `XXXX XXXX ${r.uin.slice(-4)}` : r.uin);

function Certificate({ group, t, fyId, filing, images }) {
  const total = group.rows.reduce((s, r) => s + r.amount, 0);
  const first = group.rows[0];
  const lbl = { fontSize: 9, color: '#555', width: '42%' };
  const val = { fontSize: 10, fontWeight: 600, width: '58%' };
  const line = (l, v) => (
    <View style={{ flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.4, borderBottomColor: '#ddd' }}>
      <Text style={lbl}>{l}</Text>
      <Text style={val}>{v || '—'}</Text>
    </View>
  );
  const year = Number(String(fyId).slice(0, 4)) + 1;
  return (
    <Page size="A4" style={{ fontFamily: 'Hind', padding: 36, fontSize: 10, color: '#222' }}>
      <Text style={{ textAlign: 'center', fontSize: 15, fontWeight: 700 }}>FORM NO. 10BE</Text>
      <Text style={{ textAlign: 'center', fontSize: 9 }}>[See rule 18AB of the Income-tax Rules, 1962]</Text>
      <Text style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, marginBottom: 12 }}>Certificate of donation under clause (ix) of sub-section (5) of section 80G</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#999', padding: 8, marginBottom: 10 }}>
        {images.logo || images.left ? <Image src={images.logo || images.left} style={{ width: 46, height: 46, objectFit: 'contain', marginRight: 10 }} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: 700 }}>{t.name}</Text>
          {t.nameEn && t.nameEn !== t.name ? <Text style={{ fontSize: 10, fontWeight: 600 }}>{t.nameEn}</Text> : null}
          {t.address ? <Text style={{ fontSize: 9 }}>{t.address}</Text> : null}
        </View>
      </View>

      {line('1. PAN of the reporting person (trust)', t.pan)}
      {line('2. Name of the reporting person', t.nameEn || t.name)}
      {line('3. Address of the reporting person', t.address)}
      {line('4. Approval / registration number u/s 80G', t.section80G)}
      {line('5. Date of approval u/s 80G', t.section80GDate ? fmtDate(t.section80GDate) : '')}
      {line('6. ARN of Form 10BD (statement of donations)', filing.arn)}
      {line('7. Date of filing Form 10BD', filing.date ? fmtDate(filing.date) : '')}
      {line('8. Financial year of donation', fyId)}
      {line('9. Name of donor', first.name)}
      {line('10. Address of donor', first.address)}
      {line(`11. Unique identification no. of donor (${first.idName})`, maskUin(first))}

      <Text style={{ fontSize: 10, fontWeight: 700, marginTop: 12, marginBottom: 4 }}>12. Details of donation</Text>
      <View style={{ flexDirection: 'row', backgroundColor: '#333', color: '#fff' }}>
        {['Donation type', 'Mode of receipt', 'Receipt nos.', 'Amount (₹)'].map((h, i) => (
          <Text key={h} style={{ width: ['20%', '36%', '28%', '16%'][i], padding: 4, fontSize: 8.5, fontWeight: 600, textAlign: i === 3 ? 'right' : 'left' }}>{h}</Text>
        ))}
      </View>
      {group.rows.map((r) => (
        <View key={`${r.donationType}${r.mode}`} style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#ccc' }} wrap={false}>
          <Text style={{ width: '20%', padding: 4, fontSize: 9 }}>{r.donationType}</Text>
          <Text style={{ width: '36%', padding: 4, fontSize: 9 }}>{r.mode}</Text>
          <Text style={{ width: '28%', padding: 4, fontSize: 8 }}>{r.receipts.join(', ')}</Text>
          <Text style={{ width: '16%', padding: 4, fontSize: 9, textAlign: 'right' }}>{money(r.amount)}</Text>
        </View>
      ))}
      <View style={{ flexDirection: 'row' }}>
        <Text style={{ width: '84%', padding: 4, fontSize: 10, fontWeight: 700, textAlign: 'right' }}>Total</Text>
        <Text style={{ width: '16%', padding: 4, fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{money(total)}</Text>
      </View>
      <Text style={{ fontSize: 9, marginTop: 2 }}>({amountInWordsEn(total)})</Text>

      <Text style={{ fontSize: 9.5, marginTop: 14, lineHeight: 1.45 }}>
        This is to certify that the above donation(s) has / have been received by {t.nameEn || t.name} during the financial year {fyId} and the
        same has been reported in the statement of donations (Form No. 10BD) furnished to the Income-tax Department.
        The donor may claim deduction under section 80G as per the provisions of the Income-tax Act, 1961.
      </Text>
      {!filing.arn ? (
        <Text style={{ fontSize: 8.5, color: '#b42318', marginTop: 6 }}>
          Note: ARN of Form 10BD not entered yet – file Form 10BD (due 31 May {year}) and enter its ARN before issuing this certificate.
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 30 }}>
        <View>
          <Text style={{ fontSize: 9 }}>Place: {(t.address || '').split(',').slice(-2).join(',').trim()}</Text>
          <Text style={{ fontSize: 9 }}>Date: {fmtDate(new Date())}</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', height: 42, alignItems: 'flex-end' }}>
            {images.stamp ? <Image src={images.stamp} style={{ height: 42, width: 42, objectFit: 'contain', marginRight: 4 }} /> : null}
            {images.signature ? <Image src={images.signature} style={{ height: 36, width: 100, objectFit: 'contain' }} /> : null}
          </View>
          <Text style={{ fontSize: 10, fontWeight: 600 }}>Authorised Signatory</Text>
          <Text style={{ fontSize: 9 }}>{t.authorizedSignatory || ''}</Text>
          <Text style={{ fontSize: 9 }}>For {t.nameEn || t.name}</Text>
        </View>
      </View>
      <Text style={{ position: 'absolute', bottom: 18, left: 36, right: 36, fontSize: 7, color: '#999', textAlign: 'center' }}>
        Generated from the trust's records. The Income-tax portal also issues Form 10BE after Form 10BD is filed.
      </Text>
    </Page>
  );
}

/** rows → certificates grouped per donor (donorRef + ID) */
export function groupForCertificates(rows) {
  const m = new Map();
  rows.forEach((r) => {
    const k = `${r.donorRef || r.name}|${r.idCode}|${r.uin}`;
    if (!m.has(k)) m.set(k, { key: k, rows: [] });
    m.get(k).rows.push(r);
  });
  return [...m.values()];
}

export default function Form10BEPdf({ rows, settings: t, fyId, filing = {}, images = {} }) {
  const groups = groupForCertificates(rows);
  return (
    <Document title={`Form 10BE ${fyId}`} author={t.nameEn || t.name}>
      {groups.map((g) => <Certificate key={g.key} group={g} t={t} fyId={fyId} filing={filing} images={images} />)}
    </Document>
  );
}

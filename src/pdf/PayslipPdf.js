import { Document, Page, View, Text } from '@react-pdf/renderer';
import dayjs from 'dayjs';
import { amountInWordsEn } from '../lib/amountInWords';
import { money } from '../lib/format';

// Salary slips – two per A4 page
function Slip({ p, t, staff }) {
  const row = (l, v, b) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, borderBottomWidth: 0.4, borderBottomColor: '#ddd' }}>
      <Text style={{ fontSize: 9.5, fontWeight: b ? 700 : 400 }}>{l}</Text><Text style={{ fontSize: 9.5, fontWeight: b ? 700 : 400 }}>{v}</Text>
    </View>
  );
  return (
    <View style={{ height: 380, borderWidth: 1, borderColor: '#999', padding: 12, marginBottom: 10 }} wrap={false}>
      <Text style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#7d1a12' }}>{t.name}</Text>
      {t.address ? <Text style={{ textAlign: 'center', fontSize: 8 }}>{t.address}</Text> : null}
      <Text style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, marginVertical: 6 }}>वेतन पर्ची / SALARY SLIP – {dayjs(`${p.month}-01`).format('MMMM YYYY')}</Text>
      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 9.5 }}>Name: <Text style={{ fontWeight: 700 }}>{p.staffName}</Text> ({p.staffCode})</Text>
          <Text style={{ fontSize: 9.5 }}>Designation: {p.designation || '-'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 9.5 }}>Days worked: {p.daysWorked} / {p.daysInMonth}</Text>
          <Text style={{ fontSize: 9.5 }}>{staff?.bankAccount ? `Bank A/c: ${staff.bankAccount} ${staff.ifsc || ''}` : ''}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={{ fontSize: 10, fontWeight: 700, marginBottom: 2 }}>Earnings</Text>
          {row('Monthly salary', money(p.monthlySalary))}
          {row(`Salary for ${p.daysWorked} days`, money(p.gross))}
          {row('Bonus / extra', money(p.bonus || 0))}
          {row('Total earnings', money((p.gross || 0) + (p.bonus || 0)), true)}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10, fontWeight: 700, marginBottom: 2 }}>Deductions</Text>
          {row('Advance recovered', money(p.advance || 0))}
          {row('Other deduction', money(p.otherDeduction || 0))}
          {row('Total deductions', money((p.advance || 0) + (p.otherDeduction || 0)), true)}
        </View>
      </View>
      <View style={{ marginTop: 10, padding: 6, backgroundColor: '#f5efe3' }}>
        <Text style={{ fontSize: 12, fontWeight: 700 }}>Net paid: {money(p.net)}</Text>
        <Text style={{ fontSize: 8.5 }}>({amountInWordsEn(p.net)})</Text>
        {p.voucherNo ? <Text style={{ fontSize: 8.5 }}>Voucher {p.voucherNo} · paid on {p.paidDate} from {p.paidFrom}</Text> : <Text style={{ fontSize: 8.5, color: '#a8071a' }}>Not paid yet</Text>}
      </View>
      {p.note ? <Text style={{ fontSize: 8.5, marginTop: 4 }}>Note: {p.note}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto' }}>
        <Text style={{ fontSize: 9 }}>Employee signature</Text>
        <Text style={{ fontSize: 9 }}>For {t.nameEn || t.name} – Authorised signatory</Text>
      </View>
    </View>
  );
}

export default function PayslipPdf({ slips, settings, staffMap = {} }) {
  const pages = [];
  for (let i = 0; i < slips.length; i += 2) pages.push(slips.slice(i, i + 2));
  return (
    <Document title="Salary slips">
      {pages.map((pg) => (
        <Page key={pg[0].id} size="A4" style={{ fontFamily: 'Hind', padding: 24 }}>
          {pg.map((p) => <Slip key={p.id} p={p} t={settings} staff={staffMap[p.staffId]} />)}
        </Page>
      ))}
    </Document>
  );
}

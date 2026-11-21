import { verifyReceipt } from '@/server/services/receiptVerify';
import { fmtDate, money } from '@/lib/format';

// Public receipt check (QR code on the receipt opens this page). No login needed.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Receipt verification', robots: { index: false, follow: false } };

const STATUS = {
  approved: { ok: true, color: '#1b7f3b', bg: '#e8f6ec', hi: 'यह रसीद असली और मान्य है', en: 'This receipt is genuine and valid' },
  void: { ok: false, color: '#b42318', bg: '#fdecea', hi: 'यह रसीद रद्द कर दी गई है', en: 'This receipt has been CANCELLED' },
  pending: { ok: false, color: '#9a6700', bg: '#fff6db', hi: 'रसीद अभी स्वीकृत नहीं हुई है', en: 'Receipt not yet approved by the trust' },
};

export default async function VerifyReceipt({ params }) {
  const { token } = await params;
  let r = null;
  try { r = await verifyReceipt(token); } catch { r = null; }
  const box = { maxWidth: 460, margin: '32px auto', padding: 16, fontFamily: 'system-ui, -apple-system, "Segoe UI", "Noto Sans Devanagari", sans-serif' };
  if (!r) {
    return (
      <main style={box}>
        <div style={{ border: '1px solid #f5c2c0', background: '#fdecea', color: '#b42318', borderRadius: 12, padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 44 }}>✖</div>
          <h1 style={{ fontSize: 20, margin: '8px 0' }}>रसीद नहीं मिली</h1>
          <p style={{ margin: 0 }}>Receipt not found. The link or QR code is wrong — this receipt may not be genuine. Please contact the trust office.</p>
        </div>
      </main>
    );
  }
  const st = STATUS[r.status] || STATUS.pending;
  const row = (label, value) => (
    <tr>
      <td style={{ padding: '7px 0', color: '#666', width: '42%', verticalAlign: 'top' }}>{label}</td>
      <td style={{ padding: '7px 0', fontWeight: 600 }}>{value}</td>
    </tr>
  );
  return (
    <main style={box}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, margin: 0, color: '#7d1a12' }}>{r.trust.name}</h1>
        {r.trust.nameEn && r.trust.nameEn !== r.trust.name ? <div style={{ fontWeight: 600 }}>{r.trust.nameEn}</div> : null}
        {r.trust.address ? <div style={{ fontSize: 13, color: '#666' }}>{r.trust.address}</div> : null}
      </div>
      <div style={{ background: st.bg, color: st.color, borderRadius: 12, padding: 16, textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 40, lineHeight: 1 }}>{st.ok ? '✔' : r.status === 'void' ? '✖' : '⏳'}</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{st.hi}</div>
        <div style={{ fontSize: 14 }}>{st.en}{r.status === 'void' && r.bounced ? ' (payment bounced)' : ''}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
        <tbody>
          {row('रसीद नं. / Receipt No.', r.receiptNo || '—')}
          {row('तारीख / Date', fmtDate(r.date))}
          {row('राशि / Amount', money(r.amount))}
          {row('दाता / Donor', r.donor)}
          {row('माध्यम / Mode', r.paymentMode)}
          {r.categories.length ? row('विगत / For', r.categories.join(', ')) : null}
          {r.trust.pan ? row('ट्रस्ट PAN', r.trust.pan) : null}
          {r.trust.section80G ? row('80G', r.trust.section80G) : null}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: '#888', marginTop: 16, textAlign: 'center' }}>
        Donor name is partly hidden for privacy. Match the receipt no., date and amount with your printed receipt.
        {r.trust.phones ? ` Office: ${r.trust.phones}` : ''}
      </p>
    </main>
  );
}

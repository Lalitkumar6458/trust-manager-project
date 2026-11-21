import { Document, Page, View, Text, Image, Svg, Path } from '@react-pdf/renderer';
import { amountInWordsHi, amountInWordsEn } from '../lib/amountInWords';
import { rupeePaise, fmtDate, money } from '../lib/format';
import { receiptDesignOf } from '../lib/receiptDesign';

// ------------------------------------------------------------------
// Donation receipt – fully driven by Settings → Receipt design
// (template, page size, language, colours, which fields print, every label).
// ------------------------------------------------------------------

const SIZES = {
  A5: { size: 'A5', orientation: 'portrait', scale: 1 },
  A5L: { size: 'A5', orientation: 'landscape', scale: 0.82 },
  A4: { size: 'A4', orientation: 'portrait', scale: 1.28 },
  A4x2: { size: 'A4', orientation: 'portrait', scale: 0.9 },
  T80: { size: null, orientation: 'portrait', scale: 0.82 },
};
/** most category tick-rows that fit before switching to "only donated lines" */
const MAX_ROWS = { A5: 14, A5L: 7, A4: 18, A4x2: 6, T80: 0 };

const MODE_HI = { Cash: 'रोकड़ा (Cash)', Cheque: 'चैक (Cheque)' };
function modeLine(d, lang) {
  const ref = [d.utr && `UTR: ${d.utr}`, d.chequeNo && `${lang === 'en' ? 'Cheque No.' : 'चैक नं.'}: ${d.chequeNo}${d.chequeDate ? ` (${fmtDate(d.chequeDate)})` : ''}`, d.bankName]
    .filter(Boolean).join(', ');
  const label = lang === 'en' ? (d.paymentMode || '') : (MODE_HI[d.paymentMode] || `Online (${d.paymentMode})`);
  return ref ? `${label} – ${ref}` : label;
}

function Tick({ color }) {
  return <Svg width={8} height={8} viewBox="0 0 10 10"><Path d="M1 5.5 L4 8.5 L9 1.5" stroke={color} strokeWidth={1.8} fill="none" /></Svg>;
}

/** rows printed in the table */
function tableRows(d, categories, design, sizeKey) {
  const donatedIds = new Set((d.lines || []).map((l) => l.categoryId));
  const donated = (d.lines || []).reduce((acc, l) => {
    const ex = acc.find((x) => x.id === l.categoryId);
    if (ex) ex.amount += l.amount; else acc.push({ id: l.categoryId, name: l.categoryName, nameHi: l.categoryNameHi, amount: l.amount, ticked: true });
    return acc;
  }, []);
  if (design.categoryRows === 'donated') return donated;
  const listed = categories.filter((c) => c.showOnReceipt && c.active !== false);
  const rows = [
    ...listed.map((c) => ({ id: c.id, name: c.name, nameHi: c.nameHi, ticked: donatedIds.has(c.id), amount: donated.find((x) => x.id === c.id)?.amount || 0 })),
    ...donated.filter((x) => !listed.some((c) => c.id === x.id)),
  ];
  return rows.length > (MAX_ROWS[sizeKey] ?? 14) ? donated : rows;
}

const nameOf = (c, lang) => (lang === 'en' ? (c.name || c.nameHi) : lang === 'both' && c.nameHi && c.name && c.nameHi !== c.name ? `${c.nameHi} (${c.name})` : (c.nameHi || c.name));

/** One receipt (fills the box it is put in) */
export function ReceiptBody({ d, t, design, categories = [], images = {}, qr, copyLabel, duplicate, sizeKey }) {
  const L = design.labels;
  const show = design.show;
  const lang = design.language;
  const k = (SIZES[sizeKey]?.scale || 1) * (Number(design.fontScale) || 1);
  const f = (n) => Math.round(n * k * 10) / 10;
  const col = design.template === 'simple' ? { primary: '#111111', accent: '#555555', text: '#111111', paper: '#ffffff' } : design.colors;
  const paper = design.paperTint && design.template === 'classic' ? col.paper : '#ffffff';
  const modern = design.template === 'modern';
  const thermal = sizeKey === 'T80';
  const wide = sizeKey === 'A5L';
  const rows = tableRows(d, categories, design, sizeKey);
  const total = rupeePaise(d.amount);
  const cashOver80G = String(d.paymentMode || '').toLowerCase() === 'cash' && Number(d.amount) > 2000;
  const fill = { flex: 1, borderBottomWidth: 0.7, borderBottomColor: col.text, borderBottomStyle: 'dotted', fontSize: f(10.5), paddingHorizontal: 4, minHeight: f(14) };
  const label = { fontSize: f(10.5), fontWeight: 700, marginRight: 4 };
  const row = { flexDirection: 'row', alignItems: 'flex-end', marginBottom: f(3.5) };
  const small = { fontSize: f(7.8), color: col.text, opacity: 0.8, lineHeight: 1.3 };
  const center = { textAlign: 'center', fontSize: f(8.2), fontWeight: 600, lineHeight: 1.25, color: col.text };
  const imgBox = { width: f(42), height: f(46) };
  const regLine = show.registration ? [
    t.registrationNo && `${L.registration}: ${t.registrationNo}${t.registrationDate ? ` (${t.registrationDate})` : ''}`,
    t.pan && `${L.trustPan}: ${t.pan}`,
  ].filter(Boolean).join(' / ') : '';
  const taxLine = show.tax ? [t.section80G && `80G: ${t.section80G}`, t.section12A && `12A: ${t.section12A}`].filter(Boolean).join('   ') : '';
  const trustName = lang === 'en' ? (t.nameEn || t.name) : t.name;
  const subName = lang === 'both' && t.nameEn && t.nameEn !== t.name ? t.nameEn : '';
  const words = [show.wordsHi && lang !== 'en' ? amountInWordsHi(d.amount) : null, show.wordsEn || lang === 'en' ? amountInWordsEn(d.amount) : null].filter(Boolean);
  const footerLines = String(design.footerText || '').split('\n').map((x) => x.trim()).filter(Boolean);

  // ---------------- thermal (80 mm) ----------------
  if (thermal) {
    const line = { borderBottomWidth: 0.6, borderBottomColor: '#000', borderBottomStyle: 'dashed', marginVertical: 4 };
    return (
      <View style={{ paddingHorizontal: 8, paddingVertical: 8, color: '#000', fontFamily: 'Hind' }}>
        {show.leftImage && (images.logo || images.left) ? <Image src={images.logo || images.left} style={{ width: 46, height: 46, objectFit: 'contain', alignSelf: 'center' }} /> : null}
        <Text style={{ textAlign: 'center', fontSize: f(13), fontWeight: 700 }}>{trustName}</Text>
        {subName ? <Text style={{ textAlign: 'center', fontSize: f(8.5) }}>{subName}</Text> : null}
        {show.address && t.address ? <Text style={{ textAlign: 'center', fontSize: f(7.5) }}>{t.address}</Text> : null}
        {show.phones && t.phones ? <Text style={{ textAlign: 'center', fontSize: f(7.5) }}>{L.phone}: {t.phones}</Text> : null}
        {regLine ? <Text style={{ textAlign: 'center', fontSize: f(7) }}>{regLine}</Text> : null}
        {taxLine ? <Text style={{ textAlign: 'center', fontSize: f(7) }}>{taxLine}</Text> : null}
        <View style={line} />
        <Text style={{ textAlign: 'center', fontSize: f(11), fontWeight: 700 }}>{L.title}{copyLabel ? ` – ${copyLabel}` : ''}</Text>
        {duplicate ? <Text style={{ textAlign: 'center', fontSize: f(8), fontWeight: 700 }}>{L.duplicate}</Text> : null}
        <Text style={{ fontSize: f(9) }}>{L.number}: {d.receiptNo || 'DRAFT'}</Text>
        <Text style={{ fontSize: f(9) }}>{L.date}: {fmtDate(d.date)}</Text>
        <Text style={{ fontSize: f(9), fontWeight: 600 }}>{lang === 'en' ? 'From' : L.donor}: {d.donor?.name}{d.donor?.organizationName ? ` (${d.donor.organizationName})` : ''}</Text>
        {show.donorMobile && d.donor?.mobile ? <Text style={{ fontSize: f(8.5) }}>{L.mobile}: {d.donor.mobile}</Text> : null}
        {show.donorPan && d.donor?.pan ? <Text style={{ fontSize: f(8.5) }}>{L.pan}: {d.donor.pan}</Text> : null}
        <View style={line} />
        {rows.map((r) => (
          <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 }}>
            <Text style={{ fontSize: f(9), flex: 1, paddingRight: 4 }}>{nameOf(r, lang)}</Text>
            <Text style={{ fontSize: f(9) }}>{money(r.amount)}</Text>
          </View>
        ))}
        <View style={line} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: f(11), fontWeight: 700 }}>{L.total}</Text>
          <Text style={{ fontSize: f(11), fontWeight: 700 }}>{money(d.amount)}</Text>
        </View>
        {words.map((w) => <Text key={w} style={{ fontSize: f(7.8) }}>{w}</Text>)}
        {show.payment ? <Text style={{ fontSize: f(8), marginTop: 2 }}>{L.payment}: {modeLine(d, lang)}</Text> : null}
        {show.purpose && d.purpose ? <Text style={{ fontSize: f(8) }}>{L.purpose}: {d.purpose}</Text> : null}
        {cashOver80G && t.section80G ? <Text style={{ fontSize: f(7) }}>Cash above ₹2,000 not eligible u/s 80G</Text> : null}
        {t.receiptNote ? <Text style={{ fontSize: f(7), marginTop: 2 }}>{t.receiptNote}</Text> : null}
        {qr && show.qr ? <Image src={qr} style={{ width: 70, height: 70, alignSelf: 'center', marginTop: 4 }} /> : null}
        {qr && show.qr && L.scanToVerify ? <Text style={{ textAlign: 'center', fontSize: f(7) }}>{L.scanToVerify}</Text> : null}
        {show.thankYou ? <Text style={{ textAlign: 'center', fontSize: f(9), fontWeight: 600, marginTop: 4 }}>{L.thankYou}</Text> : null}
        {footerLines.map((x) => <Text key={x} style={{ textAlign: 'center', fontSize: f(7.5) }}>{x}</Text>)}
        {show.computer ? <Text style={{ textAlign: 'center', fontSize: f(6.5), marginTop: 3 }}>{L.computer}</Text> : null}
      </View>
    );
  }

  // ---------------- A5 / A4 templates ----------------
  const header = (
    <>
      {show.invocation && !modern ? (t.invocationLines || []).filter(Boolean).map((x) => <Text key={x} style={{ textAlign: 'center', color: col.primary, fontSize: f(8.5), lineHeight: 1.25 }}>{x}</Text>) : null}
      <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }, modern ? { backgroundColor: col.primary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 5 } : null]}>
        <View style={imgBox}>{show.leftImage && images.left ? <Image src={images.left} style={{ ...imgBox, objectFit: 'contain' }} /> : null}</View>
        <View style={{ flex: 1 }}>
          {show.invocation && modern ? (t.invocationLines || []).filter(Boolean).map((x) => <Text key={x} style={{ textAlign: 'center', color: '#fff', fontSize: f(7.5) }}>{x}</Text>) : null}
          <Text style={{ textAlign: 'center', color: modern ? '#fff' : (design.template === 'simple' ? col.text : col.primary), fontSize: f(19), fontWeight: 700, lineHeight: 1.1 }}>{trustName}</Text>
          {subName ? <Text style={{ textAlign: 'center', color: modern ? '#fff' : col.text, fontSize: f(9), fontWeight: 600 }}>{subName}</Text> : null}
        </View>
        <View style={imgBox}>{show.rightImage && images.right ? <Image src={images.right} style={{ ...imgBox, objectFit: 'contain' }} /> : null}</View>
      </View>
      {show.address && t.address ? <Text style={[center, { marginTop: 2 }]}>{t.address}</Text> : null}
      {show.phones && t.phones ? <Text style={center}>{L.phone} : {t.phones}</Text> : null}
      {show.email && (t.email || t.website) ? <Text style={[center, { fontWeight: 400 }]}>{[t.email, t.website].filter(Boolean).join('  ·  ')}</Text> : null}
      {regLine ? <Text style={center}>{regLine}</Text> : null}
      {taxLine ? <Text style={[center, { fontWeight: 400 }]}>{taxLine}</Text> : null}
      {modern ? <View style={{ marginBottom: 5 }} /> : (
        <>
          <View style={{ borderBottomWidth: 1.6, borderBottomColor: col.primary, marginTop: 4 }} />
          <View style={{ borderBottomWidth: 0.6, borderBottomColor: col.primary, marginTop: 1.5, marginBottom: 4 }} />
        </>
      )}
    </>
  );

  const title = modern ? (
    <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 5 }}>
      <Text style={{ fontSize: f(11), fontWeight: 700, color: col.primary, borderBottomWidth: 1.5, borderBottomColor: col.accent, paddingHorizontal: 6 }}>{L.title}{copyLabel ? ` – ${copyLabel}` : ''}</Text>
    </View>
  ) : (
    <Text style={{ alignSelf: 'center', backgroundColor: col.primary, color: '#fff', fontSize: f(9.5), fontWeight: 600, paddingHorizontal: 12, paddingTop: 2.5, paddingBottom: 1, borderRadius: 8, marginBottom: 4 }}>{L.title}{copyLabel ? ` – ${copyLabel}` : ''}</Text>
  );

  const thStyle = { flexDirection: 'row', backgroundColor: modern ? col.accent : col.primary, color: '#fff', fontWeight: 600, fontSize: f(9.5) };
  const thCell = { paddingVertical: 2.5, paddingHorizontal: 4, borderRightWidth: 1, borderRightColor: '#fff', textAlign: 'center' };
  const W = { sn: '11%', item: '51%', rs: '24%', ps: '14%' };
  const amt = { borderBottomWidth: 0.7, borderBottomColor: col.text, textAlign: 'right', paddingHorizontal: 3, fontSize: f(10.5) };

  return (
    <View style={{ flexGrow: 1, backgroundColor: paper, color: col.text, fontFamily: 'Hind', fontSize: f(10), padding: design.template === 'simple' ? 8 : 0 }}>
      <View style={design.template === 'classic' ? { borderWidth: 2.5, borderColor: col.primary, borderRadius: 4, padding: 3, flexGrow: 1 } : { borderWidth: design.template === 'simple' ? 0.8 : 0, borderColor: col.text, flexGrow: 1, padding: design.template === 'simple' ? 6 : 0 }}>
        <View style={design.template === 'classic' ? { borderWidth: 0.8, borderColor: col.accent, borderRadius: 3, paddingHorizontal: 12, paddingVertical: 5, flexGrow: 1 } : { paddingHorizontal: modern ? 4 : 6, paddingVertical: 4, flexGrow: 1 }}>
          {header}
          {title}
          {duplicate ? <Text style={[center, { color: col.primary, fontWeight: 700, marginTop: -2 }]}>{L.duplicate}</Text> : null}

          <View style={row}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', width: '56%' }}>
              <Text style={label}>{L.number}:</Text>
              <Text style={fill}>{d.receiptNo || 'DRAFT'}</Text>
            </View>
            <View style={{ width: '6%' }} />
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', width: '38%' }}>
              <Text style={label}>{L.date}:</Text>
              <Text style={[fill, { textAlign: 'center' }]}>{fmtDate(d.date)}</Text>
            </View>
          </View>
          <View style={[row, String(d.donor?.name || '').length > 45 ? { alignItems: 'flex-start' } : null]}>
            <Text style={label}>{L.donor}</Text>
            <Text style={fill}>{d.donor?.name}{d.donor?.organizationName ? ` (${d.donor.organizationName})` : ''}</Text>
          </View>
          {show.donorAddress ? (
            <View style={[row, String(d.donor?.address || '').length > 55 ? { alignItems: 'flex-start' } : null]}>
              <Text style={label}>{L.address}</Text>
              <Text style={fill}>{d.donor?.address || ' '}</Text>
              {wide && show.donorMobile ? <><Text style={[label, { fontSize: f(9.5), marginLeft: 8 }]}>{L.mobile}:</Text><Text style={[fill, { fontSize: f(10), flex: 0.45 }]}>{d.donor?.mobile || '-'}</Text></> : null}
              {wide && show.donorPan ? <><Text style={[label, { fontSize: f(9.5), marginLeft: 8 }]}>{L.pan}:</Text><Text style={[fill, { fontSize: f(10), flex: 0.45 }]}>{d.donor?.pan || '-'}</Text></> : null}
            </View>
          ) : null}
          {!(wide && show.donorAddress) && ((show.donorMobile && d.donor?.mobile) || (show.donorPan && d.donor?.pan) || (show.donorEmail && d.donor?.email)) ? (
            <View style={row}>
              {show.donorMobile ? <><Text style={[label, { fontSize: f(9.5) }]}>{L.mobile}:</Text><Text style={[fill, { fontSize: f(10) }]}>{d.donor?.mobile || '-'}</Text></> : null}
              {show.donorPan ? <><Text style={[label, { fontSize: f(9.5), marginLeft: 8 }]}>{L.pan}:</Text><Text style={[fill, { fontSize: f(10) }]}>{d.donor?.pan || '-'}</Text></> : null}
              {show.donorEmail && d.donor?.email ? <><Text style={[label, { fontSize: f(9.5), marginLeft: 8 }]}>{L.email}:</Text><Text style={[fill, { fontSize: f(9.5) }]}>{d.donor.email}</Text></> : null}
            </View>
          ) : null}

          {L.intro ? <Text style={{ fontSize: f(9.8), fontWeight: 600, marginTop: 2, marginBottom: 3 }}>{L.intro}</Text> : null}

          <View style={thStyle}>
            <Text style={[thCell, { width: W.sn }]}>{L.sn}</Text>
            <Text style={[thCell, { width: W.item }]}>{L.particulars}</Text>
            <Text style={[thCell, { width: W.rs }]}>{L.rupees}</Text>
            <Text style={[thCell, { width: W.ps, borderRightWidth: 0 }]}>{L.paise}</Text>
          </View>
          {rows.map((c, i) => {
            const rp = c.amount ? rupeePaise(c.amount) : null;
            return (
              <View key={c.id || i} wrap={false} style={{ flexDirection: 'row', alignItems: 'center', minHeight: f(14.5), backgroundColor: modern && i % 2 ? '#f6f6f6' : undefined }}>
                <View style={{ width: W.sn, flexDirection: 'row', alignItems: 'center', paddingLeft: 3 }}>
                  {design.categoryRows === 'all' ? (
                    <View style={{ width: 9, height: 9, borderWidth: 0.9, borderColor: col.text, marginRight: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>{c.ticked ? <Tick color={col.primary} /> : null}</View>
                  ) : null}
                  {design.categoryRows !== 'all' ? <Text style={{ fontSize: f(9.5) }}>{i + 1}</Text> : null}
                </View>
                <Text style={{ width: W.item, fontSize: f(10.2), fontWeight: c.ticked ? 600 : 400 }}>{design.categoryRows === 'all' ? `${i + 1}. ` : ''}{nameOf(c, lang)}</Text>
                <View style={{ width: W.rs, paddingHorizontal: 3 }}><Text style={amt}>{rp ? rp.rupees : ' '}</Text></View>
                <View style={{ width: W.ps, paddingHorizontal: 3 }}><Text style={[amt, { textAlign: 'center' }]}>{rp ? rp.paise : ' '}</Text></View>
              </View>
            );
          })}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, borderTopWidth: 1, borderTopColor: col.text, paddingTop: 2 }}>
            <Text style={{ width: W.sn }} />
            <Text style={{ width: W.item, textAlign: 'right', paddingRight: 8, fontSize: f(12), fontWeight: 700 }}>{L.total}</Text>
            <View style={{ width: W.rs, paddingHorizontal: 3 }}><Text style={[amt, { fontWeight: 700, fontSize: f(11.5) }]}>₹ {total.rupees}</Text></View>
            <View style={{ width: W.ps, paddingHorizontal: 3 }}><Text style={[amt, { fontWeight: 700, textAlign: 'center' }]}>{total.paise}</Text></View>
          </View>

          {wide ? (
            <View style={{ flexDirection: 'row', marginTop: 2 }}>
              <View style={{ width: '64%', paddingRight: 10 }}>
                <>
          {words.length ? (
            <View style={[row, { marginTop: 5 }]}>
              <Text style={label}>{L.inWords}</Text>
              <Text style={[fill, { fontWeight: 600 }]}>{words[0]}</Text>
            </View>
          ) : null}
          {words[1] ? <Text style={[small, { marginTop: -1, marginBottom: 5 }]}>({words[1]})</Text> : null}
          {show.payment ? (
            <View style={[row, modeLine(d, lang).length > 40 ? { alignItems: 'flex-start' } : null]}>
              <Text style={[label, { fontSize: f(9.8) }]}>{L.payment}:</Text>
              <Text style={[fill, { fontSize: f(9.5) }]}>{modeLine(d, lang)}</Text>
            </View>
          ) : null}
          {show.purpose && d.purpose ? (
            <View style={row}>
              <Text style={[label, { fontSize: f(9.8) }]}>{L.purpose}:</Text>
              <Text style={[fill, { fontSize: f(9.5) }]}>{d.purpose}</Text>
            </View>
          ) : null}
          {show.thankYou ? <Text style={{ textAlign: 'center', fontSize: f(10), fontWeight: 600, color: col.primary, marginTop: 2 }}>{L.thankYou}</Text> : null}
                </>
                <Text style={[small, { marginTop: 'auto' }]}>
                  {[show.fy && `${L.fy} (FY): ${d.financialYearId}`, d.isCorpus && 'Corpus donation (स्थायी कोष दान)', cashOver80G && t.section80G && 'Cash above ₹2,000 not eligible u/s 80G', t.receiptNote, ...footerLines, show.computer && L.computer].filter(Boolean).join('  ·  ')}
                </Text>
              </View>
              <View style={{ width: '36%', alignItems: 'center', justifyContent: 'flex-end' }}>
                {qr && show.qr ? <Image src={qr} style={{ width: f(52), height: f(52) }} /> : null}
                {qr && show.qr && L.scanToVerify ? <Text style={[small, { fontSize: f(6.5), marginBottom: 3 }]}>{L.scanToVerify}</Text> : null}
              <View style={{ flexDirection: 'row', height: f(30), alignItems: 'flex-end' }}>
                {show.stamp && images.stamp ? <Image src={images.stamp} style={{ height: f(30), width: f(30), objectFit: 'contain', marginRight: 4 }} /> : null}
                {show.signature && images.signature ? <Image src={images.signature} style={{ height: f(30), width: f(80), objectFit: 'contain' }} /> : null}
              </View>
              <Text style={{ fontSize: f(10.5), fontWeight: 600, color: design.template === 'simple' ? col.text : col.primary }}>{L.signature}</Text>
              <Text style={{ fontSize: f(10.5), fontWeight: 700, color: design.template === 'simple' ? col.text : col.primary, textAlign: 'center' }}>{trustName}</Text>
              {t.authorizedSignatory ? <Text style={small}>{t.authorizedSignatory}</Text> : null}
              </View>
            </View>
          ) : (
            <>
          {words.length ? (
            <View style={[row, { marginTop: 5 }]}>
              <Text style={label}>{L.inWords}</Text>
              <Text style={[fill, { fontWeight: 600 }]}>{words[0]}</Text>
            </View>
          ) : null}
          {words[1] ? <Text style={[small, { marginTop: -1, marginBottom: 5 }]}>({words[1]})</Text> : null}
          {show.payment ? (
            <View style={[row, modeLine(d, lang).length > 40 ? { alignItems: 'flex-start' } : null]}>
              <Text style={[label, { fontSize: f(9.8) }]}>{L.payment}:</Text>
              <Text style={[fill, { fontSize: f(9.5) }]}>{modeLine(d, lang)}</Text>
            </View>
          ) : null}
          {show.purpose && d.purpose ? (
            <View style={row}>
              <Text style={[label, { fontSize: f(9.8) }]}>{L.purpose}:</Text>
              <Text style={[fill, { fontSize: f(9.5) }]}>{d.purpose}</Text>
            </View>
          ) : null}
          {show.thankYou ? <Text style={{ textAlign: 'center', fontSize: f(10), fontWeight: 600, color: col.primary, marginTop: 2 }}>{L.thankYou}</Text> : null}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 'auto', paddingTop: 4 }}>
            <View style={{ width: qr && show.qr ? '36%' : '50%' }}>
              {show.fy ? <Text style={small}>{L.fy} (FY): {d.financialYearId}</Text> : null}
              {d.isCorpus ? <Text style={small}>Corpus donation (स्थायी कोष दान)</Text> : null}
              {cashOver80G && t.section80G ? <Text style={[small, { color: '#a4161a' }]}>नकद ₹2,000 से अधिक दान पर 80G कटौती लागू नहीं (Cash above ₹2,000 not eligible u/s 80G)</Text> : null}
              {t.receiptNote ? <Text style={small}>{t.receiptNote}</Text> : null}
              {footerLines.map((x) => <Text key={x} style={small}>{x}</Text>)}
              {show.computer ? <Text style={[small, { fontSize: f(6.8) }]}>{L.computer}</Text> : null}
            </View>
            {qr && show.qr ? (
              <View style={{ alignItems: 'center' }}>
                <Image src={qr} style={{ width: f(52), height: f(52) }} />
                {L.scanToVerify ? <Text style={[small, { fontSize: f(6.5) }]}>{L.scanToVerify}</Text> : null}
              </View>
            ) : null}
            <View style={{ alignItems: 'center', width: '46%' }}>
              <View style={{ flexDirection: 'row', height: f(30), alignItems: 'flex-end' }}>
                {show.stamp && images.stamp ? <Image src={images.stamp} style={{ height: f(30), width: f(30), objectFit: 'contain', marginRight: 4 }} /> : null}
                {show.signature && images.signature ? <Image src={images.signature} style={{ height: f(30), width: f(80), objectFit: 'contain' }} /> : null}
              </View>
              <Text style={{ fontSize: f(10.5), fontWeight: 600, color: design.template === 'simple' ? col.text : col.primary }}>{L.signature}</Text>
              <Text style={{ fontSize: f(10.5), fontWeight: 700, color: design.template === 'simple' ? col.text : col.primary, textAlign: 'center' }}>{trustName}</Text>
              {t.authorizedSignatory ? <Text style={small}>{t.authorizedSignatory}</Text> : null}
            </View>
          </View>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

/** VOID / PROVISIONAL / faint logo – absolutely positioned over a receipt box */
function Marks({ d, t, design, images, box }) {
  const big = Math.min(box.w, box.h) / 5.5;
  return (
    <>
      {design.show.watermark && (images.logo || images.left) ? (
        <Image src={images.logo || images.left} style={{ position: 'absolute', top: box.h / 2 - box.w * 0.22, left: box.w * 0.28, width: box.w * 0.44, height: box.w * 0.44, objectFit: 'contain', opacity: 0.07 }} />
      ) : null}
      {d.status === 'void' ? <Text style={{ position: 'absolute', top: box.h * 0.42, left: box.w * 0.08, fontSize: big, color: '#d4380d', opacity: 0.22, transform: 'rotate(-30deg)', fontWeight: 700 }}>{d.bounced ? 'अनादरित / BOUNCED' : 'रद्द / VOID'}</Text> : null}
      {d.status !== 'void' && d.status !== 'approved' && t.receiptBeforeApproval !== 'allow' ? <Text style={{ position: 'absolute', top: box.h * 0.45, left: box.w * 0.12, fontSize: big * 0.7, color: '#8c8c8c', opacity: 0.25, transform: 'rotate(-30deg)', fontWeight: 700 }}>PROVISIONAL</Text> : null}
    </>
  );
}

/** Thermal page height grows with the number of lines */
const thermalHeight = (d, design) => 330 + ((d.lines || []).length * 14) + (design.show.qr ? 80 : 0) + (String(design.footerText || '').split('\n').filter(Boolean).length * 10);

/** Pages for one donation */
function ReceiptPages({ d, t, design, categories, images, qr, copyLabel, duplicate }) {
  const sizeKey = SIZES[design.pageSize] ? design.pageSize : 'A5';
  const cfg = SIZES[sizeKey];
  const paperBg = design.paperTint && design.template === 'classic' ? design.colors.paper : '#ffffff';
  const common = { t, design, categories, images, qr, duplicate, sizeKey };
  if (sizeKey === 'T80') {
    return (
      <Page wrap={false} size={[226.8, thermalHeight(d, design)]} style={{ fontFamily: 'Hind', backgroundColor: '#fff' }}>
        <ReceiptBody d={d} copyLabel={copyLabel} {...common} />
        <Marks d={d} t={t} design={design} images={images} box={{ w: 226, h: thermalHeight(d, design) }} />
      </Page>
    );
  }
  if (sizeKey === 'A4x2') {
    const half = { height: 410, padding: 8, position: 'relative' };
    return (
      <Page wrap={false} size="A4" style={{ fontFamily: 'Hind', backgroundColor: paperBg }}>
        <View style={half}>
          <ReceiptBody d={d} copyLabel={design.labels.donorCopy} {...common} />
          <Marks d={d} t={t} design={design} images={images} box={{ w: 579, h: 394 }} />
        </View>
        <View style={{ borderTopWidth: 0.8, borderTopColor: '#999', borderTopStyle: 'dashed', marginHorizontal: 6, marginVertical: 5 }}>
          <Text style={{ position: 'absolute', top: -5, left: 260, fontSize: 6, color: '#999', backgroundColor: paperBg, paddingHorizontal: 3 }}>✂</Text>
        </View>
        <View style={half}>
          <ReceiptBody d={d} copyLabel={design.labels.officeCopy} {...common} />
          <Marks d={d} t={t} design={design} images={images} box={{ w: 579, h: 394 }} />
        </View>
      </Page>
    );
  }
  const dims = cfg.size === 'A4' ? { w: 595, h: 842 } : cfg.orientation === 'landscape' ? { w: 595, h: 420 } : { w: 420, h: 595 };
  return (
    <Page wrap={false} size={cfg.size} orientation={cfg.orientation} style={{ fontFamily: 'Hind', backgroundColor: paperBg, padding: cfg.size === 'A4' ? 18 : 10 }}>
      <ReceiptBody d={d} copyLabel={copyLabel} {...common} />
      <Marks d={d} t={t} design={design} images={images} box={dims} />
    </Page>
  );
}

/**
 * Donation receipt PDF. Pass `donation` (one receipt) or `donations` (bulk print – one receipt per page).
 * `qrs` = { [donationId]: dataUrl } (made in generate.js)
 */
export default function DonationReceiptPdf({ donation, donations, settings: t, categories = [], images = {}, qrs = {}, copyLabel, duplicate = false }) {
  const design = receiptDesignOf(t);
  const list = donations || [donation];
  return (
    <Document title={list.length === 1 ? `Receipt ${list[0].receiptNo || ''}` : `Receipts (${list.length})`} author={t.nameEn || t.name}>
      {list.map((d) => (
        <ReceiptPages key={d.id || d.receiptNo} d={d} t={t} design={design} categories={categories} images={images} qr={qrs[d.id || d.receiptNo]} copyLabel={copyLabel} duplicate={duplicate} />
      ))}
    </Document>
  );
}

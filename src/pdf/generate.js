'use client';

// Browser-side PDF generation. @react-pdf/renderer is loaded lazily so it
// doesn't bloat the first page load.

const blobToDataUrl = (blob) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => resolve(null);
  r.readAsDataURL(blob);
});

/** Fetch an image (uploaded images are served same-origin by /api/files/… to signed-in staff) */
async function fetchImageBlob(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`image ${res.status}`);
  return res.blob();
}

/**
 * PDF engine supports only PNG / JPEG. Any other format (WebP, GIF, SVG, HEIC …) and very large
 * pictures are redrawn on a canvas as PNG (keeps transparency of signatures / stamps).
 */
async function normalizeImage(blob, maxSide = 700) {
  const okType = blob.type === 'image/png' || blob.type === 'image/jpeg';
  const src = await blobToDataUrl(blob);
  const img = await new Promise((resolve, reject) => {
    const i = new window.Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  if (okType && scale === 1) return src;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((img.naturalWidth || maxSide) * scale));
  c.height = Math.max(1, Math.round((img.naturalHeight || maxSide) * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

const imageCache = new Map();
export async function toDataUrl(url) {
  if (!url) return null;
  if (imageCache.has(url)) return imageCache.get(url);
  try {
    const data = await normalizeImage(await fetchImageBlob(url));
    imageCache.set(url, data);
    return data;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('PDF image could not be loaded:', url, e);
    return null;
  }
}

/** Logo / deity images / signature / stamp for PDFs. Left box falls back to the logo. */
export async function loadImages(settings = {}) {
  const [left, right, signature, stamp, logo] = await Promise.all([
    toDataUrl(settings.leftImageUrl), toDataUrl(settings.rightImageUrl), toDataUrl(settings.signatureUrl), toDataUrl(settings.stampUrl), toDataUrl(settings.logoUrl),
  ]);
  return { left: left || logo, right, signature, stamp, logo };
}

async function render(element) {
  const { pdf } = await import('@react-pdf/renderer');
  const { registerFonts } = await import('./theme');
  registerFonts(`${window.location.origin}/fonts`);
  return pdf(element).toBlob();
}

export function openBlob(blob, fileName, download = false) {
  const url = URL.createObjectURL(blob);
  if (download) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    // popup blocked (Safari / iOS after async work) → fall back to a download
    const w = window.open(url, '_blank');
    if (!w) {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const safe = (s) => String(s || 'document').replace(/[\\/:*?"<>|]+/g, '-');

/** QR codes (data URLs) for receipts, keyed by donation id / receipt no. */
async function receiptQrs(list, settings) {
  const { receiptDesignOf, receiptQrText, receiptVerifyUrl } = await import('../lib/receiptDesign');
  const design = receiptDesignOf(settings);
  if (!design.show.qr) return {};
  const QR = (await import('qrcode')).default;
  // signed verification links (the server signs them; sample / unsaved receipts get plain text)
  let tokens = {};
  const ids = list.map((d) => d.id).filter((id) => id && id !== 'sample');
  if (ids.length) {
    try {
      const { rpcRead } = await import('../lib/api');
      tokens = (await rpcRead('receipts.verifyTokens', ids)) || {};
    } catch { tokens = {}; }
  }
  const out = {};
  await Promise.all(list.map(async (d) => {
    const text = tokens[d.id] ? receiptVerifyUrl(design, tokens[d.id]) : d.id === 'sample' ? receiptVerifyUrl(design, 'sample') : receiptQrText(d, settings);
    try { out[d.id || d.receiptNo] = await QR.toDataURL(text, { margin: 0, width: 220, errorCorrectionLevel: 'M' }); } catch { /* QR is optional */ }
  }));
  return out;
}

/** Build the receipt PDF blob. One donation (`donation`) or many (`donations`, one per page). */
export async function receiptBlob({ donation, donations, settings, categories = [], copyLabel, duplicate }) {
  const { default: Comp } = await import('./DonationReceiptPdf');
  const list = donations || [donation];
  const [images, qrs] = await Promise.all([loadImages(settings), receiptQrs(list, settings)]);
  return render(<Comp donation={donation} donations={donations} settings={settings} categories={categories} images={images} qrs={qrs} copyLabel={copyLabel} duplicate={duplicate} />);
}

/** Opens the browser print dialog for a PDF blob (hidden iframe). Falls back to a new tab. */
export function printBlob(blob, fileName = 'document.pdf') {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  iframe.src = url;
  let printed = false;
  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        printed = true;
      } catch {
        openBlob(blob, fileName, false);
      }
    }, 300);
  };
  document.body.appendChild(iframe);
  // iOS / some mobile browsers can't print a PDF inside an iframe → open it instead
  setTimeout(() => { if (!printed && /iPad|iPhone|iPod|Android/i.test(navigator.userAgent)) openBlob(blob, fileName, false); }, 2500);
  setTimeout(() => { URL.revokeObjectURL(url); iframe.remove(); }, 120_000);
}

/** Share the PDF (WhatsApp / mail …) with the Web Share API. Returns false when the browser can't share files. */
export async function shareBlob(blob, fileName, text) {
  try {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: fileName, text });
      return true;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return true; // user closed the share sheet
  }
  return false;
}

export const receiptFileName = (d) => `Receipt-${safe(d?.receiptNo || 'draft')}.pdf`;

/**
 * Donation receipt.
 * mode: 'open' (new tab) | 'download' | 'print' | 'share' | 'blob' (just return the blob)
 * (old callers pass download: true/false)
 */
export async function donationReceiptPdf({ donation, donations, settings, categories, download, mode, copyLabel, duplicate, shareText }) {
  const blob = await receiptBlob({ donation, donations, settings, categories, copyLabel, duplicate });
  const name = donations ? `Receipts-${donations.length}.pdf` : receiptFileName(donation);
  const m = mode || (download ? 'download' : 'open');
  if (m === 'blob') return blob;
  if (m === 'print') { printBlob(blob, name); return blob; }
  if (m === 'share') {
    if (await shareBlob(blob, name, shareText)) return blob;
    openBlob(blob, name, true); // can't share files here → download instead
    return blob;
  }
  openBlob(blob, name, m === 'download');
  return blob;
}

/** Donor's yearly donation statement (for 80G / income-tax) */
export async function donorStatementPdf({ donor, donations, settings, fyId, download = false, generatedBy }) {
  const { default: Comp } = await import('./DonorStatementPdf');
  const images = await loadImages(settings);
  const blob = await render(<Comp donor={donor} donations={donations} settings={settings} fyId={fyId} images={images} generatedBy={generatedBy} />);
  openBlob(blob, `Donation-statement-${safe(donor?.name)}-${fyId}.pdf`, download);
}

export async function paymentVoucherPdf({ expense, settings, download }) {
  const { default: Comp } = await import('./PaymentVoucherPdf');
  const images = await loadImages(settings);
  const blob = await render(<Comp expense={expense} settings={settings} images={images} />);
  openBlob(blob, `Voucher-${safe(expense.voucherNo)}.pdf`, download);
}

export async function reportPdf({ settings, title, filtersText, sections, generatedBy, landscape = true, download = true, labels }) {
  const { default: Comp } = await import('./ReportPdf');
  const logo = await toDataUrl(settings?.logoUrl || settings?.leftImageUrl);
  const blob = await render(<Comp settings={settings} title={title} filtersText={filtersText} sections={sections} generatedBy={generatedBy} landscape={landscape} labels={labels} logo={logo} />);
  openBlob(blob, `${safe(title)}.pdf`, download);
}

/** Form 10BE certificates (one page per donor) – rows from reports.form10bd */
export async function form10bePdf({ rows, settings, fyId, filing, download = false, fileName }) {
  const { default: Comp } = await import('./Form10BEPdf');
  const images = await loadImages(settings);
  const blob = await render(<Comp rows={rows} settings={settings} fyId={fyId} filing={filing} images={images} />);
  openBlob(blob, fileName || `Form-10BE-${fyId}.pdf`, download);
}

/** salary slips (two per A4) */
export async function payslipPdf({ slips, settings, staffMap, download = false }) {
  const { default: Comp } = await import('./PayslipPdf');
  const blob = await render(<Comp slips={slips} settings={settings} staffMap={staffMap} />);
  openBlob(blob, `Salary-slips-${slips[0]?.month || ''}.pdf`, download);
}

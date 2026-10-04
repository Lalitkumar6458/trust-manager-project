'use client';

// Browser-side PDF generation. @react-pdf/renderer is loaded lazily so it
// doesn't bloat the first page load.

const blobToDataUrl = (blob) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => resolve(null);
  r.readAsDataURL(blob);
});

/** Fetch an image: directly (needs Storage CORS) or through our same-origin proxy (/api/image) */
async function fetchImageBlob(url) {
  if (url.startsWith('data:')) return (await fetch(url)).blob();
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) return await res.blob();
  } catch { /* CORS not configured on the bucket – use the proxy */ }
  const res = await fetch(`/api/image?url=${encodeURIComponent(url)}`);
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

export async function donationReceiptPdf({ donation, settings, categories, download, copyLabel, duplicate }) {
  const { default: Comp } = await import('./DonationReceiptPdf');
  const images = await loadImages(settings);
  const blob = await render(<Comp donation={donation} settings={settings} categories={categories} images={images} copyLabel={copyLabel} duplicate={duplicate} />);
  openBlob(blob, `Receipt-${safe(donation.receiptNo)}.pdf`, download);
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

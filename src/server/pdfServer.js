import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { renderToBuffer } from '@react-pdf/renderer';
import QR from 'qrcode';
import { registerFonts } from '@/pdf/theme';
import DonationReceiptPdf from '@/pdf/DonationReceiptPdf';
import { receiptDesignOf, receiptQrText, receiptVerifyUrl } from '@/lib/receiptDesign';
import { resolveStored, MIME_BY_EXT } from './files';
import { verifyTokens } from './services/receiptVerify';
import { tenantKey, tenantBaseUrl } from './tenant';

// Receipt PDF made on the server (for email / WhatsApp sending and the donor portal).
// Same component as the browser download, so it looks exactly the same.

let fontsReady = false;
function fonts() {
  if (fontsReady) return;
  registerFonts(path.join(/* turbopackIgnore: true */ process.cwd(), 'public', 'fonts'));
  fontsReady = true;
}

const cache = new Map();
async function imageData(url) {
  if (!url) return null;
  const ck = `${await tenantKey()}|${url}`;
  if (cache.has(ck)) return cache.get(ck);
  let out = null;
  try {
    const m = /^\/api\/files\/(.+)$/.exec(String(url).split('?')[0]);
    if (m) {
      const file = await resolveStored(decodeURIComponent(m[1]));
      const ext = path.extname(file).slice(1).toLowerCase();
      if (['png', 'jpg', 'jpeg'].includes(ext)) out = `data:${MIME_BY_EXT[ext] || 'image/png'};base64,${(await fs.readFile(file)).toString('base64')}`;
    } else if (/^data:image\/(png|jpe?g);base64,/.test(url)) {
      out = url;
    }
  } catch { out = null; }
  cache.set(ck, out);
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return out;
}

export async function loadImagesServer(s = {}) {
  const [left, right, signature, stamp, logo] = await Promise.all([s.leftImageUrl, s.rightImageUrl, s.signatureUrl, s.stampUrl, s.logoUrl].map(imageData));
  return { left: left || logo, right, signature, stamp, logo };
}

/** public base URL for links in messages / QR codes */
export async function publicBase(settings = {}) {
  const d = receiptDesignOf(settings);
  return String(d.verifyBaseUrl || (await tenantBaseUrl()) || process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
}

export async function receiptPdfBuffer(donation, settings, categories = []) {
  fonts();
  const design = receiptDesignOf(settings);
  const qrs = {};
  if (design.show.qr) {
    let text = receiptQrText(donation, settings);
    const base = await publicBase(settings);
    if (base && donation.id) {
      const tok = (await verifyTokens([donation.id]))[donation.id];
      if (tok) text = receiptVerifyUrl({ ...design, verifyBaseUrl: base }, tok);
    }
    try { qrs[donation.id] = await QR.toDataURL(text, { margin: 0, width: 220, errorCorrectionLevel: 'M' }); } catch { /* optional */ }
  }
  const images = await loadImagesServer(settings);
  return renderToBuffer(<DonationReceiptPdf donation={donation} settings={settings} categories={categories} images={images} qrs={qrs} />);
}

/** Donor's yearly statement (donor portal) */
export async function statementPdfBuffer({ donor, donations, settings, fyId }) {
  fonts();
  const { default: DonorStatementPdf } = await import('@/pdf/DonorStatementPdf');
  const images = await loadImagesServer(settings);
  return renderToBuffer(<DonorStatementPdf donor={donor} donations={donations} settings={settings} fyId={fyId} images={images} generatedBy="Donor portal" />);
}

import 'server-only';
import nodemailer from 'nodemailer';
import { COL } from '@/lib/constants';
import { fmtDate, money } from '@/lib/format';
import { fetchAll, fetchOne, where, writeBatch, docRef, colRef, doc, serverTimestamp } from './services/db';
import { getSecrets } from './secrets';
import { receiptPdfBuffer } from './pdfServer';
import { currentTenant, runAsTenant } from './tenant';
import { hasFeatureNow } from './license';

// ------------------------------------------------------------------
// Messages to donors: Email (SMTP) and WhatsApp (Meta WhatsApp Cloud API).
// Non-secret settings live in settings/trust.messaging; passwords / tokens in app_secrets.
// Every attempt is written to message_logs (Settings → Messages shows them).
// ------------------------------------------------------------------

export const SECRET_KEYS = ['smtp_pass', 'wa_token'];
export const DEFAULT_MESSAGING = {
  emailEnabled: false,
  smtpHost: '', smtpPort: 587, smtpSecure: false, smtpUser: '', fromEmail: '', fromName: '',
  whatsappEnabled: false,
  waPhoneNumberId: '', waApiVersion: 'v21.0', waLanguage: 'hi',
  waReceiptTemplate: 'donation_receipt', waGreetingTemplate: 'donor_greeting', waReminderTemplate: 'pledge_reminder', waOtpTemplate: 'login_otp',
  autoReceiptEmail: false, autoReceiptWhatsApp: false,
  birthdayGreetings: false, anniversaryGreetings: false,
  pledgeReminders: true,
  emailSubject: 'दान रसीद / Donation receipt {receiptNo} – {trust}',
  emailBody: 'आदरणीय {name},\n\n{trust} को आपके {amount} के दान के लिए हार्दिक धन्यवाद। रसीद (नं. {receiptNo}, दिनांक {date}) संलग्न है।\n\nThank you for your generous donation of {amount}. Your receipt is attached.\n\nसादर,\n{trust}',
  greetingText: 'आदरणीय {name}, {occasion} की हार्दिक शुभकामनाएँ! – {trust}',
  reminderText: 'आदरणीय {name}, आपके संकल्प ({amount}) की अगली तिथि {date} है। धन्यवाद – {trust}',
};

export function messagingOf(settings = {}) {
  return { ...DEFAULT_MESSAGING, ...(settings.messaging || {}) };
}

const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));

/** 10-digit Indian mobile → 91XXXXXXXXXX (WhatsApp format) */
export function waNumber(mobile) {
  const d = String(mobile || '').replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  if (/^91[6-9]\d{9}$/.test(d)) return d;
  return null;
}
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));

async function log(entry) {
  const b = writeBatch();
  b.set(doc(colRef(COL.messageLogs)), { ...entry, error: entry.error ? String(entry.error).slice(0, 500) : '', createdAt: serverTimestamp() });
  await b.commit();
}

// ---------------- Email ----------------
let transport = null;
let transportKey = '';
async function mailer(cfg) {
  const { smtp_pass: pass } = await getSecrets(['smtp_pass']);
  const key = JSON.stringify([cfg.smtpHost, cfg.smtpPort, cfg.smtpSecure, cfg.smtpUser, pass]);
  if (!transport || key !== transportKey) {
    transport = nodemailer.createTransport({
      host: cfg.smtpHost, port: Number(cfg.smtpPort) || 587, secure: !!cfg.smtpSecure,
      auth: cfg.smtpUser ? { user: cfg.smtpUser, pass } : undefined,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    });
    transportKey = key;
  }
  return transport;
}

export async function sendEmail(settings, { to, subject, text, attachments = [] }) {
  const cfg = messagingOf(settings);
  if (!cfg.emailEnabled || !cfg.smtpHost) throw new Error('Email is not set up (Settings → Messages)');
  if (!isEmail(to)) throw new Error('No valid email address');
  const t = await mailer(cfg);
  const from = cfg.fromEmail ? `"${(cfg.fromName || settings.name || '').replace(/"/g, '')}" <${cfg.fromEmail}>` : cfg.smtpUser;
  const r = await t.sendMail({ from, to, subject, text, attachments });
  return r.messageId || 'sent';
}

// ---------------- WhatsApp Cloud API ----------------
async function waConfig(settings) {
  const cfg = messagingOf(settings);
  if (!cfg.whatsappEnabled || !cfg.waPhoneNumberId) throw new Error('WhatsApp is not set up (Settings → Messages)');
  const { wa_token: token } = await getSecrets(['wa_token']);
  if (!token) throw new Error('WhatsApp access token is missing (Settings → Messages)');
  return { cfg, token, base: `${process.env.WA_API_BASE || 'https://graph.facebook.com'}/${cfg.waApiVersion || 'v21.0'}/${cfg.waPhoneNumberId}` };
}

async function waCall(url, token, body, isForm = false) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(isForm ? {} : { 'Content-Type': 'application/json' }) },
    body: isForm ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `WhatsApp error ${res.status}`);
  return json;
}

async function waUploadPdf(w, buffer, fileName) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'application/pdf');
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), fileName);
  const r = await waCall(`${w.base}/media`, w.token, form, true);
  return r.id;
}

/**
 * Template message (business-initiated messages must use a template approved in Meta Business Manager).
 * params: body text parameters in order. document: { buffer, fileName } for a document header.
 */
export async function sendWhatsAppTemplate(settings, { to, template, params = [], document }) {
  const w = await waConfig(settings);
  const num = waNumber(to);
  if (!num) throw new Error('No valid mobile number');
  if (!template) throw new Error('WhatsApp template name is missing (Settings → Messages)');
  const components = [];
  if (document) {
    const id = await waUploadPdf(w, document.buffer, document.fileName);
    components.push({ type: 'header', parameters: [{ type: 'document', document: { id, filename: document.fileName } }] });
  }
  if (params.length) components.push({ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p ?? '').slice(0, 900) || '-' })) });
  const r = await waCall(`${w.base}/messages`, w.token, {
    messaging_product: 'whatsapp', to: num, type: 'template',
    template: { name: template, language: { code: w.cfg.waLanguage || 'hi' }, components },
  });
  return r?.messages?.[0]?.id || 'sent';
}

// ---------------- Receipts ----------------
const vars = (d, settings) => ({
  name: d.donor?.name || '', amount: money(d.amount), receiptNo: d.receiptNo || '', date: fmtDate(d.date), trust: settings.name || '',
});

/**
 * Send one receipt.
 * @param channels ['email','whatsapp']
 * @returns [{ channel, ok, error }]
 */
export async function sendReceipt(donationId, channels, user, { auto = false } = {}) {
  const [d, settings, categories] = await Promise.all([fetchOne(COL.donations, donationId), fetchOne(COL.settings, 'trust'), fetchAll(COL.donationCategories)]);
  if (!d) throw new Error('Donation not found');
  if (d.status === 'void') throw new Error('This receipt is cancelled');
  const s = settings || {};
  const cfg = messagingOf(s);
  // the donor master may have a newer mobile / email than the receipt snapshot
  const donor = d.donorId ? await fetchOne(COL.donors, d.donorId) : null;
  const email = donor?.email || d.donor?.email;
  const mobile = donor?.mobile || d.donor?.mobile;
  if (donor?.noMessages) return channels.map((channel) => ({ channel, ok: false, error: 'Donor has opted out of messages' }));
  let pdf = null;
  const getPdf = async () => { pdf = pdf || await receiptPdfBuffer(d, s, categories); return pdf; };
  const fileName = `Receipt-${String(d.receiptNo || 'draft').replace(/[^\w.-]+/g, '-')}.pdf`;
  const v = vars(d, s);
  const out = [];
  for (const channel of channels) {
    const base = { kind: 'receipt', channel, refId: d.id, ref: d.receiptNo, donorId: d.donorId || null, toName: d.donor?.name || '', auto, by: user?.name || 'System', byUid: user?.uid || null };
    try {
      let id;
      if (channel === 'email') {
        if (!email) throw new Error('Donor has no email');
        // eslint-disable-next-line no-await-in-loop
        id = await sendEmail(s, { to: email, subject: fill(cfg.emailSubject, v), text: fill(cfg.emailBody, v), attachments: [{ filename: fileName, content: await getPdf(), contentType: 'application/pdf' }] });
        base.to = email;
      } else if (channel === 'whatsapp') {
        if (!mobile) throw new Error('Donor has no mobile');
        // eslint-disable-next-line no-await-in-loop
        id = await sendWhatsAppTemplate(s, { to: mobile, template: cfg.waReceiptTemplate, params: [v.name, v.amount, v.receiptNo], document: { buffer: await getPdf(), fileName } });
        base.to = mobile;
      } else throw new Error('Unknown channel');
      // eslint-disable-next-line no-await-in-loop
      await log({ ...base, status: 'sent', providerId: id });
      out.push({ channel, ok: true });
    } catch (e) {
      // eslint-disable-next-line no-await-in-loop
      await log({ ...base, to: base.to || (channel === 'email' ? email : mobile) || '', status: 'failed', error: e.message });
      out.push({ channel, ok: false, error: e.message });
    }
  }
  return out;
}

/** After approval: send automatically if switched on (runs in the background, never blocks the save) */
export function autoSendReceipt(donationId) {
  // remember the sanstha now – the timer runs after the request has finished
  const tenantP = currentTenant().catch(() => null);
  setTimeout(async () => {
    const t = await tenantP;
    if (t) runAsTenant(t, () => autoSendNow(donationId));
    else autoSendNow(donationId);
  }, 300);
}

async function autoSendNow(donationId) {
  {
    try {
      if (!(await hasFeatureNow('messaging'))) return; // not in the plan
      const s = (await fetchOne(COL.settings, 'trust')) || {};
      const cfg = messagingOf(s);
      const ch = [cfg.emailEnabled && cfg.autoReceiptEmail && 'email', cfg.whatsappEnabled && cfg.autoReceiptWhatsApp && 'whatsapp'].filter(Boolean);
      if (!ch.length) return;
      const d = await fetchOne(COL.donations, donationId);
      if (!d || d.status !== 'approved') return;
      const donor = d.donorId ? await fetchOne(COL.donors, d.donorId) : null;
      const has = ch.filter((c) => (c === 'email' ? (donor?.email || d.donor?.email) : (donor?.mobile || d.donor?.mobile)));
      if (has.length) await sendReceipt(donationId, has, { name: 'Auto', uid: 'system' }, { auto: true });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('auto receipt failed', donationId, e.message);
    }
  }
}

/** Free text message to a donor (greeting / reminder). WhatsApp uses the named template with {params}. */
export async function sendDonorMessage(settings, { donor, kind, text, template, params, ref }) {
  const cfg = messagingOf(settings);
  const results = [];
  const base = { kind, refId: ref || donor.id, ref: ref || '', donorId: donor.id, toName: donor.name, auto: true, by: 'System', byUid: 'system' };
  if (donor.noMessages) return results;
  if (cfg.whatsappEnabled && donor.mobile && template) {
    try {
      const id = await sendWhatsAppTemplate(settings, { to: donor.mobile, template, params });
      await log({ ...base, channel: 'whatsapp', to: donor.mobile, status: 'sent', providerId: id });
      results.push({ channel: 'whatsapp', ok: true });
    } catch (e) {
      await log({ ...base, channel: 'whatsapp', to: donor.mobile, status: 'failed', error: e.message });
      results.push({ channel: 'whatsapp', ok: false, error: e.message });
    }
  }
  if (cfg.emailEnabled && donor.email && (!results.some((r) => r.ok))) {
    try {
      const id = await sendEmail(settings, { to: donor.email, subject: `${settings.name || ''}`, text });
      await log({ ...base, channel: 'email', to: donor.email, status: 'sent', providerId: id });
      results.push({ channel: 'email', ok: true });
    } catch (e) {
      await log({ ...base, channel: 'email', to: donor.email, status: 'failed', error: e.message });
      results.push({ channel: 'email', ok: false, error: e.message });
    }
  }
  return results;
}

export const fillTemplate = fill;

/** Settings → Messages → "Send test" */
export async function sendTest(settings, { channel, to }) {
  if (channel === 'email') {
    return sendEmail(settings, { to, subject: `Test – ${settings.name || 'Trust Manager'}`, text: 'Email is working. / ईमेल सही से काम कर रहा है।' });
  }
  const cfg = messagingOf(settings);
  return sendWhatsAppTemplate(settings, { to, template: cfg.waGreetingTemplate, params: ['Test', 'Test', settings.name || ''] });
}

export { docRef };

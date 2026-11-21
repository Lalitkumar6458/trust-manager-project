import { NextResponse } from 'next/server';
import { withUser, assertSameOrigin } from '@/server/http';
import { assertCan } from '@/server/access';
import { uploadDocument, uploadSettingsImage } from '@/server/services/documents';
import { MAX_FILE_MB } from '@/lib/uploadRules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * multipart/form-data:
 *   kind=document  file, meta (JSON)  → supporting document  → { id }
 *   kind=settings  file, key          → logo / signature …   → { url }
 */
export const POST = withUser(async (req, user) => {
  assertSameOrigin(req);
  const form = await req.formData();
  const f = form.get('file');
  if (!f || typeof f === 'string') throw Object.assign(new Error('No file'), { status: 400 });
  if (f.size > MAX_FILE_MB * 1024 * 1024) throw Object.assign(new Error(`File too large (max ${MAX_FILE_MB} MB)`), { status: 400 });
  const file = { buffer: Buffer.from(await f.arrayBuffer()), name: f.name || 'file', type: f.type || '', size: f.size };
  if (form.get('kind') === 'settings') {
    assertCan(user, 'settings.manage');
    return NextResponse.json({ url: await uploadSettingsImage(file, String(form.get('key') || 'image')) });
  }
  assertCan(user, 'documents.upload', 'donations.create', 'expenses.create');
  let meta = {};
  try { meta = JSON.parse(String(form.get('meta') || '{}')); } catch { /* ignore */ }
  return NextResponse.json({ id: await uploadDocument(file, meta, user) });
});

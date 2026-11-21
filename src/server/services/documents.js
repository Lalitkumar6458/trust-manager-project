import 'server-only';
import { buildKeywords } from '@/lib/keywords';
import { COL } from '@/lib/constants';
import { fyIdOf, todayStr } from '@/lib/format';
import { MAX_FILE_MB, ALLOWED_TYPES } from '@/lib/uploadRules';
import { saveFile } from '../files';
import { colRef, doc, docRef, writeBatch, db, createdStamp, writeAudit, updatedStamp, fetchOne } from './db';

/**
 * Stores an uploaded supporting document on disk and registers it in `documents`.
 * @param {{ buffer, name, type, size }} file
 * @param {{docType, linkedType, linkedId, linkedRef, financialYearId, notes}} meta
 */
export async function uploadDocument(file, meta, user) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`File too large (max ${MAX_FILE_MB} MB)`);
  if (file.type && !ALLOWED_TYPES.includes(file.type)) throw new Error('Allowed: PDF, images, Excel, CSV, Word');
  const id = doc(colRef(COL.documents)).id;
  const dir = `documents/${meta.linkedType || 'general'}/${meta.linkedId || 'general'}`;
  const { storagePath, url } = await saveFile(file.buffer, dir, file.name);
  const batch = writeBatch(db);
  batch.set(docRef(COL.documents, id), {
    name: file.name,
    docType: meta.docType || 'Other',
    linkedType: meta.linkedType || 'general',
    linkedId: meta.linkedId || null,
    linkedRef: meta.linkedRef || '',
    financialYearId: meta.financialYearId || fyIdOf(todayStr()),
    storagePath,
    url,
    size: file.size,
    contentType: file.type || '',
    notes: meta.notes || '',
    status: 'active',
    searchKeywords: buildKeywords({ names: [String(file.name).replace(/\.[a-z0-9]+$/i, ''), meta.notes], exact: [meta.linkedRef] }),
    ...createdStamp(user),
  });
  writeAudit(batch, user, { collection: COL.documents, docId: id, ref: file.name, action: 'upload', summary: `${meta.docType || 'Document'} uploaded${meta.linkedRef ? ` for ${meta.linkedRef}` : ''}` });
  await batch.commit();
  return id;
}

/** Documents are never deleted – they are archived (hidden by default) */
export async function archiveDocument(id, reason, user) {
  const d = await fetchOne(COL.documents, id);
  if (!d) throw new Error('Document not found');
  const batch = writeBatch(db);
  batch.update(docRef(COL.documents, id), { status: 'archived', archiveReason: reason || '', ...updatedStamp(user) });
  writeAudit(batch, user, { collection: COL.documents, docId: id, ref: d.name, action: 'archive', reason });
  await batch.commit();
}

/** Settings image (logo, deity images, signature, stamp) → URL */
export async function uploadSettingsImage(file, key) {
  if (!String(file.type).startsWith('image/')) throw new Error('Select an image file');
  if (file.size > 2 * 1024 * 1024) throw new Error('Image must be under 2 MB');
  const { url } = await saveFile(file.buffer, 'settings', `${String(key).replace(/\W/g, '')}_${file.name}`);
  return url;
}

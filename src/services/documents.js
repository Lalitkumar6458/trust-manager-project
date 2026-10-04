'use client';

import { ref as sRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { COL } from '@/lib/constants';
import { fyIdOf, todayStr } from '@/lib/format';
import { colRef, doc, docRef, writeBatch, db, createdStamp, writeAudit, updatedStamp } from './db';

export const MAX_FILE_MB = 15;
export const ALLOWED_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
];

const safeName = (n) => n.replace(/[^\w.\-()ऀ-ॿ ]+/g, '_').slice(0, 120);

/**
 * Upload a supporting document to Firebase Storage and register it in `documents`.
 * @param {File} file
 * @param {{docType, linkedType, linkedId, linkedRef, financialYearId, notes}} meta
 */
export async function uploadDocument(file, meta, user, onProgress) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`File too large (max ${MAX_FILE_MB} MB)`);
  if (file.type && !ALLOWED_TYPES.includes(file.type)) throw new Error('Allowed: PDF, images, Excel, CSV, Word');
  const id = doc(colRef(COL.documents)).id;
  const path = `documents/${meta.linkedType || 'general'}/${meta.linkedId || 'general'}/${id}_${safeName(file.name)}`;
  const task = uploadBytesResumable(sRef(storage, path), file, {
    contentType: file.type || 'application/octet-stream',
    customMetadata: { uploadedBy: user.uid, docType: meta.docType || 'Other' },
  });
  await new Promise((resolve, reject) => {
    task.on('state_changed', (s) => onProgress?.(Math.round((s.bytesTransferred / s.totalBytes) * 100)), reject, resolve);
  });
  const url = await getDownloadURL(task.snapshot.ref);
  const batch = writeBatch(db);
  batch.set(docRef(COL.documents, id), {
    name: file.name,
    docType: meta.docType || 'Other',
    linkedType: meta.linkedType || 'general',
    linkedId: meta.linkedId || null,
    linkedRef: meta.linkedRef || '',
    financialYearId: meta.financialYearId || fyIdOf(todayStr()),
    storagePath: path,
    url,
    size: file.size,
    contentType: file.type || '',
    notes: meta.notes || '',
    status: 'active',
    ...createdStamp(user),
  });
  writeAudit(batch, user, { collection: COL.documents, docId: id, ref: file.name, action: 'upload', summary: `${meta.docType} uploaded${meta.linkedRef ? ` for ${meta.linkedRef}` : ''}` });
  await batch.commit();
  return id;
}

/** Documents are never deleted – they are archived (hidden by default) */
export async function archiveDocument(d, reason, user) {
  const batch = writeBatch(db);
  batch.update(docRef(COL.documents, d.id), { status: 'archived', archiveReason: reason || '', ...updatedStamp(user) });
  writeAudit(batch, user, { collection: COL.documents, docId: d.id, ref: d.name, action: 'archive', reason });
  await batch.commit();
}

/** Upload a settings image (logo, deity images, signature, stamp) */
export async function uploadSettingsImage(file, key) {
  if (!file.type.startsWith('image/')) throw new Error('Select an image file');
  if (file.size > 2 * 1024 * 1024) throw new Error('Image must be under 2 MB');
  const path = `settings/${key}_${Date.now()}_${safeName(file.name)}`;
  const task = await uploadBytesResumable(sRef(storage, path), file, { contentType: file.type });
  return getDownloadURL(task.ref);
}

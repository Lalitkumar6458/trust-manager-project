'use client';

import { rpc, upload } from '@/lib/api';

export { MAX_FILE_MB, ALLOWED_TYPES } from '@/lib/uploadRules';

/**
 * Upload a supporting document (stored on the server) and register it.
 * @param {File} file
 * @param {{docType, linkedType, linkedId, linkedRef, financialYearId, notes}} meta
 */
export async function uploadDocument(file, meta, _user, onProgress) {
  const { id } = await upload({ kind: 'document', file, meta }, onProgress);
  return id;
}

/** Documents are never deleted – they are archived (hidden by default) */
export const archiveDocument = (d, reason) => rpc('documents.archive', d.id, reason || '');

/** Upload a settings image (logo, deity images, signature, stamp) → URL */
export async function uploadSettingsImage(file, key) {
  if (!file.type.startsWith('image/')) throw new Error('Select an image file');
  if (file.size > 2 * 1024 * 1024) throw new Error('Image must be under 2 MB');
  const { url } = await upload({ kind: 'settings', file, key });
  return url;
}

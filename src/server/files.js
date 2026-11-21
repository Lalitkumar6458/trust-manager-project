import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { tenantKey } from './tenant';

// ------------------------------------------------------------------
// Uploaded files (supporting documents, logo / signature images) are kept on the
// server's disk in UPLOAD_DIR and served only to signed-in staff by /api/files/….
// Back this folder up together with the database (see deploy/backup.sh).
// ------------------------------------------------------------------
export const uploadBase = () => path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'uploads'));
/** upload folder of the current sanstha (multi-sanstha: <UPLOAD_DIR>/<slug>) */
export async function uploadRoot() {
  const k = await tenantKey();
  return k ? path.join(uploadBase(), k) : uploadBase();
}

const safeName = (n) => String(n || 'file').replace(/[^\w.\-()ऀ-ॿ ]+/g, '_').replace(/\s+/g, '_').slice(0, 120);

export const MIME_BY_EXT = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', txt: 'text/plain',
};

/** Saves bytes under <root>/<dir>/<random>_<name>; returns { storagePath, url } */
export async function saveFile(buffer, dir, name) {
  const rel = path.posix.join(dir.replace(/[^\w/\-]/g, '_'), `${crypto.randomBytes(6).toString('hex')}_${safeName(name)}`);
  const abs = path.join(await uploadRoot(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return { storagePath: rel, url: `/api/files/${rel.split('/').map(encodeURIComponent).join('/')}` };
}

/** Absolute path of a stored file – refuses anything outside the upload folder */
export async function resolveStored(rel) {
  const root = await uploadRoot();
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) throw new Error('Bad path');
  return abs;
}

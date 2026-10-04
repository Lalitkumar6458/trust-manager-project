// Server-only Firebase Admin SDK (used by Next.js API route handlers).
import 'server-only';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function init() {
  if (getApps().length) return getApps()[0];
  const { FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY } = process.env;
  if (FIREBASE_ADMIN_PROJECT_ID && FIREBASE_ADMIN_CLIENT_EMAIL && FIREBASE_ADMIN_PRIVATE_KEY) {
    return initializeApp({
      credential: cert({
        projectId: FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }
  // Works automatically on Firebase App Hosting / Cloud Run (application default credentials)
  return initializeApp();
}

export function adminAuth() {
  return getAuth(init());
}

export function adminDb() {
  return getFirestore(init());
}

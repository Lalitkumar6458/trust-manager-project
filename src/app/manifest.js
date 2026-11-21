import { fetchOne } from '@/server/services/db';
import { COL } from '@/lib/constants';

// Web app manifest – "Add to home screen" on phones (PWA).
export const dynamic = 'force-dynamic';

export default async function manifest() {
  let t = {};
  try { t = (await fetchOne(COL.settings, 'trust')) || {}; } catch { /* database not ready */ }
  const name = t.name || 'Trust Manager';
  return {
    name,
    short_name: (t.shortName || t.nameEn || name).slice(0, 20).trim(),
    description: 'Donation, receipt & accounting panel',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f5f3ef',
    theme_color: '#7d1a12',
    lang: 'hi',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Quick donation', short_name: 'Quick entry', url: '/donations/quick', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Donations', url: '/donations' },
    ],
  };
}

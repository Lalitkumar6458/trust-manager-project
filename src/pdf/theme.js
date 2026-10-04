// Shared PDF styling. Hind font has both Devanagari and Latin glyphs (incl. ₹),
// so Hindi + English + digits render with correct shaping in one font.
import { Font } from '@react-pdf/renderer';

let registered = false;

/** @param {string} base URL prefix or folder where Hind-*.ttf live */
export function registerFonts(base = '/fonts') {
  if (registered) return;
  Font.register({
    family: 'Hind',
    fonts: [
      { src: `${base}/Hind-Regular.ttf`, fontWeight: 400 },
      { src: `${base}/Hind-Medium.ttf`, fontWeight: 500 },
      { src: `${base}/Hind-SemiBold.ttf`, fontWeight: 600 },
      { src: `${base}/Hind-Bold.ttf`, fontWeight: 700 },
    ],
  });
  // never hyphenate Hindi / reference numbers
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

export const C = {
  maroon: '#7d1a12',
  red: '#a4161a',
  saffron: '#e07a1f',
  gold: '#c8963e',
  paper: '#fcf3dc',
  paperDark: '#f5e4bb',
  ink: '#2a1a12',
  line: '#7d1a12',
  muted: '#6b5a4a',
};

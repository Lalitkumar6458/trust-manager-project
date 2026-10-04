'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import hi from './hi';

/**
 * Lightweight i18n.
 *  - English is the default language and the translation key (t('Save') → 'Save').
 *  - Hindi strings live in ./hi.js (English text → Hindi text).
 *  - Variables: t('{n} record(s)', { n: 5 }).
 *  - Missing Hindi entries fall back to English, so nothing ever breaks.
 */
export const LANGS = [
  { value: 'en', label: 'English', short: 'EN' },
  { value: 'hi', label: 'हिन्दी', short: 'हिं' },
];
const KEY = 'tm.lang';

const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? vars[k] : m)) : s);

export function translate(lang, s, vars) {
  if (s === null || s === undefined || s === '') return s;
  if (typeof s !== 'string') return s;
  return fill(lang === 'hi' ? (hi[s] ?? s) : s, vars);
}

const LangContext = createContext({
  lang: 'en', setLang: () => {}, t: (s, v) => fill(s, v), pick: (en) => en, isHi: false,
});

export function LangProvider({ children }) {
  const [lang, setLangState] = useState('en');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === 'hi' || saved === 'en') setLangState(saved);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l) => {
    setLangState(l);
    try { window.localStorage.setItem(KEY, l); } catch { /* ignore */ }
  }, []);

  const value = useMemo(() => ({
    lang,
    isHi: lang === 'hi',
    setLang,
    t: (s, vars) => translate(lang, s, vars),
    /** choose Hindi value when available in Hindi mode (e.g. category nameHi) */
    pick: (en, hiVal) => (lang === 'hi' && hiVal ? hiVal : en),
  }), [lang, setLang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

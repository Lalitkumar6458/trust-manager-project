'use client';

import { useEffect } from 'react';
import { App as AntApp, ConfigProvider } from 'antd';
import enGB from 'antd/locale/en_GB';
import hiIN from 'antd/locale/hi_IN';
import dayjs from 'dayjs';
import 'dayjs/locale/en-gb';
import 'dayjs/locale/hi';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import isBetween from 'dayjs/plugin/isBetween';
import { AuthProvider } from '@/contexts/AuthContext';
import { AppDataProvider } from '@/contexts/AppDataContext';
import { LangProvider, useLang } from '@/i18n/LangContext';

dayjs.extend(customParseFormat);
dayjs.extend(isBetween);

const theme = {
  token: {
    colorPrimary: '#8f2d1f',
    colorLink: '#8f2d1f',
    borderRadius: 8,
    fontFamily: "'Hind', -apple-system, 'Segoe UI', Roboto, sans-serif",
    fontSize: 14,
  },
  components: {
    Layout: { siderBg: '#2b1712', headerBg: '#ffffff', bodyBg: '#f5f3ef' },
    Menu: { darkItemBg: '#2b1712', darkSubMenuItemBg: '#22120e', darkItemSelectedBg: '#8f2d1f' },
    Table: { headerBg: '#f7efe3' },
  },
};

function Themed({ children }) {
  const { lang } = useLang();
  // antd form.validateFields() rejects with { errorFields } when a field is invalid – the form already
  // shows the error, so don't let it surface as an "Uncaught (in promise)" error.
  // browser crashes → error log (System health)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return undefined;
    let sent = 0;
    const send = (message, stack) => {
      if (sent > 5 || !message || /ResizeObserver|Script error|errorFields/.test(message)) return;
      sent += 1;
      fetch('/api/log-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, stack, path: window.location.pathname }) }).catch(() => {});
    };
    const onErr = (e) => send(e.message, e.error?.stack);
    const onRej = (e) => { if (!Array.isArray(e.reason?.errorFields)) send(String(e.reason?.message || e.reason), e.reason?.stack); };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => { window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej); };
  }, []);
  // installable app (PWA) – service worker only in production builds
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* not critical */ });
    }
  }, []);
  useEffect(() => {
    const h = (e) => { if (e.reason && Array.isArray(e.reason.errorFields)) e.preventDefault(); };
    window.addEventListener('unhandledrejection', h);
    return () => window.removeEventListener('unhandledrejection', h);
  }, []);
  // month / weekday names in date pickers follow the UI language
  dayjs.locale(lang === 'hi' ? 'hi' : 'en-gb');
  return (
    <ConfigProvider theme={theme} locale={lang === 'hi' ? hiIN : enGB}>
      <AntApp>
        <AuthProvider>
          <AppDataProvider>{children}</AppDataProvider>
        </AuthProvider>
      </AntApp>
    </ConfigProvider>
  );
}

export default function Providers({ children }) {
  return (
    <LangProvider>
      <Themed>{children}</Themed>
    </LangProvider>
  );
}

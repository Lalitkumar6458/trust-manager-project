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

'use client';

import { Result, Button } from 'antd';
import { useLang } from '@/i18n/LangContext';

export default function NotFound() {
  const { t: tr } = useLang();
  return (
    <div style={{ minHeight: '80vh', display: 'grid', placeItems: 'center' }}>
      <Result status="404" title="404" subTitle={tr('This page does not exist.')} extra={<Button type="primary" href="/dashboard">{tr('Dashboard')}</Button>} />
    </div>
  );
}

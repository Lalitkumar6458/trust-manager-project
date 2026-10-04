'use client';

import { useEffect } from 'react';
import { Result, Button, Space, Typography } from 'antd';
import { useLang } from '@/i18n/LangContext';

/** Any crash inside a panel page shows this instead of a blank screen; the menu stays usable. */
export default function PanelError({ error, reset }) {
  const { t: tr } = useLang();
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);
  return (
    <Result
      status="error"
      title={tr('Something went wrong on this page')}
      subTitle={<Typography.Text type="secondary">{tr('Your data is safe. Try again, or go back to the dashboard. If it keeps happening, send this message to your administrator:')} <code>{error?.message}</code></Typography.Text>}
      extra={(
        <Space>
          <Button type="primary" onClick={() => reset()}>{tr('Try again')}</Button>
          <Button href="/dashboard">{tr('Dashboard')}</Button>
        </Space>
      )}
    />
  );
}

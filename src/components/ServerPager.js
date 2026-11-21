'use client';

import { Button, Space, Typography, Alert } from 'antd';
import { LeftOutlined, RightOutlined, VerticalLeftOutlined, VerticalRightOutlined } from '@ant-design/icons';
import { useLang } from '@/i18n/LangContext';

/** First / Previous / Next / Last for a useServerTable() result */
export default function ServerPager({ table }) {
  const { t: tr } = useLang();
  const t = table;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {t.total === null ? tr('Loading…') : tr('{v0}–{v1} of {v2}', { v0: t.from.toLocaleString('en-IN'), v1: t.to.toLocaleString('en-IN'), v2: t.total.toLocaleString('en-IN') })}
      </Typography.Text>
      <Space size={4}>
        <Button size="small" icon={<VerticalRightOutlined />} disabled={!t.hasPrev || t.loading} onClick={t.first} aria-label={tr('First page')} />
        <Button size="small" icon={<LeftOutlined />} disabled={!t.hasPrev || t.loading} onClick={t.prev}>{tr('Previous')}</Button>
        <Typography.Text style={{ padding: '0 8px', fontSize: 13 }}>{tr('Page {v0} of {v1}', { v0: t.page + 1, v1: t.pageCount ?? '…' })}</Typography.Text>
        <Button size="small" disabled={!t.hasNext || t.loading} onClick={t.next}>{tr('Next')} <RightOutlined /></Button>
        <Button size="small" icon={<VerticalLeftOutlined />} disabled={!t.hasNext || t.loading} onClick={t.last} aria-label={tr('Last page')} />
      </Space>
    </div>
  );
}

/** Shown when the server could not load the list */
export function ServerError({ table }) {
  const { t: tr } = useLang();
  if (!table.error) return null;
  return <Alert type="error" showIcon style={{ marginBottom: 12 }} title={tr(table.error.message || 'Something went wrong')} />;
}

/** One line under the filters explaining what the server is doing */
export function ServerHint({ mode }) {
  const { t: tr } = useLang();
  const text = {
    search: tr('Searching the whole year on the server (name, receipt / voucher no., mobile, PAN, UTR) together with the other filters.'),
  }[mode] || tr('Filters run on the server over the whole year – 100 rows per page. Export / Print include every matching row.');
  return <div className="muted" style={{ fontSize: 12, margin: '-4px 0 8px' }}>{text}</div>;
}

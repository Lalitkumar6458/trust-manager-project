'use client';

import Link from 'next/link';
import { Card, Table, Tag, Button, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { Guard, PageHeader, Money } from '@/components/common';
import { useAuth } from '@/contexts/AuthContext';
import { useAction, useLiveQuery } from '@/lib/hooks';
import { rpc } from '@/lib/api';
import { orderBy, limit } from '@/lib/q';
import { COL } from '@/lib/constants';
import { fmtDateTime } from '@/lib/format';
import { useLang } from '@/i18n/LangContext';

const COLORS = { paid: 'green', created: 'default', processing: 'blue', failed: 'red', paid_unrecorded: 'orange' };

export default function OnlineDonationsPage() {
  const { t: tr } = useLang();
  const { can } = useAuth();
  const [run, busy] = useAction();
  const { data, loading } = useLiveQuery(COL.onlinePayments, [orderBy('createdAt', 'desc'), limit(500)], []);
  const label = { paid: tr('Paid – receipt made'), created: tr('Started (not paid)'), processing: tr('Processing'), failed: tr('Failed'), paid_unrecorded: tr('Paid – receipt NOT made') };
  return (
    <Guard perm="online.view">
      <PageHeader title={tr('Online donations')} subtitle={tr('Payments from the public donation page (Razorpay).')} extra={[<a key="d" href="/donate" target="_blank" rel="noreferrer"><Button>{tr('Open donation page')}</Button></a>]} />
      <Card size="small">
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={data}
          scroll={{ x: 900 }}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          columns={[
            { title: tr('When'), dataIndex: 'createdAt', render: fmtDateTime, width: 150 },
            { title: tr('Donor'), render: (_, r) => <span>{r.donor?.name}<br /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.donor?.mobile} {r.donor?.email}</Typography.Text></span> },
            { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> },
            { title: 'Razorpay', render: (_, r) => <Typography.Text style={{ fontSize: 12 }}>{r.orderId}<br />{r.paymentId || ''} {r.method ? `(${r.method})` : ''}</Typography.Text> },
            { title: tr('Status'), dataIndex: 'status', render: (v, r) => <span><Tag color={COLORS[v]}>{label[v] || v}</Tag>{r.error ? <div style={{ fontSize: 11, color: '#a8071a' }}>{r.error}</div> : null}</span> },
            {
              title: '', width: 140,
              render: (_, r) => (r.donationId ? <Link href={`/donations/${r.donationId}`}>{tr('Open receipt')}</Link>
                : r.status === 'paid_unrecorded' && can('donations.approve') ? <Button size="small" icon={<ReloadOutlined />} loading={busy} onClick={() => run(() => rpc('online.retry', r.id), 'Receipt created')}>{tr('Retry')}</Button> : null),
            },
          ]}
        />
      </Card>
    </Guard>
  );
}

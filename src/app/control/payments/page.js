'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, Table, Typography, DatePicker, Space, Button, Statistic, Tag } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useControl } from '@/components/control/ControlShell';
import { inr, dmy, dmyt } from '@/components/control/bits';

export default function PaymentsPage() {
  const [range, setRange] = useState(null);
  const filter = range ? { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') } : {};
  const [rows, loading] = useControl('payments.list', filter);
  const live = (rows || []).filter((r) => !r.voided_at);
  const total = live.reduce((s, r) => s + Number(r.amount), 0);
  const csv = () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Receipt', 'Date', 'Sanstha', 'Amount', 'Via', 'Reference', 'Months', 'From', 'To', 'Source', 'Voided'].join(','),
      ...(rows || []).map((r) => [r.receipt_no, dmyt(r.created_at), r.tenant_name, r.amount, r.method, r.reference, r.months, r.period_from, r.period_to, r.source, r.voided_at ? r.void_reason : ''].map(q).join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv' }));
    a.download = 'subscription-payments.csv';
    a.click();
  };
  return (
    <div>
      <Typography.Title level={3}>Payments</Typography.Title>
      <Card size="small">
        <Space wrap style={{ marginBottom: 8, width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <DatePicker.RangePicker format="DD-MM-YYYY" value={range} onChange={setRange} />
            <Button icon={<DownloadOutlined />} onClick={csv} disabled={!rows?.length}>CSV</Button>
          </Space>
          <Statistic title={`Total (${live.length})`} value={inr(total)} />
        </Space>
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={rows || []}
          scroll={{ x: 900 }}
          pagination={{ pageSize: 50 }}
          columns={[
            { title: 'No.', dataIndex: 'receipt_no' },
            { title: 'Date', dataIndex: 'created_at', render: dmyt },
            { title: 'Sanstha', render: (_, r) => <Link href={`/control/tenants/${r.tenant_id}`}>{r.tenant_name}</Link> },
            { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v, r) => (r.voided_at ? <s>{inr(v)}</s> : inr(v)) },
            { title: 'Via', render: (_, r) => <span>{r.method}{r.source === 'razorpay' ? <Tag color="blue" style={{ marginLeft: 4 }}>online</Tag> : null}</span> },
            { title: 'Reference', dataIndex: 'reference' },
            { title: 'Period', render: (_, r) => (r.months ? `${dmy(r.period_from)} → ${dmy(r.period_to)}` : '—') },
            { title: '', render: (_, r) => (r.voided_at ? <Tag>Voided</Tag> : null) },
          ]}
        />
      </Card>
    </div>
  );
}

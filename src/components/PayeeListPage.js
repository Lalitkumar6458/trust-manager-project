'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Table, Input, Space, Tag } from 'antd';
import { where } from '@/lib/q';
import { PlusOutlined } from '@ant-design/icons';
import { COL, PAYEE_TYPES } from '@/lib/constants';
import { fmtDate, maskAccount, sum } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader, Money, Guard } from '@/components/common';
import ExportButtons from '@/components/ExportButtons';
import { PayeeModal } from '@/components/PartyForms';
import { useServerTable, useDebounced, useAsyncValue } from '@/lib/useServerTable';
import { normalizeSearch } from '@/lib/keywords';
import ServerPager, { ServerError } from '@/components/ServerPager';
import { useLang } from '@/i18n/LangContext';

const typeLabel = (t) => PAYEE_TYPES.find((p) => p.value === t)?.label || t;

export default function PayeeListPage({ types, title, defaultType }) {
  const { t: tr } = useLang();
  const router = useRouter();
  const { can } = useAuth();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  // everything runs in PostgreSQL: 100 per page (biggest first); search on the server over all records
  const term = normalizeSearch(useDebounced(text));
  const searching = term.length >= 2;
  const cons = [where('type', 'in', types)];
  if (searching) cons.push(where('searchKeywords', 'array-contains', term));
  const key = JSON.stringify([types, searching ? term : '']);
  const table = useServerTable(COL.beneficiaries, cons, { order: ['totalAmount', 'desc'], key });
  const { rows, loading } = table;
  const count = table.total;
  const total = useAsyncValue(async () => (await table.sumOf(['totalAmount'])).totalAmount || 0, [key, table.rows], null);

  const cols = [
    { title: tr('ID'), key: 'code' },
    { title: tr('Name'), key: 'name', width: 2 },
    { title: tr('Type'), key: 'type', value: (r) => tr(typeLabel(r.type)) },
    { title: tr('Mobile'), key: 'mobile' },
    { title: tr('PAN'), key: 'pan' },
    { title: tr('GSTIN'), key: 'gstin' },
    { title: tr('Bank A/c'), key: 'bank', value: (r) => maskAccount(r.bankAccountNo) },
    { title: tr('IFSC'), key: 'ifsc' },
    { title: tr('Payments'), key: 'paymentCount' },
    { title: tr('Last paid'), key: 'lastPaymentDate', value: (r) => fmtDate(r.lastPaymentDate) },
    { title: tr('Total received'), key: 'totalAmount', money: true },
  ];

  return (
    <Guard perm="beneficiaries.view">
      <PageHeader
        title={title}
        subtitle={tr('{v0} record(s) · total paid ₹{v1}', { v0: count ?? rows.length, v1: Number(total ?? sum(rows, (r) => r.totalAmount)).toLocaleString('en-IN') })}
        extra={[
          <ExportButtons key="x" title={tr('{v0} Register', { v0: title })} columns={cols} rows={rows} getRows={table.fetchAll} totalsFor={(rs) => ({ name: tr('Total'), totalAmount: sum(rs, (r) => r.totalAmount) })} count={count} />,
          can('beneficiaries.edit') ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{tr('Add')}</Button> : null,
        ]}
      />
      <Card>
        <Space style={{ marginBottom: 12 }}>
          <Input.Search allowClear placeholder={tr('Name, mobile, PAN, GSTIN')} value={text} onChange={(e) => setText(e.target.value)} style={{ width: 280 }} />
        </Space>
        <ServerError table={table} />
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 800 }}
          pagination={false}
          footer={() => <ServerPager table={table} />}
          onRow={(r) => ({ onDoubleClick: () => router.push(`/beneficiaries/${r.id}`) })}
          columns={[
            { title: tr('ID'), dataIndex: 'code', width: 95 },
            { title: tr('Name'), render: (_, r) => <Link href={`/beneficiaries/${r.id}`}>{r.name}</Link> },
            { title: tr('Type'), dataIndex: 'type', width: 150, render: (t) => <Tag>{tr(typeLabel(t))}</Tag> },
            { title: tr('Mobile'), dataIndex: 'mobile', width: 120 },
            { title: tr('PAN / GST'), render: (_, r) => [r.pan, r.gstin].filter(Boolean).join(' / '), responsive: ['lg'] },
            { title: tr('Payments'), dataIndex: 'paymentCount', width: 95, align: 'center' },
            { title: tr('Last paid'), dataIndex: 'lastPaymentDate', render: fmtDate, width: 105, responsive: ['md'] },
            { title: tr('Total received'), dataIndex: 'totalAmount', align: 'right', width: 140, render: (v) => <Money value={v} strong /> },
          ]}
        />
      </Card>
      <PayeeModal open={open} onClose={() => setOpen(false)} defaultType={defaultType} onSaved={(id) => router.push(`/beneficiaries/${id}`)} />
    </Guard>
  );
}

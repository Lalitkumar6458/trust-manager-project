'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Table, Input, Space, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { COL, PAYEE_TYPES } from '@/lib/constants';
import { fmtDate, maskAccount, sum } from '@/lib/format';
import { useLiveQuery } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader, Money, Guard } from '@/components/common';
import ExportButtons from '@/components/ExportButtons';
import { PayeeModal } from '@/components/PartyForms';
import { usePagedParties } from '@/lib/usePagedParties';
import { useLang } from '@/i18n/LangContext';

const typeLabel = (t) => PAYEE_TYPES.find((p) => p.value === t)?.label || t;

export default function PayeeListPage({ types, title, defaultType }) {
  const { t: tr } = useLang();
  const router = useRouter();
  const { can } = useAuth();
  const [text, setText] = useState('');
  const { data, loading, hasMore, loadMore, searching, count, total, fetchAllMatching } = usePagedParties(COL.beneficiaries, { text, inField: 'type', inValues: types });
  const [open, setOpen] = useState(false);

  const shape = (list) => {
    const t = text.trim().toLowerCase();
    return list
      .filter((d) => types.includes(d.type || 'beneficiary'))
      .filter((d) => !t || [d.name, d.mobile, d.pan, d.gstin, d.code].filter(Boolean).some((x) => String(x).toLowerCase().includes(t)))
      .sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0));
  };
  const rows = useMemo(() => shape(data), [data, text, types]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <ExportButtons key="x" title={tr('{v0} Register', { v0: title })} columns={cols} rows={rows} getRows={async () => shape(await fetchAllMatching())} totalsFor={(rs) => ({ name: tr('Total'), totalAmount: sum(rs, (r) => r.totalAmount) })} count={count} />,
          can('beneficiaries.edit') ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{tr('Add')}</Button> : null,
        ]}
      />
      <Card>
        <Space style={{ marginBottom: 12 }}>
          <Input.Search allowClear placeholder={tr('Name, mobile, PAN, GSTIN')} value={text} onChange={(e) => setText(e.target.value)} style={{ width: 280 }} />
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 800 }}
          pagination={{ defaultPageSize: 25 }}
          footer={() => (
            <Space wrap>
              <span className="muted">{searching ? tr('Search results from all records') : tr('Showing {v0} of {v1} (largest first)', { v0: rows.length, v1: count ?? '…' })}</span>
              {hasMore ? <Button size="small" onClick={loadMore}>{tr('Load more')}</Button> : null}
            </Space>
          )}
          onRow={(r) => ({ onDoubleClick: () => router.push(`/beneficiaries/${r.id}`) })}
          columns={[
            { title: tr('ID'), dataIndex: 'code', width: 95 },
            { title: tr('Name'), render: (_, r) => <Link href={`/beneficiaries/${r.id}`}>{r.name}</Link> },
            { title: tr('Type'), dataIndex: 'type', width: 150, render: (t) => <Tag>{tr(typeLabel(t))}</Tag> },
            { title: tr('Mobile'), dataIndex: 'mobile', width: 120 },
            { title: tr('PAN / GST'), render: (_, r) => [r.pan, r.gstin].filter(Boolean).join(' / '), responsive: ['lg'] },
            { title: tr('Payments'), dataIndex: 'paymentCount', width: 95, align: 'center' },
            { title: tr('Last paid'), dataIndex: 'lastPaymentDate', render: fmtDate, width: 105, responsive: ['md'] },
            { title: tr('Total received'), dataIndex: 'totalAmount', align: 'right', width: 140, render: (v) => <Money value={v} strong />, sorter: (a, b) => (a.totalAmount || 0) - (b.totalAmount || 0) },
          ]}
        />
      </Card>
      <PayeeModal open={open} onClose={() => setOpen(false)} defaultType={defaultType} onSaved={(id) => router.push(`/beneficiaries/${id}`)} />
    </Guard>
  );
}

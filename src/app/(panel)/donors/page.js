'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Table, Input, Select, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { COL, DONOR_TYPES } from '@/lib/constants';
import { fmtDate, sum } from '@/lib/format';
import { useLiveQuery } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Money, Guard } from '@/components/common';
import ExportButtons from '@/components/ExportButtons';
import { DonorModal } from '@/components/PartyForms';
import { DonorImportButton } from '@/components/DataTools';
import { usePagedParties } from '@/lib/usePagedParties';
import { useLang } from '@/i18n/LangContext';

export default function DonorsPage() {
  const { t: tr } = useLang();
  const router = useRouter();
  const { can } = useAuth();
  const app = useAppData();
  const fyKey = (app.selectedFyId || '').replace('-', '_');
  const [text, setText] = useState('');
  const [type, setType] = useState();
  const [onlyFy, setOnlyFy] = useState(false);
  // paged from the server (biggest donors first); search covers all donors
  const { data, loading, hasMore, loadMore, searching, count, total, fetchAllMatching } = usePagedParties(COL.donors, {
    text,
    equals: type && !onlyFy ? ['donorType', type] : null,
    positiveField: onlyFy ? `fyTotals.${fyKey}` : null,
  });
  const [open, setOpen] = useState(false);

  const shape = (list) => {
    const t = text.trim().toLowerCase();
    return list
      .filter((d) => !type || d.donorType === type)
      .filter((d) => !onlyFy || (d.fyTotals?.[fyKey] || 0) > 0)
      .filter((d) => !t || [d.name, d.organizationName, d.mobile, d.pan, d.donorCode, d.email].filter(Boolean).some((x) => String(x).toLowerCase().includes(t)))
      .map((d) => ({ ...d, fyAmount: d.fyTotals?.[fyKey] || 0 }))
      .sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0));
  };
  const rows = useMemo(() => shape(data), [data, text, type, onlyFy, fyKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const donorTotals = (rs) => ({ name: 'Total', fyAmount: sum(rs, (r) => r.fyAmount), totalAmount: sum(rs, (r) => r.totalAmount) });

  const cols = [
    { title: tr('Donor ID'), key: 'donorCode' },
    { title: tr('Name'), key: 'name', width: 2 },
    { title: tr('Organization'), key: 'organizationName' },
    { title: tr('Type'), key: 'donorType' },
    { title: tr('Mobile'), key: 'mobile' },
    { title: tr('Email'), key: 'email' },
    { title: tr('PAN'), key: 'pan' },
    { title: tr('Address'), key: 'address', width: 2 },
    { title: tr('Donations'), key: 'donationCount' },
    { title: tr('First'), key: 'firstDonationDate', value: (r) => fmtDate(r.firstDonationDate) },
    { title: tr('Last'), key: 'lastDonationDate', value: (r) => fmtDate(r.lastDonationDate) },
    { title: `FY ${app.selectedFyId}`, key: 'fyAmount', money: true },
    { title: tr('Total donation'), key: 'totalAmount', money: true },
  ];

  return (
    <Guard perm="donors.view">
      <PageHeader
        title={tr('Donors')}
        subtitle={tr('{v0} donor(s) · lifetime total ₹{v1}', { v0: count ?? rows.length, v1: Number(total ?? sum(rows, (r) => r.totalAmount)).toLocaleString('en-IN') })}
        extra={[
          <ExportButtons key="x" title={tr('Donor Register')} columns={cols} rows={rows} getRows={async () => shape(await fetchAllMatching())} totalsFor={donorTotals} count={count} />,
          <DonorImportButton key="i" />,
          can('donors.edit') ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{tr('New donor')}</Button> : null,
        ]}
      />
      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search allowClear placeholder={tr('Name, mobile, PAN, donor ID')} value={text} onChange={(e) => setText(e.target.value)} style={{ width: 260 }} />
          <Select allowClear placeholder={tr('Donor type')} value={type} onChange={setType} options={DONOR_TYPES.map((d) => ({ value: d, label: tr(d) }))} style={{ width: 160 }} />
          <Select value={onlyFy} onChange={setOnlyFy} style={{ width: 230 }} options={[{ value: false, label: tr('All donors') }, { value: true, label: tr('Donated in FY {v0}', { v0: app.selectedFyId }) }]} />
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 900 }}
          pagination={{ defaultPageSize: 25, showSizeChanger: true }}
          onRow={(r) => ({ onDoubleClick: () => router.push(`/donors/${r.id}`) })}
          footer={() => (
            <Space wrap>
              <span className="muted">{searching ? tr('Search results from all donors') : tr('Showing {v0} of {v1} donors (largest first)', { v0: rows.length, v1: count ?? '…' })}</span>
              {hasMore ? <Button size="small" onClick={loadMore}>{tr('Load more')}</Button> : null}
              <span className="muted">{tr('Full list for printing / Excel: Reports → Donor List / Register')}</span>
            </Space>
          )}
          columns={[
            { title: tr('ID'), dataIndex: 'donorCode', width: 95 },
            { title: tr('Name'), render: (_, r) => <div><Link href={`/donors/${r.id}`}>{r.name}</Link>{r.organizationName ? <div className="muted" style={{ fontSize: 12 }}>{r.organizationName}</div> : null}</div> },
            { title: tr('Type'), dataIndex: 'donorType', width: 110, responsive: ['md'], render: (v) => tr(v || '') },
            { title: tr('Mobile'), dataIndex: 'mobile', width: 120 },
            { title: tr('PAN'), dataIndex: 'pan', width: 120, responsive: ['lg'] },
            { title: tr('Donations'), dataIndex: 'donationCount', width: 95, align: 'center' },
            { title: tr('Last'), dataIndex: 'lastDonationDate', width: 105, render: fmtDate, responsive: ['md'] },
            { title: `FY ${app.selectedFyId}`, dataIndex: 'fyAmount', align: 'right', width: 130, render: (v) => <Money value={v} />, sorter: (a, b) => a.fyAmount - b.fyAmount },
            { title: tr('Total'), dataIndex: 'totalAmount', align: 'right', width: 140, render: (v) => <Money value={v} strong />, sorter: (a, b) => (a.totalAmount || 0) - (b.totalAmount || 0) },
          ]}
        />
      </Card>
      <DonorModal open={open} onClose={() => setOpen(false)} onSaved={(id) => router.push(`/donors/${id}`)} />
    </Guard>
  );
}

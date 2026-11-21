'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Table, Input, Select, Space, Tooltip } from 'antd';
import { where } from '@/lib/q';
import { PlusOutlined } from '@ant-design/icons';
import { COL, DONOR_TYPES } from '@/lib/constants';
import { fmtDate, sum } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Money, Guard } from '@/components/common';
import ExportButtons from '@/components/ExportButtons';
import { DonorModal } from '@/components/PartyForms';
import { DonorImportButton } from '@/components/DataTools';
import { useServerTable, useDebounced, useAsyncValue } from '@/lib/useServerTable';
import { normalizeSearch } from '@/lib/keywords';
import ServerPager, { ServerError } from '@/components/ServerPager';
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
  const [open, setOpen] = useState(false);
  // everything runs in PostgreSQL: 100 donors per page (biggest first); search / type / FY filter on the server
  const term = normalizeSearch(useDebounced(text));
  const searching = term.length >= 2 && !onlyFy;
  const fyField = `fyTotals.${fyKey}`;
  const cons = [];
  let order = ['totalAmount', 'desc'];
  if (onlyFy) {
    cons.push(where(fyField, '>', 0));
    order = [fyField, 'desc'];
  } else {
    if (searching) cons.push(where('searchKeywords', 'array-contains', term));
    if (type) cons.push(where('donorType', '==', type));
  }
  const key = JSON.stringify([onlyFy ? fyKey : '', searching ? term : '', onlyFy ? '' : type]);
  const table = useServerTable(COL.donors, cons, { order, key });
  const { loading } = table;
  const withFy = (list) => list.map((d) => ({ ...d, fyAmount: d.fyTotals?.[fyKey] || 0 }));
  const rows = withFy(table.rows);
  const total = useAsyncValue(async () => (await table.sumOf(['totalAmount'])).totalAmount || 0, [key, table.rows], null);
  const count = table.total;
  const fetchAllMatching = async () => withFy(await table.fetchAll());
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
          <ExportButtons key="x" title={tr('Donor Register')} columns={cols} rows={rows} getRows={fetchAllMatching} totalsFor={donorTotals} count={count} />,
          <DonorImportButton key="i" />,
          can('donors.edit') ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{tr('New donor')}</Button> : null,
        ]}
      />
      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          <Tooltip title={onlyFy ? tr('Choose “All donors” to search') : undefined}>
            <Input.Search disabled={onlyFy} allowClear placeholder={tr('Name, mobile, PAN, donor ID')} value={text} onChange={(e) => setText(e.target.value)} style={{ width: 260 }} />
          </Tooltip>
          <Select disabled={onlyFy} allowClear placeholder={tr('Donor type')} value={type} onChange={setType} options={DONOR_TYPES.map((d) => ({ value: d, label: tr(d) }))} style={{ width: 160 }} />
          <Select value={onlyFy} onChange={setOnlyFy} style={{ width: 230 }} options={[{ value: false, label: tr('All donors') }, { value: true, label: tr('Donated in FY {v0}', { v0: app.selectedFyId }) }]} />
        </Space>
        <div className="muted" style={{ fontSize: 12, margin: '-4px 0 8px' }}>{onlyFy ? tr('Donors of FY {v0}, biggest first (server-side).', { v0: app.selectedFyId }) : searching ? tr('Search results from all donors (server-side).') : tr('All donors, biggest first – 100 per page. Export includes every matching donor.')}</div>
        <ServerError table={table} />
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 900 }}
          pagination={false}
          onRow={(r) => ({ onDoubleClick: () => router.push(`/donors/${r.id}`) })}
          footer={() => <ServerPager table={table} />}
          columns={[
            { title: tr('ID'), dataIndex: 'donorCode', width: 95 },
            { title: tr('Name'), render: (_, r) => <div><Link href={`/donors/${r.id}`}>{r.name}</Link>{r.organizationName ? <div className="muted" style={{ fontSize: 12 }}>{r.organizationName}</div> : null}</div> },
            { title: tr('Type'), dataIndex: 'donorType', width: 110, responsive: ['md'], render: (v) => tr(v || '') },
            { title: tr('Mobile'), dataIndex: 'mobile', width: 120 },
            { title: tr('PAN'), dataIndex: 'pan', width: 120, responsive: ['lg'] },
            { title: tr('Donations'), dataIndex: 'donationCount', width: 95, align: 'center' },
            { title: tr('Last'), dataIndex: 'lastDonationDate', width: 105, render: fmtDate, responsive: ['md'] },
            { title: `FY ${app.selectedFyId}`, dataIndex: 'fyAmount', align: 'right', width: 130, render: (v) => <Money value={v} /> },
            { title: tr('Total'), dataIndex: 'totalAmount', align: 'right', width: 140, render: (v) => <Money value={v} strong /> },
          ]}
        />
      </Card>
      <DonorModal open={open} onClose={() => setOpen(false)} onSaved={(id) => router.push(`/donors/${id}`)} />
    </Guard>
  );
}

'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Table, Segmented, Space, Tooltip, Typography } from 'antd';
import { PlusOutlined, PrinterOutlined } from '@ant-design/icons';
import { COL } from '@/lib/constants';
import { fmtDate, money, sum } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, StatusTag, Money, Guard } from '@/components/common';
import FilterBar, { applyFilters } from '@/components/FilterBar';
import ExportButtons from '@/components/ExportButtons';
import { donationReceiptPdf } from '@/pdf/generate';
import { donationExportCols } from '@/lib/exportCols';
import { useServerList } from '@/lib/useServerList';
import { ListStatus, LoadMoreBar, useStatusCounts } from '@/components/ServerListBits';
import { useLang } from '@/i18n/LangContext';

const TABS = [
  { label: 'All', value: 'all' },
  { label: 'Pending verification', value: 'submitted' },
  { label: 'Verified (approval pending)', value: 'verified' },
  { label: 'Approved', value: 'approved' },
  { label: 'Draft', value: 'draft' },
  { label: 'Void', value: 'void' },
];


export default function DonationsPage() {
  const { t: tr, pick } = useLang();
  const router = useRouter();
  const { can } = useAuth();
  const app = useAppData();
  const [tab, setTab] = useState('all');
  const [filters, setFilters] = useState({});
  const [run] = useAction();
  const textFields = (r) => [r.receiptNo, r.donor?.name, r.donor?.mobile, r.donor?.pan, r.utr, r.chequeNo, r.purpose, r.donor?.organizationName];
  const clientFilter = useCallback((list) => applyFilters(list, { ...filters, from: null, to: null }, { categoryField: 'categoryIds', textFields })
    .sort((a, b) => (b.date === a.date ? (b.receiptNo || '').localeCompare(a.receiptNo || '') : b.date.localeCompare(a.date))), [filters]);
  // every filter runs on the server over the whole year; 100 newest rows at a time
  const list = useServerList(COL.donations, app.selectedFy, {
    server: [
      { field: 'status', op: '==', value: tab === 'all' ? null : tab },
      { field: 'accountId', op: '==', value: filters.accountId },
      { field: 'categoryIds', op: 'array-contains', value: filters.categoryId },
      { field: 'fundIds', op: 'array-contains', value: filters.fundId },
      { field: 'paymentMode', op: '==', value: filters.mode },
    ],
    from: filters.from,
    to: filters.to,
    text: filters.text,
    clientFilter,
    forceAll: filters.min != null || filters.max != null,
  });
  const { rows, loading } = list;
  const counts = useStatusCounts(COL.donations, app.selectedFy, TABS.map((t) => t.value).filter((v) => v !== 'all'), list.total);
  const approvedTotal = sum(rows.filter((r) => r.status === 'approved'), (r) => r.amount);
  const exportTotals = (rs) => ({ donor: 'Total', amount: sum(rs.filter((r) => r.status !== 'void'), (r) => r.amount) });

  return (
    <Guard perm="donations.view">
      <PageHeader
        title={tr('Donations')}
        subtitle={list.loadedAll
          ? tr('FY {v0} · {v1} record(s) · Approved total {v2}', { v0: app.selectedFyId, v1: rows.length, v2: money(approvedTotal) })
          : tr('FY {v0} · {v1} matching record(s)', { v0: app.selectedFyId, v1: list.total ?? '…' })}
        extra={[
          <ExportButtons key="e" title={tr('Donation Register – FY {v0}', { v0: app.selectedFyId })} subtitle={filters.from ? `${fmtDate(filters.from)} – ${fmtDate(filters.to)}` : undefined} columns={donationExportCols} rows={rows} getRows={list.fetchAllMatching} totalsFor={exportTotals} count={list.total} />,
          can('donations.create') ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => router.push('/donations/new')}>{tr('New donation')}</Button> : null,
        ]}
      />
      <Card>
        <Segmented
          options={TABS.map((t) => ({ ...t, label: `${tr(t.label)}${t.value !== 'all' && counts[t.value] ? ` (${counts[t.value]})` : ''}` }))}
          value={tab}
          onChange={setTab}
          style={{ marginBottom: 12, maxWidth: '100%', overflowX: 'auto' }}
        />
        <FilterBar value={filters} onChange={setFilters} fields={['text', 'dates', 'donationCategory', 'mode', 'account', 'fund', 'amount']} />
        <ListStatus list={list} />
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 1000 }}
          size="middle"
          pagination={{ defaultPageSize: 25, showSizeChanger: true, showTotal: (n) => tr('{n} donations', { n }) }}
          footer={() => <LoadMoreBar list={list} />}
          onRow={(r) => ({ onDoubleClick: () => router.push(`/donations/${r.id}`) })}
          columns={[
            { title: tr('Receipt No.'), dataIndex: 'receiptNo', width: 150, render: (v, r) => <Link href={`/donations/${r.id}`}>{v || <i>{tr('Draft')}</i>}</Link> },
            { title: tr('Date'), dataIndex: 'date', width: 105, render: fmtDate },
            {
              title: tr('Donor'),
              render: (_, r) => (
                <div>
                  <Link href={`/donors/${r.donorId}`}>{r.donor?.name}</Link>
                  <div className="muted" style={{ fontSize: 12 }}>{[r.donor?.mobile, r.donor?.pan].filter(Boolean).join(' · ')}</div>
                </div>
              ),
            },
            { title: tr('Category'), render: (_, r) => (r.lines || []).map((l) => pick(l.categoryName, l.categoryNameHi)).join(', '), ellipsis: true },
            { title: tr('Mode'), dataIndex: 'paymentMode', width: 110, render: (v, r) => <Tooltip title={r.utr || r.chequeNo}>{v}</Tooltip> },
            { title: tr('Account'), dataIndex: 'accountName', width: 150, ellipsis: true, responsive: ['lg'] },
            { title: tr('Amount'), dataIndex: 'amount', align: 'right', width: 130, render: (v) => <Money value={v} />, sorter: (a, b) => a.amount - b.amount },
            { title: tr('Status'), dataIndex: 'status', width: 120, render: (s) => <StatusTag status={s} /> },
            {
              title: '',
              width: 60,
              render: (_, r) => (r.receiptNo ? (
                <Tooltip title={tr('Receipt PDF')}>
                  <Button size="small" icon={<PrinterOutlined />} onClick={() => run(() => donationReceiptPdf({ donation: r, settings: app.settings, categories: app.donationCategories }))} />
                </Tooltip>
              ) : null),
            },
          ]}
          summary={(pageData) => (
            <Table.Summary.Row className="table-summary">
              <Table.Summary.Cell index={0} colSpan={6}><Typography.Text strong>{tr('Page total (excluding void)')}</Typography.Text></Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right"><Money value={sum(pageData.filter((r) => r.status !== 'void'), (r) => r.amount)} strong /></Table.Summary.Cell>
              <Table.Summary.Cell index={7} colSpan={2} />
            </Table.Summary.Row>
          )}
        />
        <Space className="muted" style={{ fontSize: 12 }}>{tr('Tip: double-click a row to open it.')}</Space>
      </Card>
    </Guard>
  );
}

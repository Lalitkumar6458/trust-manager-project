'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Table, Segmented, Space, Tooltip, Typography, App } from 'antd';
import { PlusOutlined, PrinterOutlined } from '@ant-design/icons';
import { COL } from '@/lib/constants';
import { fmtDate, money, sum } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, StatusTag, Money, Guard } from '@/components/common';
import FilterBar from '@/components/FilterBar';
import ExportButtons from '@/components/ExportButtons';
import { donationReceiptPdf } from '@/pdf/generate';
import { donationExportCols } from '@/lib/exportCols';
import { useServerTable, useDebounced } from '@/lib/useServerTable';
import { registerQuery, useMatchingTotal, DONATION_RULES } from '@/lib/registerQuery';
import { useStatusCounts } from '@/components/ServerListBits';
import ServerPager, { ServerError, ServerHint } from '@/components/ServerPager';
import { useLang } from '@/i18n/LangContext';

/** most receipts in one bulk PDF (browser memory) */
const BULK_MAX = 300;

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
  const [run, busy] = useAction();
  const { message } = App.useApp();
  const [selected, setSelected] = useState([]);
  const text = useDebounced(filters.text || '');
  // every filter / search runs in PostgreSQL; only the 100 rows of the current page are downloaded
  const q = registerQuery('donations', app.selectedFyId, tab, { ...filters, text });
  const table = useServerTable(COL.donations, q.cons, { order: q.order, key: q.key, enabled: !!app.selectedFy });
  const { rows, loading } = table;
  const matchTotal = useMatchingTotal(table, tab, q.key);
  const counts = useStatusCounts(COL.donations, app.selectedFy, TABS.map((t) => t.value).filter((v) => v !== 'all'), table.total);
  // bulk receipts: the ticked rows, otherwise every receipt matching the filters (max BULK_MAX)
  const bulkPrint = () => run(async () => {
    let list = selected.length ? rows.filter((r) => selected.includes(r.id)) : await table.fetchAll();
    list = list.filter((r) => r.receiptNo).sort((a, b) => String(a.receiptNo).localeCompare(String(b.receiptNo), undefined, { numeric: true }));
    if (!list.length) throw new Error(tr('No receipt to print'));
    if (list.length > BULK_MAX) {
      message.warning(tr('Only the first {n} receipts are included – narrow the filters (date range) for the rest.', { n: BULK_MAX }));
      list = list.slice(0, BULK_MAX);
    }
    await donationReceiptPdf({ donations: list, settings: app.settings, categories: app.donationCategories, mode: 'open' });
  });
  useEffect(() => { setSelected([]); }, [q.key, table.page, tab]);
  const exportTotals = (rs) => ({ donor: 'Total', amount: sum(rs.filter((r) => r.status !== 'void'), (r) => r.amount) });

  return (
    <Guard perm="donations.view">
      <PageHeader
        title={tr('Donations')}
        subtitle={tr('FY {v0} · {v1} matching record(s) · Total {v2} (excluding void)', { v0: app.selectedFyId, v1: table.total ?? '…', v2: matchTotal === null ? '…' : money(matchTotal) })}
        extra={[
          <ExportButtons key="e" title={tr('Donation Register – FY {v0}', { v0: app.selectedFyId })} subtitle={filters.from ? `${fmtDate(filters.from)} – ${fmtDate(filters.to)}` : undefined} columns={donationExportCols} rows={rows} getRows={table.fetchAll} totalsFor={exportTotals} count={table.total} />,
          <Tooltip key="bp" title={selected.length ? tr('Receipts of the ticked rows') : tr('All receipts matching the filters (max {n})', { n: BULK_MAX })}>
            <Button icon={<PrinterOutlined />} loading={busy} onClick={bulkPrint}>{selected.length ? tr('Print {n} receipts', { n: selected.length }) : tr('Bulk receipts')}</Button>
          </Tooltip>,
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
        <FilterBar value={filters} onChange={setFilters} fields={['text', 'dates', 'donationCategory', 'mode', 'account', 'fund', 'amount']} rules={DONATION_RULES} />
        <ServerHint mode={q.mode} />
        <ServerError table={table} />
        <Table
          rowKey="id"
          loading={loading}
          rowSelection={{ selectedRowKeys: selected, onChange: setSelected, getCheckboxProps: (r) => ({ disabled: !r.receiptNo }), preserveSelectedRowKeys: false }}
          dataSource={rows}
          scroll={{ x: 1000 }}
          size="middle"
          pagination={false}
          footer={() => <ServerPager table={table} />}
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
            { title: tr('Amount'), dataIndex: 'amount', align: 'right', width: 130, render: (v) => <Money value={v} /> },
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
              <Table.Summary.Cell index={0} colSpan={7}><Typography.Text strong>{tr('Page total (excluding void)')}</Typography.Text></Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right"><Money value={sum(pageData.filter((r) => r.status !== 'void'), (r) => r.amount)} strong /></Table.Summary.Cell>
              <Table.Summary.Cell index={8} colSpan={2} />
            </Table.Summary.Row>
          )}
        />
        <Space className="muted" style={{ fontSize: 12 }}>{tr('Tip: double-click a row to open it.')}</Space>
      </Card>
    </Guard>
  );
}

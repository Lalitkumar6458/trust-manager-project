'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Table, Segmented, Tooltip, Typography } from 'antd';
import { PlusOutlined, PrinterOutlined } from '@ant-design/icons';
import { COL, payeeTypeLabel } from '@/lib/constants';
import { fmtDate, money, sum } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, StatusTag, Money, Guard } from '@/components/common';
import FilterBar, { applyFilters } from '@/components/FilterBar';
import ExportButtons from '@/components/ExportButtons';
import { paymentVoucherPdf } from '@/pdf/generate';
import { expenseExportCols } from '@/lib/exportCols';
import { useServerList } from '@/lib/useServerList';
import { ListStatus, LoadMoreBar, useStatusCounts } from '@/components/ServerListBits';
import { useLang } from '@/i18n/LangContext';

const TABS = [
  { label: 'All', value: 'all' },
  { label: 'Approval pending', value: 'submitted' },
  { label: 'Approved (payment pending)', value: 'approved' },
  { label: 'Paid', value: 'paid' },
  { label: 'Draft', value: 'draft' },
  { label: 'Void', value: 'void' },
];

export default function ExpensesPage() {
  const { t: tr, pick } = useLang();
  const router = useRouter();
  const { can } = useAuth();
  const app = useAppData();
  const [tab, setTab] = useState('all');
  const [filters, setFilters] = useState({});
  const [run] = useAction();
  const textFields = (r) => [r.voucherNo, r.payee?.name, r.payee?.mobile, r.payee?.pan, r.utr, r.chequeNo, r.purpose, r.billNo, r.projectName];
  const clientFilter = useCallback((list) => applyFilters(list, { ...filters, from: null, to: null }, { textFields })
    .sort((a, b) => (b.date === a.date ? (b.voucherNo || '').localeCompare(a.voucherNo || '') : b.date.localeCompare(a.date))), [filters]);
  // every filter runs on the server over the whole year; 100 newest rows at a time
  const list = useServerList(COL.expenses, app.selectedFy, {
    server: [
      { field: 'status', op: '==', value: tab === 'all' ? null : tab },
      { field: 'accountId', op: '==', value: filters.accountId },
      { field: 'categoryId', op: '==', value: filters.categoryId },
      { field: 'fundId', op: '==', value: filters.fundId },
      { field: 'paymentMode', op: '==', value: filters.mode },
    ],
    from: filters.from,
    to: filters.to,
    text: filters.text,
    clientFilter,
    forceAll: filters.min != null || filters.max != null,
  });
  const { rows, loading } = list;
  const counts = useStatusCounts(COL.expenses, app.selectedFy, TABS.map((t) => t.value).filter((v) => v !== 'all'), list.total);
  const exportTotals = (rs) => ({ payee: 'Total', amount: sum(rs.filter((r) => r.status !== 'void'), (r) => r.amount) });

  return (
    <Guard perm="expenses.view">
      <PageHeader
        title={tr('Expenses')}
        subtitle={list.loadedAll
          ? tr('FY {v0} · {v1} record(s) · Paid total {v2}', { v0: app.selectedFyId, v1: rows.length, v2: money(sum(rows.filter((r) => r.status === 'paid'), (r) => r.amount)) })
          : tr('FY {v0} · {v1} matching record(s)', { v0: app.selectedFyId, v1: list.total ?? '…' })}
        extra={[
          <ExportButtons key="e" title={tr('Expense Register – FY {v0}', { v0: app.selectedFyId })} subtitle={filters.from ? `${fmtDate(filters.from)} – ${fmtDate(filters.to)}` : undefined} columns={expenseExportCols} rows={rows} getRows={list.fetchAllMatching} totalsFor={exportTotals} count={list.total} />,
          can('expenses.create') ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => router.push('/expenses/new')}>{tr('New expense')}</Button> : null,
        ]}
      />
      <Card>
        <Segmented
          options={TABS.map((t) => ({ ...t, label: `${tr(t.label)}${t.value !== 'all' && counts[t.value] ? ` (${counts[t.value]})` : ''}` }))}
          value={tab}
          onChange={setTab}
          style={{ marginBottom: 12, maxWidth: '100%', overflowX: 'auto' }}
        />
        <FilterBar value={filters} onChange={setFilters} fields={['text', 'dates', 'expenseCategory', 'mode', 'account', 'fund', 'amount']} textPlaceholder={tr('Search payee, voucher, UTR, bill…')} />
        <ListStatus list={list} />
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 1000 }}
          pagination={{ defaultPageSize: 25, showSizeChanger: true, showTotal: (n) => tr('{n} expenses', { n }) }}
          footer={() => <LoadMoreBar list={list} />}
          onRow={(r) => ({ onDoubleClick: () => router.push(`/expenses/${r.id}`) })}
          columns={[
            { title: tr('Voucher No.'), dataIndex: 'voucherNo', width: 150, render: (v, r) => <Link href={`/expenses/${r.id}`}>{v || <i>{tr('Draft')}</i>}</Link> },
            { title: tr('Date'), dataIndex: 'date', width: 105, render: fmtDate },
            { title: tr('Paid to'), render: (_, r) => <div><Link href={`/beneficiaries/${r.payeeId}`}>{r.payee?.name}</Link><div className="muted" style={{ fontSize: 12 }}>{tr(payeeTypeLabel(r.payee?.type))}</div></div> },
            { title: tr('Category'), dataIndex: 'categoryName', ellipsis: true, render: (v, r) => pick(v, r.categoryNameHi) },
            { title: tr('Purpose'), dataIndex: 'purpose', ellipsis: true, responsive: ['lg'] },
            { title: tr('Mode'), dataIndex: 'paymentMode', width: 110 },
            { title: tr('Amount'), dataIndex: 'amount', align: 'right', width: 130, render: (v) => <Money value={v} />, sorter: (a, b) => a.amount - b.amount },
            { title: tr('Status'), dataIndex: 'status', width: 120, render: (s) => <StatusTag status={s} /> },
            {
              title: '',
              width: 60,
              render: (_, r) => (r.voucherNo ? (
                <Tooltip title={tr('Voucher PDF')}><Button size="small" icon={<PrinterOutlined />} onClick={() => run(() => paymentVoucherPdf({ expense: r, settings: app.settings }))} /></Tooltip>
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
      </Card>
    </Guard>
  );
}

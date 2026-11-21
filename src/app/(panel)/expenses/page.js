'use client';

import { useState } from 'react';
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
import FilterBar from '@/components/FilterBar';
import ExportButtons from '@/components/ExportButtons';
import { paymentVoucherPdf } from '@/pdf/generate';
import { expenseExportCols } from '@/lib/exportCols';
import { useServerTable, useDebounced } from '@/lib/useServerTable';
import { registerQuery, useMatchingTotal, EXPENSE_RULES } from '@/lib/registerQuery';
import { useStatusCounts } from '@/components/ServerListBits';
import ServerPager, { ServerError, ServerHint } from '@/components/ServerPager';
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
  const text = useDebounced(filters.text || '');
  // every filter / search runs in PostgreSQL; only the 100 rows of the current page are downloaded
  const q = registerQuery('expenses', app.selectedFyId, tab, { ...filters, text });
  const table = useServerTable(COL.expenses, q.cons, { order: q.order, key: q.key, enabled: !!app.selectedFy });
  const { rows, loading } = table;
  const matchTotal = useMatchingTotal(table, tab, q.key);
  const counts = useStatusCounts(COL.expenses, app.selectedFy, TABS.map((t) => t.value).filter((v) => v !== 'all'), table.total);
  const exportTotals = (rs) => ({ payee: 'Total', amount: sum(rs.filter((r) => r.status !== 'void'), (r) => r.amount) });

  return (
    <Guard perm="expenses.view">
      <PageHeader
        title={tr('Expenses')}
        subtitle={tr('FY {v0} · {v1} matching record(s) · Total {v2} (excluding void)', { v0: app.selectedFyId, v1: table.total ?? '…', v2: matchTotal === null ? '…' : money(matchTotal) })}
        extra={[
          <ExportButtons key="e" title={tr('Expense Register – FY {v0}', { v0: app.selectedFyId })} subtitle={filters.from ? `${fmtDate(filters.from)} – ${fmtDate(filters.to)}` : undefined} columns={expenseExportCols} rows={rows} getRows={table.fetchAll} totalsFor={exportTotals} count={table.total} />,
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
        <FilterBar value={filters} onChange={setFilters} fields={['text', 'dates', 'expenseCategory', 'mode', 'account', 'fund', 'amount']} textPlaceholder={tr('Search payee, voucher, UTR, bill…')} rules={EXPENSE_RULES} />
        <ServerHint mode={q.mode} />
        <ServerError table={table} />
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 1000 }}
          pagination={false}
          footer={() => <ServerPager table={table} />}
          onRow={(r) => ({ onDoubleClick: () => router.push(`/expenses/${r.id}`) })}
          columns={[
            { title: tr('Voucher No.'), dataIndex: 'voucherNo', width: 150, render: (v, r) => <Link href={`/expenses/${r.id}`}>{v || <i>{tr('Draft')}</i>}</Link> },
            { title: tr('Date'), dataIndex: 'date', width: 105, render: fmtDate },
            { title: tr('Paid to'), render: (_, r) => <div><Link href={`/beneficiaries/${r.payeeId}`}>{r.payee?.name}</Link><div className="muted" style={{ fontSize: 12 }}>{tr(payeeTypeLabel(r.payee?.type))}</div></div> },
            { title: tr('Category'), dataIndex: 'categoryName', ellipsis: true, render: (v, r) => pick(v, r.categoryNameHi) },
            { title: tr('Purpose'), dataIndex: 'purpose', ellipsis: true, responsive: ['lg'] },
            { title: tr('Mode'), dataIndex: 'paymentMode', width: 110 },
            { title: tr('Amount'), dataIndex: 'amount', align: 'right', width: 130, render: (v) => <Money value={v} /> },
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

'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Button, Card, Table, Modal, Form, Select, InputNumber, DatePicker, Input, Tag, Space, Radio, Alert, Typography,
} from 'antd';
import { PlusOutlined, RollbackOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { where } from '@/lib/q';
import { COL, TXN_TYPES, MANUAL_TXN_TYPES } from '@/lib/constants';
import { fmtDate, sum, todayStr } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Money, Guard, useReasonPrompt } from '@/components/common';
import ExportButtons from '@/components/ExportButtons';
import { sourceLink } from '@/components/AccountBook';
import { createManualEntry, reverseManualEntry } from '@/services/ledger';
import { ledgerExportCols } from '@/lib/exportCols';
import { useServerTable, useDebounced, useAsyncValue } from '@/lib/useServerTable';
import { useBookBalance, bookOrder } from '@/lib/useBookBalance';
import { normalizeSearch } from '@/lib/keywords';
import ServerPager, { ServerError, ServerHint } from '@/components/ServerPager';
import { useLang } from '@/i18n/LangContext';

function ManualEntryModal({ open, onClose }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const type = Form.useWatch('type', form);
  const meta = MANUAL_TXN_TYPES.find((t) => t.value === type) || {};
  const acctOpts = (filter) => app.activeAccounts.filter(filter).map((a) => ({ value: a.id, label: `${a.name} (₹${(a.currentBalance || 0).toLocaleString('en-IN')})` }));
  const fromFilter = type === 'cash_deposit' ? (a) => a.type === 'cash' : (a) => a.type === 'bank';
  const toFilter = type === 'cash_withdrawal' ? (a) => a.type === 'cash' : (a) => a.type === 'bank';

  const submit = async () => {
    const v = await form.validateFields();
    const ok = await run(() => createManualEntry({ ...v, date: v.date.format('YYYY-MM-DD') }, user), 'Entry recorded');
    if (ok) {
      form.resetFields();
      onClose();
    }
  };
  return (
    <Modal open={open} onCancel={onClose} onOk={submit} confirmLoading={busy} title={tr('New accounting entry')} width={600} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ type: 'cash_deposit', date: dayjs(todayStr()), direction: 'in' }}>
        <Form.Item name="type" label={tr('Entry type')} rules={[{ required: true }]}><Select options={MANUAL_TXN_TYPES.map((o) => ({ ...o, label: tr(o.label) }))} /></Form.Item>
        <Form.Item name="date" label={tr('Date')} rules={[{ required: true }]}><DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item>
        {meta.pair ? (
          <>
            <Form.Item name="fromAccountId" label={tr('From account')} rules={[{ required: true }]}><Select options={acctOpts(fromFilter)} /></Form.Item>
            <Form.Item name="toAccountId" label={tr('To account')} rules={[{ required: true }]}><Select options={acctOpts(toFilter)} /></Form.Item>
          </>
        ) : (
          <Form.Item name="accountId" label={tr('Account')} rules={[{ required: true }]}><Select options={acctOpts(() => true)} /></Form.Item>
        )}
        {meta.direction === 'either' ? (
          <Form.Item name="direction" label={tr('Direction')}><Radio.Group options={[{ value: 'in', label: tr('Increase balance (In)') }, { value: 'out', label: tr('Decrease balance (Out)') }]} /></Form.Item>
        ) : null}
        <Form.Item name="amount" label={tr('Amount (₹)')} rules={[{ required: true }]}><InputNumber min={0.01} precision={2} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="reference" label={tr('Reference / slip no.')}><Input /></Form.Item>
        <Form.Item name="utr" label={tr('UTR / cheque no.')}><Input /></Form.Item>
        <Form.Item name="description" label={tr('Description / narration')} rules={[{ required: type === 'adjustment', message: tr('Narration is mandatory for adjustments') }]}><Input.TextArea rows={2} /></Form.Item>
        {type === 'adjustment' ? <Alert type="warning" showIcon title={tr('Adjustments are highlighted in the audit trail and notified to the admin.')} /> : null}
      </Form>
    </Modal>
  );
}

function LedgerInner() {
  const { t: tr } = useLang();
  const params = useSearchParams();
  const highlight = params.get('highlight');
  const { can, user } = useAuth();
  const app = useAppData();
  const [f, setF] = useState({});
  const [open, setOpen] = useState(false);
  const [run] = useAction();
  const [ask, reasonModal] = useReasonPrompt();
  // every filter / search runs in PostgreSQL; only the 100 lines of the current page are downloaded
  const term = normalizeSearch(useDebounced(f.text || ''));
  const searching = term.length >= 2;
  const cons = [where('financialYearId', '==', app.selectedFyId || '-')];
  if (searching) cons.push(where('searchKeywords', 'array-contains', term));
  if (f.accountId) cons.push(where('accountId', '==', f.accountId));
  if (f.type && !searching) cons.push(where('type', '==', f.type));
  if (f.from) cons.push(where('date', '>=', f.from));
  if (f.to) cons.push(where('date', '<=', f.to));
  const key = JSON.stringify([app.selectedFyId, searching ? term : '', f.accountId, searching ? '' : f.type, f.from, f.to]);
  const table = useServerTable(COL.transactions, cons, { order: bookOrder('desc'), key, enabled: !!app.selectedFy });
  const { loading } = table;
  // one account (no type / search filter) → running balance; the balance before the page is a server-side sum
  const account = app.accounts.find((a) => a.id === f.accountId);
  const showBalance = !!account && !searching && !f.type;
  const rows = useBookBalance(table, { fy: app.selectedFy, account, enabled: showBalance, dir: 'desc' });
  const totals = useAsyncValue(() => table.sumOf(['credit', 'debit']), [key, table.rows], null);
  const typeLabel = (r) => ({ ...r, type: tr(TXN_TYPES[r.type] || r.type) });
  const exportTotals = (rs) => ({ description: tr('Total'), credit: sum(rs, (r) => r.credit), debit: sum(rs, (r) => r.debit) });

  const reverse = async (t) => {
    const reason = await ask(tr('Reverse {v0} of ₹{v1}?', { v0: tr(TXN_TYPES[t.type]), v1: t.credit || t.debit }), { okText: tr('Post reversal') });
    if (reason) run(() => reverseManualEntry(t.id, reason, user), 'Reversal posted');
  };

  return (
    <Guard perm="ledger.view">
      <PageHeader
        title={tr('Transactions / Ledger')}
        subtitle={tr('Every money movement on every account · FY {fy} · {n} line(s)', { fy: app.selectedFyId, n: table.total ?? '…' })}
        extra={[
          <ExportButtons
            key="x"
            title={tr('Ledger – FY {v0}', { v0: app.selectedFyId })}
            columns={ledgerExportCols}
            rows={rows.map(typeLabel)}
            totals={exportTotals(rows)}
            getRows={async () => (await table.fetchAll()).map(typeLabel)}
            totalsFor={exportTotals}
            count={table.total}
          />,
          can('ledger.manual') ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{tr('New entry')}</Button> : null,
        ]}
      />
      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search allowClear placeholder={tr('Reference, party, UTR…')} style={{ width: 220 }} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
          <Select allowClear placeholder={tr('Account')} style={{ width: 220 }} value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} options={app.accounts.map((a) => ({ value: a.id, label: a.name }))} />
          <Select allowClear disabled={searching} title={searching ? tr('Clear the search to filter by type') : undefined} placeholder={tr('Type')} style={{ width: 170 }} value={f.type} onChange={(v) => setF({ ...f, type: v })} options={Object.entries(TXN_TYPES).map(([value, label]) => ({ value, label: tr(label) }))} />
          <DatePicker.RangePicker
            format="DD-MM-YYYY"
            value={f.from && f.to ? [dayjs(f.from), dayjs(f.to)] : null}
            onChange={(r) => setF({ ...f, from: r ? r[0].format('YYYY-MM-DD') : null, to: r ? r[1].format('YYYY-MM-DD') : null })}
            presets={[
              { label: tr('This month'), value: [dayjs().startOf('month'), dayjs()] },
              { label: tr('Last 3 months'), value: [dayjs().subtract(2, 'month').startOf('month'), dayjs()] },
              ...(app.selectedFy ? [{ label: tr('Full financial year'), value: [dayjs(app.selectedFy.startDate), dayjs(app.selectedFy.endDate)] }] : []),
            ]}
          />
        </Space>
        <ServerHint mode={searching ? 'search' : 'filters'} />
        <ServerError table={table} />
        {totals ? (
          <Space size="large" wrap style={{ marginBottom: 8, fontSize: 13 }}>
            <span>{tr('Total in (credit)')}: <Money value={totals.credit || 0} type="in" strong /></span>
            <span>{tr('Total out (debit)')}: <Money value={totals.debit || 0} type="out" strong /></span>
          </Space>
        ) : null}
        {!showBalance ? <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>{tr('Select one account (without type filter or search) to see the running balance.')}</Typography.Paragraph> : null}
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 1100 }}
          pagination={false}
          footer={() => <ServerPager table={table} />}
          rowClassName={(r) => (r.id === highlight ? 'ant-table-row-selected' : r.status === 'reversed' ? 'muted' : '')}
          columns={[
            { title: tr('Date'), dataIndex: 'date', render: fmtDate, width: 100 },
            { title: tr('Account'), dataIndex: 'accountName', width: 170, ellipsis: true },
            { title: tr('Type'), dataIndex: 'type', width: 140, render: (t, r) => <Space size={4}><Tag color={t === 'reversal' ? 'volcano' : t === 'adjustment' ? 'gold' : 'default'}>{tr(TXN_TYPES[t] || t)}</Tag>{r.status === 'reversed' ? <Tag color="red">{tr('Reversed')}</Tag> : null}</Space> },
            { title: tr('Reference'), dataIndex: 'reference', width: 150, render: (v, r) => (sourceLink(r) ? <Link href={sourceLink(r)}>{v}</Link> : v) },
            { title: tr('Party'), dataIndex: 'partyName', ellipsis: true },
            { title: tr('Description'), dataIndex: 'description', ellipsis: true },
            { title: tr('Credit (In)'), dataIndex: 'credit', align: 'right', width: 120, render: (v) => (v ? <Money value={v} type="in" /> : '') },
            { title: tr('Debit (Out)'), dataIndex: 'debit', align: 'right', width: 120, render: (v) => (v ? <Money value={v} type="out" /> : '') },
            ...(showBalance ? [{ title: tr('Balance'), dataIndex: 'balance', align: 'right', width: 130, render: (v) => <Money value={v} strong /> }] : []),
            { title: tr('By'), dataIndex: 'createdByName', width: 110, ellipsis: true, responsive: ['xl'] },
            {
              title: '', width: 50,
              render: (_, r) => (r.sourceType === 'manual' && r.type !== 'reversal' && r.status !== 'reversed' && can('ledger.manual')
                ? <Button size="small" icon={<RollbackOutlined />} title={tr('Reverse')} onClick={() => reverse(r)} /> : null),
            },
          ]}
        />
      </Card>
      {open ? <ManualEntryModal open={open} onClose={() => setOpen(false)} /> : null}
      {reasonModal}
    </Guard>
  );
}

export default function TransactionsPage() {
  const { t: tr } = useLang();
  return <Suspense><LedgerInner /></Suspense>;
}

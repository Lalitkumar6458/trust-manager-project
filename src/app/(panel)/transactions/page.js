'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Button, Card, Table, Modal, Form, Select, InputNumber, DatePicker, Input, Tag, Space, Radio, Alert, Typography,
} from 'antd';
import { PlusOutlined, RollbackOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { where } from 'firebase/firestore';
import { COL, TXN_TYPES, MANUAL_TXN_TYPES } from '@/lib/constants';
import { fmtDate, sum, todayStr } from '@/lib/format';
import { useLiveQuery, useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Money, Guard, useReasonPrompt } from '@/components/common';
import ExportButtons from '@/components/ExportButtons';
import { sourceLink } from '@/components/AccountBook';
import { createManualEntry, reverseManualEntry, withRunningBalance, fyOpeningFor } from '@/services/ledger';
import { ledgerExportCols } from '@/lib/exportCols';
import { useServerList } from '@/lib/useServerList';
import { ListStatus, LoadMoreBar } from '@/components/ServerListBits';
import { useYearStats } from '@/lib/useYearStats';
import { accountOpeningAtMonth } from '@/services/stats';
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
  const { stats } = useYearStats(app.selectedFy);
  // filters (account / type / dates / search) run on the server over the whole year, 100 newest at a time.
  // One account selected → everything in the range is loaded (from the 1st of the start month) so the
  // running balance can start from the month opening kept in the year summary.
  const list = useServerList(COL.transactions, app.selectedFy, {
    server: [
      { field: 'accountId', op: '==', value: f.accountId },
      { field: 'type', op: '==', value: f.type },
    ],
    from: f.from && f.accountId ? `${f.from.slice(0, 7)}-01` : f.from,
    to: f.to,
    text: f.text,
    forceAll: !!f.accountId,
  });
  const { loading } = list;
  const data = list.rows;

  const rows = useMemo(() => {
    const t = (f.text || '').toLowerCase();
    let out = data.filter((x) => (!f.accountId || x.accountId === f.accountId)
      && (!f.type || x.type === f.type)
      && (!f.from || x.date >= f.from) && (!f.to || x.date <= f.to)
      && (list.searching || !t || [x.reference, x.partyName, x.description, x.utr, x.chequeNo].filter(Boolean).some((v) => String(v).toLowerCase().includes(t))));
    if (f.accountId && !list.searching) {
      const acc = app.accounts.find((a) => a.id === f.accountId);
      const startOpening = f.from && stats
        ? accountOpeningAtMonth({ fy: app.selectedFy, account: acc, stats, monthKey: f.from.slice(0, 7) })
        : fyOpeningFor(app.selectedFy, acc);
      const all = withRunningBalance(data.filter((x) => x.accountId === f.accountId), startOpening);
      const bal = Object.fromEntries(all.map((x) => [x.id, x.balance]));
      out = out.map((x) => ({ ...x, balance: bal[x.id] }));
      return out.sort((a, b) => (a.date === b.date ? (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0) : a.date.localeCompare(b.date)));
    }
    return out.sort((a, b) => (b.date === a.date ? (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0) : b.date.localeCompare(a.date)));
  }, [data, f, app.accounts, app.selectedFy, stats, list.searching]);
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
        subtitle={tr('Every money movement on every account · FY {fy} · {n} line(s)', { fy: app.selectedFyId, n: list.loadedAll ? rows.length : (list.total ?? '…') })}
        extra={[
          <ExportButtons
            key="x"
            title={tr('Ledger – FY {v0}', { v0: app.selectedFyId })}
            columns={ledgerExportCols}
            rows={rows.map(typeLabel)}
            totals={exportTotals(rows)}
            getRows={f.accountId ? undefined : async () => (await list.fetchAllMatching()).filter((r) => (!f.from || r.date >= f.from)).map(typeLabel)}
            totalsFor={exportTotals}
            count={list.total}
          />,
          can('ledger.manual') ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{tr('New entry')}</Button> : null,
        ]}
      />
      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search allowClear placeholder={tr('Reference, party, UTR…')} style={{ width: 220 }} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
          <Select allowClear placeholder={tr('Account')} style={{ width: 220 }} value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} options={app.accounts.map((a) => ({ value: a.id, label: a.name }))} />
          <Select allowClear placeholder={tr('Type')} style={{ width: 170 }} value={f.type} onChange={(v) => setF({ ...f, type: v })} options={Object.entries(TXN_TYPES).map(([value, label]) => ({ value, label: tr(label) }))} />
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
        <ListStatus list={list} />
        {!f.accountId ? <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>{tr('Select one account to see the running balance.')}</Typography.Paragraph> : null}
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 1100 }}
          pagination={{ defaultPageSize: 50, showSizeChanger: true }}
          footer={() => <LoadMoreBar list={list} />}
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
            ...(f.accountId ? [{ title: tr('Balance'), dataIndex: 'balance', align: 'right', width: 130, render: (v) => <Money value={v} strong /> }] : []),
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

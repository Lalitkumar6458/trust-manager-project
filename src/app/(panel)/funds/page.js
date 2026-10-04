'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Button, Card, Table, Modal, Form, Input, Select, InputNumber, Drawer, Tabs, Progress, Row, Col, Statistic, Space, Tag,
} from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { where } from 'firebase/firestore';
import { COL, FUND_TYPES } from '@/lib/constants';
import { fmtDate, sum, round2 } from '@/lib/format';
import { useLiveQuery, useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Money, Guard, StatusTag } from '@/components/common';
import ExportButtons from '@/components/ExportButtons';
import { saveMaster } from '@/services/masters';
import { useLang } from '@/i18n/LangContext';

function FundModal({ fund, open, onClose }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const submit = async () => {
    const v = await form.validateFields();
    const payload = fund ? v : { ...v, received: 0, spent: 0, status: 'active' };
    const ok = await run(() => saveMaster(COL.funds, fund?.id, payload, user), 'Saved');
    if (ok) onClose();
  };
  return (
    <Modal open={open} onCancel={onClose} onOk={submit} confirmLoading={busy} title={fund ? tr('Edit {v0}', { v0: fund.name }) : tr('New fund / project')} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={fund || { type: 'restricted' }}>
        <Form.Item name="name" label={tr('Fund / project name')} rules={[{ required: true }]}><Input placeholder={tr('e.g. Education Fund')} /></Form.Item>
        <Form.Item name="nameHi" label={tr('Name in Hindi')}><Input /></Form.Item>
        <Form.Item name="type" label={tr('Type')}><Select options={FUND_TYPES.map((o) => ({ ...o, label: tr(o.label) }))} /></Form.Item>
        <Form.Item name="target" label={tr('Target amount (optional)')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="description" label={tr('Description / restriction')}><Input.TextArea rows={3} /></Form.Item>
        {fund ? <Form.Item name="status" label={tr('Status')}><Select options={[{ value: 'active', label: tr('Active') }, { value: 'inactive', label: tr('Inactive') }]} /></Form.Item> : null}
      </Form>
    </Modal>
  );
}

function FundDrawer({ fund, onClose }) {
  const { t: tr } = useLang();
  const { data: dons } = useLiveQuery(fund ? COL.donations : null, [where('fundIds', 'array-contains', fund?.id || '-')], [fund?.id]);
  const { data: exps } = useLiveQuery(fund ? COL.expenses : null, [where('fundId', '==', fund?.id || '-')], [fund?.id]);
  const dRows = dons.filter((d) => d.status === 'approved').map((d) => ({ ...d, fundAmount: sum(d.lines.filter((l) => l.fundId === fund?.id), (l) => l.amount) })).sort((a, b) => b.date.localeCompare(a.date));
  const eRows = exps.filter((e) => e.status === 'paid').sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Drawer open={!!fund} onClose={onClose} size={760} title={fund?.name}>
      <Tabs
        items={[
          {
            key: 'r', label: tr('Received ({v0})', { v0: dRows.length }),
            children: <Table size="small" rowKey="id" dataSource={dRows} pagination={{ pageSize: 20 }} columns={[
              { title: tr('Date'), dataIndex: 'date', render: fmtDate },
              { title: tr('Receipt'), dataIndex: 'receiptNo', render: (v, r) => <Link href={`/donations/${r.id}`}>{v}</Link> },
              { title: tr('Donor'), render: (_, r) => r.donor?.name },
              { title: tr('Amount'), dataIndex: 'fundAmount', align: 'right', render: (v) => <Money value={v} /> },
            ]} />,
          },
          {
            key: 's', label: tr('Spent ({v0})', { v0: eRows.length }),
            children: <Table size="small" rowKey="id" dataSource={eRows} pagination={{ pageSize: 20 }} columns={[
              { title: tr('Date'), dataIndex: 'date', render: fmtDate },
              { title: tr('Voucher'), dataIndex: 'voucherNo', render: (v, r) => <Link href={`/expenses/${r.id}`}>{v}</Link> },
              { title: tr('Paid to'), render: (_, r) => r.payee?.name },
              { title: tr('Purpose'), dataIndex: 'purpose' },
              { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> },
            ]} />,
          },
        ]}
      />
    </Drawer>
  );
}

export default function FundsPage() {
  const { t: tr } = useLang();
  const { can } = useAuth();
  const app = useAppData();
  const [edit, setEdit] = useState(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(null);
  const rows = app.funds.map((f) => ({ ...f, remaining: round2((f.received || 0) - (f.spent || 0)) }));
  const cols = [
    { title: tr('Fund / Project'), key: 'name', width: 2 },
    { title: tr('Type'), key: 'type', value: (r) => tr(FUND_TYPES.find((x) => x.value === r.type)?.label) },
    { title: tr('Received'), key: 'received', money: true },
    { title: tr('Spent'), key: 'spent', money: true },
    { title: tr('Remaining'), key: 'remaining', money: true },
  ];
  return (
    <Guard perm="funds.view">
      <PageHeader
        title={tr('Funds / Projects')}
        subtitle={tr('Restricted & specific-purpose fund tracking (received − spent = remaining)')}
        extra={[
          <ExportButtons key="x" title={tr('Fund-wise Report')} columns={cols} rows={rows} totals={{ name: 'Total', received: sum(rows, (r) => r.received), spent: sum(rows, (r) => r.spent), remaining: sum(rows, (r) => r.remaining) }} />,
          can('funds.manage') ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{tr('New fund')}</Button> : null,
        ]}
      />
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={8}><Card><Statistic title={tr('Received')} value={sum(rows, (r) => r.received)} prefix="₹" precision={0} /></Card></Col>
        <Col xs={8}><Card><Statistic title={tr('Spent')} value={sum(rows, (r) => r.spent)} prefix="₹" precision={0} /></Card></Col>
        <Col xs={8}><Card><Statistic title={tr('Remaining')} value={sum(rows, (r) => r.remaining)} prefix="₹" precision={0} /></Card></Col>
      </Row>
      <Card>
        <Table
          rowKey="id"
          dataSource={rows}
          scroll={{ x: 800 }}
          pagination={false}
          columns={[
            { title: tr('Fund / Project'), render: (_, r) => <a onClick={() => setView(r)}><b>{r.name}</b>{r.nameHi ? ` – ${r.nameHi}` : ''}</a> },
            { title: tr('Type'), dataIndex: 'type', render: (t) => <Tag>{tr(FUND_TYPES.find((x) => x.value === t)?.label)}</Tag> },
            { title: tr('Received'), dataIndex: 'received', align: 'right', render: (v) => <Money value={v} type="in" /> },
            { title: tr('Spent'), dataIndex: 'spent', align: 'right', render: (v) => <Money value={v} type="out" /> },
            { title: tr('Remaining'), dataIndex: 'remaining', align: 'right', render: (v) => <Money value={v} strong /> },
            { title: tr('Utilised'), width: 140, render: (_, r) => <Progress size="small" percent={r.received ? Math.round(((r.spent || 0) / r.received) * 100) : 0} status={r.remaining < 0 ? 'exception' : 'normal'} /> },
            { title: tr('Status'), dataIndex: 'status', render: (s) => <StatusTag status={s || 'active'} /> },
            { title: '', width: 50, render: (_, r) => (can('funds.manage') ? <Button size="small" icon={<EditOutlined />} onClick={() => setEdit(r)} /> : null) },
          ]}
        />
        <Space className="muted" style={{ fontSize: 12, marginTop: 8 }}>{tr('Link a donation category to a default fund in Settings → Donation Categories, or pick the fund on each donation / expense line.')}</Space>
      </Card>
      {open ? <FundModal open onClose={() => setOpen(false)} /> : null}
      {edit ? <FundModal open fund={edit} onClose={() => setEdit(null)} /> : null}
      <FundDrawer fund={view} onClose={() => setView(null)} />
    </Guard>
  );
}

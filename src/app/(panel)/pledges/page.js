'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import {
  Card, Table, Button, Segmented, Space, Modal, Form, Select, InputNumber, Input, Row, Col, Tag, Typography, Statistic, Tooltip,
} from 'antd';
import { PlusOutlined, EditOutlined, GiftOutlined, ForwardOutlined } from '@ant-design/icons';
import { Guard, PageHeader, Money, useReasonPrompt } from '@/components/common';
import PartySelect from '@/components/PartySelect';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { useAction, useLiveQuery } from '@/lib/hooks';
import { rpc } from '@/lib/api';
import { orderBy, limit } from '@/lib/q';
import { COL } from '@/lib/constants';
import { fmtDate, todayStr, money } from '@/lib/format';
import { useLang } from '@/i18n/LangContext';

const FREQ = [
  { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'halfYearly', label: 'Half-yearly' },
  { value: 'yearly', label: 'Yearly' }, { value: 'once', label: 'One time' },
];
const STATUS_COLOR = { active: 'green', paused: 'orange', completed: 'blue', cancelled: 'default' };

function PledgeModal({ open, onClose, pledge }) {
  const { t: tr, pick } = useLang();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const submit = async () => {
    const v = await form.validateFields();
    const ok = await run(() => rpc('pledges.save', pledge?.id || null, v), pledge ? 'Saved' : 'Sankalp added');
    if (ok) onClose();
  };
  return (
    <Modal open={open} onCancel={onClose} onOk={submit} confirmLoading={busy} title={pledge ? `${tr('Edit sankalp')} ${pledge.pledgeNo}` : tr('New sankalp')} width={640} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={pledge ? { ...pledge } : { frequency: 'monthly', startDate: todayStr(), remindDaysBefore: 3 }}
      >
        <Form.Item name="donorId" label={tr('Donor')} rules={[{ required: true }]}><PartySelect kind="donor" disabled={!!pledge} /></Form.Item>
        <Row gutter={12}>
          <Col xs={24} md={12}><Form.Item name="categoryId" label={tr('Category')}><Select allowClear options={app.activeDonationCategories.map((c) => ({ value: c.id, label: pick(c.name, c.nameHi) }))} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="amount" label={tr('Amount (₹)')} rules={[{ required: true }]}><InputNumber min={1} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="frequency" label={tr('How often')}><Select options={FREQ.map((f) => ({ value: f.value, label: tr(f.label) }))} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="startDate" label={tr('First due date')} rules={[{ required: true }]}><Input type="date" /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="endDate" label={tr('Until (optional)')}><Input type="date" /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="remindDaysBefore" label={tr('Remind days before')}><InputNumber min={0} max={30} style={{ width: '100%' }} /></Form.Item></Col>
          {pledge ? <Col xs={12} md={8}><Form.Item name="status" label={tr('Status')}><Select options={['active', 'paused', 'completed', 'cancelled'].map((s) => ({ value: s, label: tr(s) }))} /></Form.Item></Col> : null}
          <Col xs={24}><Form.Item name="purpose" label={tr('Purpose / उद्देश्य')}><Input /></Form.Item></Col>
          <Col xs={24}><Form.Item name="notes" label={tr('Notes')}><Input.TextArea rows={2} /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}

export default function PledgesPage() {
  const { t: tr, pick } = useLang();
  const { can } = useAuth();
  const [run] = useAction();
  const [ask, reasonModal] = useReasonPrompt();
  const [tab, setTab] = useState('due');
  const [edit, setEdit] = useState(null);
  const { data, loading } = useLiveQuery(COL.pledges, [orderBy('nextDue', 'asc'), limit(2000)], []);
  const today = todayStr();
  const soon = dayjs(today).add(7, 'day').format('YYYY-MM-DD');
  const rows = useMemo(() => data.filter((p) => {
    if (tab === 'due') return p.status === 'active' && p.nextDue && p.nextDue <= soon;
    if (tab === 'active') return p.status === 'active';
    return true;
  }), [data, tab, soon]);
  const active = data.filter((p) => p.status === 'active');
  const overdue = active.filter((p) => p.nextDue && p.nextDue < today);
  const monthly = active.reduce((s, p) => s + (p.frequency === 'monthly' ? p.amount : p.frequency === 'quarterly' ? p.amount / 3 : p.frequency === 'halfYearly' ? p.amount / 6 : p.frequency === 'yearly' ? p.amount / 12 : 0), 0);
  const manage = can('pledges.manage');

  const receiveHref = (p) => `/donations/new?donor=${encodeURIComponent(p.donorId)}&pledge=${encodeURIComponent(p.id)}&amount=${p.amount}${p.categoryId ? `&category=${encodeURIComponent(p.categoryId)}` : ''}`;
  const skip = async (p) => {
    const reason = await ask(tr('Skip this instalment ({v0})?', { v0: fmtDate(p.nextDue) }), { okText: 'Skip', danger: false });
    if (reason) run(() => rpc('pledges.skip', p.id, reason), 'Instalment skipped');
  };

  return (
    <Guard perm="pledges.view">
      <PageHeader
        title={tr('Sankalp / pledges')}
        subtitle={tr('Regular donations promised by donors – reminders go out automatically before the due date.')}
        extra={[manage ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => setEdit({})}>{tr('New sankalp')}</Button> : null]}
      />
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Active sankalp')} value={active.length} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Overdue')} value={overdue.length} styles={{ content: { color: overdue.length ? '#a8071a' : undefined } }} /></Card></Col>
        <Col xs={24} md={12}><Card size="small"><Statistic title={tr('Expected per month (approx.)')} value={money(monthly)} /></Card></Col>
      </Row>
      <Card size="small">
        <Segmented value={tab} onChange={setTab} style={{ marginBottom: 12 }} options={[{ value: 'due', label: tr('Due in 7 days / overdue') }, { value: 'active', label: tr('Active') }, { value: 'all', label: tr('All') }]} />
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 900 }}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          columns={[
            { title: tr('No.'), dataIndex: 'pledgeNo', width: 90 },
            { title: tr('Donor'), dataIndex: 'donorName', render: (v, r) => <span><Link href={`/donors/${r.donorId}`}>{v}</Link>{r.mobile ? <><br /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.mobile}</Typography.Text></> : null}</span> },
            { title: tr('Category'), render: (_, r) => pick(r.categoryName, r.categoryNameHi) || '—' },
            { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> },
            { title: tr('How often'), dataIndex: 'frequency', render: (v) => tr(FREQ.find((f) => f.value === v)?.label || v) },
            {
              title: tr('Next due'), dataIndex: 'nextDue',
              render: (v, r) => (!v ? '—' : <span style={{ color: r.status === 'active' && v < today ? '#a8071a' : undefined, fontWeight: v <= today ? 600 : 400 }}>{fmtDate(v)}</span>),
            },
            { title: tr('Received'), render: (_, r) => <span>{r.receivedCount || 0} · <Money value={r.receivedTotal || 0} /></span> },
            { title: tr('Status'), dataIndex: 'status', render: (v) => <Tag color={STATUS_COLOR[v]}>{tr(v)}</Tag> },
            {
              title: '', width: 150,
              render: (_, r) => (
                <Space size={4}>
                  {r.status === 'active' && r.nextDue && can('donations.create') ? <Tooltip title={tr('Receive (make receipt)')}><Link href={receiveHref(r)}><Button size="small" type="primary" icon={<GiftOutlined />} /></Link></Tooltip> : null}
                  {r.status === 'active' && r.nextDue && manage ? <Tooltip title={tr('Skip this instalment')}><Button size="small" icon={<ForwardOutlined />} onClick={() => skip(r)} /></Tooltip> : null}
                  {manage ? <Button size="small" icon={<EditOutlined />} onClick={() => setEdit(r)} /> : null}
                </Space>
              ),
            },
          ]}
        />
      </Card>
      {reasonModal}
      {edit ? <PledgeModal open onClose={() => setEdit(null)} pledge={edit.id ? edit : null} /> : null}
    </Guard>
  );
}

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import {
  Card, Table, Button, Tabs, Modal, Form, Input, InputNumber, Select, Row, Col, Tag, Space, DatePicker, Typography, Switch, Segmented, Checkbox, Statistic,
} from 'antd';
import { PlusOutlined, EditOutlined, PrinterOutlined, CheckOutlined, StopOutlined, FileDoneOutlined } from '@ant-design/icons';
import { Guard, PageHeader, Money, useReasonPrompt } from '@/components/common';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { useAction, useLiveQuery } from '@/lib/hooks';
import { rpc, fetchOne } from '@/lib/api';
import { where, orderBy, limit } from '@/lib/q';
import { COL, isCashMode } from '@/lib/constants';
import { fmtDate, money, todayStr } from '@/lib/format';
import { donationReceiptPdf } from '@/pdf/generate';
import { useLang } from '@/i18n/LangContext';

const STATUS = { booked: 'blue', done: 'green', cancelled: 'default' };
const MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque'];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function TypeModal({ type, onClose }) {
  const { t: tr, pick } = useLang();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const ok = async () => { const v = await form.validateFields(); if (await run(() => rpc('seva.saveType', type?.id || null, v), 'Saved')) onClose(); };
  return (
    <Modal open onCancel={onClose} onOk={ok} confirmLoading={busy} title={type?.id ? tr('Edit seva') : tr('New seva')} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ active: true, dailyLimit: 0, ...type }}>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="name" label={tr('Name')} rules={[{ required: true }]}><Input placeholder="Abhishek" /></Form.Item></Col>
          <Col span={12}><Form.Item name="nameHi" label={tr('Name (Hindi)')}><Input placeholder="अभिषेक" /></Form.Item></Col>
          <Col span={12}><Form.Item name="amount" label={tr('Amount (₹)')} rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item name="dailyLimit" label={tr('Daily limit (0 = no limit)')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item name="time" label={tr('Time')}><Input placeholder="06:00 AM" /></Form.Item></Col>
          <Col span={12}><Form.Item name="categoryId" label={tr('Receipt category')} rules={[{ required: true }]}><Select options={app.activeDonationCategories.map((c) => ({ value: c.id, label: pick(c.name, c.nameHi) }))} /></Form.Item></Col>
        </Row>
        <Form.Item name="description" label={tr('Description')}><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="active" label={tr('Active')} valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Modal>
  );
}

function PayFields({ form }) {
  const { t: tr } = useLang();
  const app = useAppData();
  const mode = Form.useWatch(['receipt', 'paymentMode'], form) || 'Cash';
  const accounts = app.activeAccounts.filter((a) => (isCashMode(mode) ? a.type === 'cash' : a.type === 'bank'));
  return (
    <Row gutter={12}>
      <Col xs={24} md={8}><Form.Item name={['receipt', 'paymentMode']} label={tr('Payment mode')} initialValue="Cash"><Select options={MODES.map((m) => ({ value: m, label: tr(m) }))} onChange={() => form.setFieldValue(['receipt', 'accountId'], undefined)} /></Form.Item></Col>
      <Col xs={24} md={8}><Form.Item name={['receipt', 'accountId']} label={tr('Account')} rules={[{ required: true }]} initialValue={accounts[0]?.id}><Select options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Form.Item></Col>
      {!isCashMode(mode) ? <Col xs={24} md={8}><Form.Item name={['receipt', mode === 'Cheque' ? 'chequeNo' : 'utr']} label={mode === 'Cheque' ? tr('Cheque / DD no.') : tr('Transaction ID / UTR')} rules={[{ required: true }]}><Input /></Form.Item></Col> : null}
    </Row>
  );
}

function BookModal({ types, onClose, date }) {
  const { t: tr, pick } = useLang();
  const { can, user } = useAuth();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const [withReceipt, setWithReceipt] = useState(can('donations.create'));
  const typeId = Form.useWatch('sevaTypeId', form);
  const qty = Form.useWatch('qty', form) || 1;
  const t = types.find((x) => x.id === typeId);
  const ok = async () => {
    const v = await form.validateFields();
    const input = { ...v, sevaDate: v.sevaDate.format('YYYY-MM-DD'), receipt: withReceipt ? { ...v.receipt, approve: can('donations.approve') && can('donations.verify') } : null };
    const id = await run(() => rpc('seva.book', input), 'Seva booked');
    if (!id) return;
    if (withReceipt) {
      const b = await fetchOne(COL.sevaBookings, id);
      if (b?.donationId) {
        const d = await fetchOne(COL.donations, b.donationId);
        await donationReceiptPdf({ donation: d, settings: app.settings, categories: app.donationCategories, mode: 'print' });
      }
    }
    onClose();
  };
  return (
    <Modal open onCancel={onClose} onOk={ok} confirmLoading={busy} width={680} title={tr('Book seva')} okText={withReceipt ? tr('Book & print receipt') : tr('Book')} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ sevaDate: dayjs(date || todayStr()), qty: 1 }}>
        <Row gutter={12}>
          <Col xs={24} md={12}><Form.Item name="sevaTypeId" label={tr('Seva')} rules={[{ required: true }]}><Select options={types.filter((x) => x.active !== false).map((x) => ({ value: x.id, label: `${pick(x.name, x.nameHi)} – ${money(x.amount)}` }))} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="sevaDate" label={tr('Seva date')} rules={[{ required: true }]}><DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="qty" label={tr('Quantity')}><InputNumber min={1} max={100} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name={['devotee', 'name']} label={tr('Devotee name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name={['devotee', 'mobile']} label={tr('Mobile')} rules={[{ pattern: /^[6-9]\d{9}$/, message: tr('10 digit mobile') }]}><Input maxLength={10} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name={['devotee', 'gotra']} label={tr('Gotra')}><Input /></Form.Item></Col>
          <Col xs={24} md={16}><Form.Item name={['devotee', 'names']} label={tr('Sankalp names (family)')}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="amount" label={tr('Amount (₹)')} extra={t ? `${tr('Default')}: ${money(t.amount * qty)}` : null}><InputNumber min={0} style={{ width: '100%' }} placeholder={t ? String(t.amount * qty) : ''} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="note" label={tr('Note')}><Input /></Form.Item></Col>
        </Row>
        {can('donations.create') ? <Checkbox checked={withReceipt} onChange={(e) => setWithReceipt(e.target.checked)} style={{ marginBottom: 8 }}>{tr('Payment received now – make the receipt')}</Checkbox> : null}
        {withReceipt ? <PayFields form={form} /> : null}
      </Form>
    </Modal>
  );
}

function ReceiptModal({ booking, onClose }) {
  const { t: tr } = useLang();
  const { can } = useAuth();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const ok = async () => {
    const v = await form.validateFields();
    const did = await run(() => rpc('seva.receipt', booking.id, { ...v.receipt, approve: can('donations.approve') && can('donations.verify') }), 'Receipt created');
    if (did) {
      const d = await fetchOne(COL.donations, did);
      await donationReceiptPdf({ donation: d, settings: app.settings, categories: app.donationCategories, mode: 'print' });
      onClose();
    }
  };
  return (
    <Modal open onCancel={onClose} onOk={ok} confirmLoading={busy} title={`${tr('Receipt for')} ${booking.sevaNo} · ${money(booking.amount)}`} destroyOnHidden>
      <Form form={form} layout="vertical"><PayFields form={form} /></Form>
    </Modal>
  );
}

export default function SevaPage() {
  const { t: tr, pick } = useLang();
  const { can } = useAuth();
  const [run] = useAction();
  const [ask, reasonModal] = useReasonPrompt();
  const [date, setDate] = useState(dayjs(todayStr()));
  const [book, setBook] = useState(false);
  const [typeEdit, setTypeEdit] = useState(null);
  const [rcpt, setRcpt] = useState(null);
  const ds = date.format('YYYY-MM-DD');
  const { data: types } = useLiveQuery(COL.sevaTypes, [orderBy('name', 'asc')], []);
  const { data: day, loading } = useLiveQuery(COL.sevaBookings, [where('sevaDate', '==', ds), limit(1000)], [ds]);
  const { data: upcoming } = useLiveQuery(COL.sevaBookings, [where('sevaDate', '>=', todayStr()), orderBy('sevaDate', 'asc'), limit(500)], []);
  const manage = can('seva.manage');
  const active = day.filter((b) => b.status !== 'cancelled');
  const byType = useMemo(() => {
    const m = {};
    active.forEach((b) => { m[b.sevaTypeId] = (m[b.sevaTypeId] || 0) + (b.qty || 1); });
    return m;
  }, [active]);
  const setStatus = async (b, status) => {
    if (status === 'cancelled') {
      const reason = await ask(tr('Cancel seva {v0}?', { v0: b.sevaNo }));
      if (reason) run(() => rpc('seva.status', b.id, 'cancelled', reason), 'Updated');
    } else run(() => rpc('seva.status', b.id, status, ''), 'Updated');
  };
  const printList = () => {
    const w = window.open('', '_blank');
    const rows = active.sort((a, b) => (a.sevaTime || '').localeCompare(b.sevaTime || '') || a.sevaName.localeCompare(b.sevaName))
      .map((b, i) => `<tr><td>${i + 1}</td><td>${esc(b.sevaNameHi || b.sevaName)}</td><td>${esc(b.sevaTime)}</td><td>${esc(b.devotee?.name)}</td><td>${esc(b.devotee?.gotra)}</td><td>${esc(b.devotee?.names)}</td><td>${esc(b.qty)}</td></tr>`).join('');
    w.document.write(`<html><head><meta charset="utf-8"><title>Seva list ${ds}</title><style>body{font-family:sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px;font-size:14px;text-align:left}</style></head><body><h2>सेवा सूची / Seva list – ${fmtDate(ds)}</h2><table><tr><th>#</th><th>सेवा</th><th>समय</th><th>नाम</th><th>गोत्र</th><th>संकल्प</th><th>संख्या</th></tr>${rows}</table><script>window.print()</script></body></html>`);
    w.document.close();
  };
  const cols = [
    { title: tr('No.'), dataIndex: 'sevaNo', width: 90 },
    { title: tr('Seva'), render: (_, b) => <span>{pick(b.sevaName, b.sevaNameHi)}{b.sevaTime ? <Typography.Text type="secondary"> · {b.sevaTime}</Typography.Text> : null}</span> },
    { title: tr('Date'), dataIndex: 'sevaDate', render: fmtDate, width: 100 },
    { title: tr('Devotee'), render: (_, b) => <span>{b.devotee?.name}{b.devotee?.gotra ? ` (${b.devotee.gotra})` : ''}<br /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{b.devotee?.mobile} {b.devotee?.names}</Typography.Text></span> },
    { title: tr('Qty'), dataIndex: 'qty', width: 50 },
    { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> },
    { title: tr('Receipt'), dataIndex: 'receiptNo', render: (v, b) => (b.donationId ? <Link href={`/donations/${b.donationId}`}>{v}</Link> : <Tag color="orange">{tr('Not paid')}</Tag>) },
    { title: tr('Status'), dataIndex: 'status', render: (s) => <Tag color={STATUS[s]}>{tr(s)}</Tag> },
    {
      title: '', width: 130,
      render: (_, b) => (manage && b.status !== 'cancelled' ? (
        <Space size={4}>
          {!b.donationId && can('donations.create') ? <Button size="small" type="primary" icon={<FileDoneOutlined />} title={tr('Make receipt')} onClick={() => setRcpt(b)} /> : null}
          {b.status === 'booked' ? <Button size="small" icon={<CheckOutlined />} title={tr('Mark done')} onClick={() => setStatus(b, 'done')} /> : null}
          <Button size="small" danger icon={<StopOutlined />} title={tr('Cancel')} onClick={() => setStatus(b, 'cancelled')} />
        </Space>
      ) : null),
    },
  ];
  return (
    <Guard perm="seva.view">
      <PageHeader
        title={tr('Seva / pooja booking')}
        subtitle={tr('Book sevas, print the day list for the pujari – payment becomes a normal donation receipt.')}
        extra={[manage ? <Button key="b" type="primary" icon={<PlusOutlined />} disabled={!types.length} onClick={() => setBook(true)}>{tr('Book seva')}</Button> : null]}
      />
      <Card size="small">
        <Tabs
          items={[
            {
              key: 'day', label: tr('Day list'),
              children: (
                <>
                  <Space wrap style={{ marginBottom: 8 }}>
                    <DatePicker value={date} onChange={(v) => v && setDate(v)} format="DD-MM-YYYY" allowClear={false} />
                    <Segmented options={[{ value: 0, label: tr('Today') }, { value: 1, label: tr('Tomorrow') }]} onChange={(v) => setDate(dayjs(todayStr()).add(v, 'day'))} />
                    <Button icon={<PrinterOutlined />} disabled={!active.length} onClick={printList}>{tr('Print list for pujari')}</Button>
                  </Space>
                  <Row gutter={12} style={{ marginBottom: 8 }}>
                    {types.filter((x) => x.active !== false).slice(0, 6).map((x) => (
                      <Col key={x.id} xs={12} md={4}><Card size="small"><Statistic title={pick(x.name, x.nameHi)} value={byType[x.id] || 0} suffix={x.dailyLimit ? `/ ${x.dailyLimit}` : ''} /></Card></Col>
                    ))}
                  </Row>
                  <Table size="small" rowKey="id" loading={loading} dataSource={day} columns={cols} scroll={{ x: 900 }} pagination={false} />
                </>
              ),
            },
            { key: 'up', label: tr('Upcoming'), children: <Table size="small" rowKey="id" dataSource={upcoming} columns={cols} scroll={{ x: 900 }} pagination={{ pageSize: 30 }} /> },
            {
              key: 'types', label: tr('Seva list & rates'),
              children: (
                <>
                  {manage ? <Button icon={<PlusOutlined />} style={{ marginBottom: 8 }} onClick={() => setTypeEdit({})}>{tr('New seva')}</Button> : null}
                  <Table
                    size="small"
                    rowKey="id"
                    dataSource={types}
                    pagination={false}
                    columns={[
                      { title: tr('Seva'), render: (_, x) => pick(x.name, x.nameHi) },
                      { title: tr('Amount'), dataIndex: 'amount', render: (v) => <Money value={v} /> },
                      { title: tr('Time'), dataIndex: 'time' },
                      { title: tr('Daily limit (0 = no limit)'), dataIndex: 'dailyLimit' },
                      { title: tr('Receipt category'), dataIndex: 'categoryName' },
                      { title: tr('Status'), dataIndex: 'active', render: (a) => (a === false ? <Tag>{tr('inactive')}</Tag> : <Tag color="green">{tr('active')}</Tag>) },
                      { title: '', render: (_, x) => (manage ? <Button size="small" icon={<EditOutlined />} onClick={() => setTypeEdit(x)} /> : null) },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>
      {reasonModal}
      {book ? <BookModal types={types} date={ds} onClose={() => setBook(false)} /> : null}
      {typeEdit ? <TypeModal type={typeEdit.id ? typeEdit : null} onClose={() => setTypeEdit(null)} /> : null}
      {rcpt ? <ReceiptModal booking={rcpt} onClose={() => setRcpt(null)} /> : null}
    </Guard>
  );
}

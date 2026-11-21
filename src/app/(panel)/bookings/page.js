'use client';

import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  Card, Table, Button, Tabs, Modal, Form, Input, InputNumber, Select, Row, Col, Tag, Space, DatePicker, Typography, Tooltip, Switch, Statistic, Alert,
} from 'antd';
import { PlusOutlined, EditOutlined, DollarOutlined, RollbackOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Guard, PageHeader, Money } from '@/components/common';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { useAction, useLiveQuery } from '@/lib/hooks';
import { rpc } from '@/lib/api';
import { where, orderBy, limit } from '@/lib/q';
import { COL, ID_TYPES } from '@/lib/constants';
import { fmtDate, money, round2, todayStr } from '@/lib/format';
import { useLang } from '@/i18n/LangContext';

const STATUS = { tentative: 'orange', confirmed: 'blue', checked_in: 'purple', completed: 'green', cancelled: 'default' };
const TYPES = ['hall', 'room', 'dharamshala', 'ground', 'other'];

function ResourceModal({ res, onClose }) {
  const { t: tr } = useLang();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const ok = async () => { const v = await form.validateFields(); if (await run(() => rpc('bookings.saveResource', res?.id || null, v), 'Saved')) onClose(); };
  return (
    <Modal open onCancel={onClose} onOk={ok} confirmLoading={busy} title={res?.id ? tr('Edit hall / room') : tr('New hall / room')} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ type: 'hall', active: true, ...res }}>
        <Form.Item name="name" label={tr('Name')} rules={[{ required: true }]}><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="type" label={tr('Type')}><Select options={TYPES.map((t) => ({ value: t, label: tr(t) }))} /></Form.Item></Col>
          <Col span={12}><Form.Item name="capacity" label={tr('Capacity (persons)')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item name="rentPerDay" label={tr('Rent per day (₹)')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item name="deposit" label={tr('Security deposit (₹)')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        <Form.Item name="notes" label={tr('Notes')}><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="active" label={tr('Active')} valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Modal>
  );
}

function BookingModal({ booking, resources, onClose, preset }) {
  const { t: tr } = useLang();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const resId = Form.useWatch('resourceId', form);
  const range = Form.useWatch('range', form);
  const res = resources.find((r) => r.id === resId);
  const nDays = range?.[0] && range?.[1] ? range[1].diff(range[0], 'day') + 1 : 0;
  const suggest = () => { if (res && nDays) form.setFieldsValue({ rent: round2(res.rentPerDay * nDays), deposit: res.deposit }); };
  const ok = async () => {
    const v = await form.validateFields();
    const input = { ...v, fromDate: v.range[0].format('YYYY-MM-DD'), toDate: v.range[1].format('YYYY-MM-DD') };
    delete input.range;
    if (await run(() => rpc('bookings.save', booking?.id || null, input), booking ? 'Saved' : 'Booking saved')) onClose();
  };
  const init = booking
    ? { ...booking, range: [dayjs(booking.fromDate), dayjs(booking.toDate)] }
    : { status: 'confirmed', resourceId: preset?.resourceId, range: preset?.date ? [dayjs(preset.date), dayjs(preset.date)] : undefined };
  return (
    <Modal open onCancel={onClose} onOk={ok} confirmLoading={busy} width={720} title={booking ? `${tr('Booking')} ${booking.bookingNo}` : tr('New booking')} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={init}>
        <Row gutter={12}>
          <Col xs={24} md={12}><Form.Item name="resourceId" label={tr('Hall / room')} rules={[{ required: true }]}><Select onChange={() => setTimeout(suggest, 0)} options={resources.filter((r) => r.active !== false).map((r) => ({ value: r.id, label: `${r.name} (${money(r.rentPerDay)}/${tr('day')})` }))} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="range" label={tr('From – to')} rules={[{ required: true }]}><DatePicker.RangePicker format="DD-MM-YYYY" style={{ width: '100%' }} onChange={() => setTimeout(suggest, 0)} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name={['guest', 'name']} label={tr('Guest / party name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name={['guest', 'mobile']} label={tr('Mobile')} rules={[{ pattern: /^[6-9]\d{9}$/, message: tr('10 digit mobile') }]}><Input maxLength={10} /></Form.Item></Col>
          <Col xs={24}><Form.Item name={['guest', 'address']} label={tr('Address')}><Input /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name={['guest', 'idType']} label={tr('ID proof')}><Select allowClear options={ID_TYPES.map((x) => ({ value: x, label: tr(x) }))} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name={['guest', 'idNumber']} label={tr('ID number')}><Input /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="persons" label={tr('Persons')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="purpose" label={tr('Purpose (wedding, satsang …)')}><Input /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="rent" label={`${tr('Rent')} (${nDays} ${tr('days')})`}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="discount" label={tr('Discount')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="deposit" label={tr('Deposit')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="status" label={tr('Status')}><Select options={Object.keys(STATUS).map((s) => ({ value: s, label: tr(s) }))} /></Form.Item></Col>
          <Col xs={24}><Form.Item name="notes" label={tr('Notes')}><Input.TextArea rows={2} /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}

function MoneyModal({ booking, kind, onClose }) {
  const { t: tr } = useLang();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const depositPaid = (booking.payments || []).filter((p) => p.kind === 'deposit').reduce((s, p) => s + p.amount, 0);
  const due = round2(booking.total - (booking.paid || 0));
  const refundable = round2(depositPaid - (booking.depositRefunded || 0));
  const ok = async () => {
    const v = await form.validateFields();
    const input = { ...v, date: v.date.format('YYYY-MM-DD') };
    if (await run(() => rpc(kind === 'refund' ? 'bookings.refund' : 'bookings.payment', booking.id, input), kind === 'refund' ? 'Deposit refunded' : 'Payment recorded')) onClose();
  };
  return (
    <Modal open onCancel={onClose} onOk={ok} confirmLoading={busy} title={kind === 'refund' ? tr('Refund deposit') : tr('Receive payment')} destroyOnHidden>
      <Typography.Paragraph type="secondary">{booking.bookingNo} · {booking.guest?.name} · {kind === 'refund' ? `${tr('Refundable')}: ${money(refundable)}` : `${tr('Due')}: ${money(due)}`}</Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ date: dayjs(), amount: kind === 'refund' ? refundable : due, kind: (booking.paid || 0) < (booking.rent - (booking.discount || 0)) ? 'rent' : 'deposit' }}>
        {kind !== 'refund' ? <Form.Item name="kind" label={tr('For')}><Select options={[{ value: 'rent', label: tr('Rent') }, { value: 'deposit', label: tr('Deposit') }]} /></Form.Item> : null}
        <Form.Item name="amount" label={tr('Amount (₹)')} rules={[{ required: true }]}><InputNumber min={0.01} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="accountId" label={tr('Cash / bank account')} rules={[{ required: true }]}><Select options={app.activeAccounts.map((a) => ({ value: a.id, label: a.name }))} /></Form.Item>
        <Form.Item name="date" label={tr('Date')}><DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item>
        {kind === 'refund' ? <Form.Item name="note" label={tr('Note (deduction reason etc.)')}><Input /></Form.Item> : <Form.Item name="utr" label={tr('UTR / reference (optional)')}><Input /></Form.Item>}
      </Form>
    </Modal>
  );
}

function CalendarGrid({ resources, bookings, month, onCell, onOpen }) {
  const { t: tr } = useLang();
  const start = month.startOf('month');
  const n = month.daysInMonth();
  const daysArr = Array.from({ length: n }, (_, i) => start.add(i, 'day'));
  const cell = (r, d) => {
    const ds = d.format('YYYY-MM-DD');
    return bookings.find((b) => b.resourceId === r.id && b.status !== 'cancelled' && b.fromDate <= ds && b.toDate >= ds);
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 4, position: 'sticky', left: 0, background: '#fff', minWidth: 140 }}>{tr('Hall / room')}</th>
            {daysArr.map((d) => <th key={d.date()} style={{ padding: 2, width: 28, color: d.day() === 0 ? '#a8071a' : undefined, background: d.format('YYYY-MM-DD') === todayStr() ? '#fff7e6' : undefined }}>{d.date()}<br /><span style={{ fontWeight: 400, color: '#999' }}>{d.format('dd')}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {resources.filter((r) => r.active !== false).map((r) => (
            <tr key={r.id}>
              <td style={{ padding: 4, borderTop: '1px solid #eee', position: 'sticky', left: 0, background: '#fff' }}><b>{r.name}</b></td>
              {daysArr.map((d) => {
                const b = cell(r, d);
                return (
                  <td key={d.date()} style={{ borderTop: '1px solid #eee', borderLeft: '1px solid #f3f3f3', height: 30, padding: 0 }}>
                    {b ? (
                      <Tooltip title={`${b.bookingNo} · ${b.guest?.name} · ${fmtDate(b.fromDate)}–${fmtDate(b.toDate)}`}>
                        <div onClick={() => onOpen(b)} style={{ cursor: 'pointer', height: 30, background: { tentative: '#ffd591', confirmed: '#91caff', checked_in: '#d3adf7', completed: '#b7eb8f' }[b.status] || '#eee' }} />
                      </Tooltip>
                    ) : <div onClick={() => onCell(r, d)} style={{ cursor: 'pointer', height: 30 }} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Space style={{ marginTop: 8 }} wrap>{['tentative', 'confirmed', 'checked_in', 'completed'].map((s) => <Tag key={s} color={STATUS[s]}>{tr(s)}</Tag>)}<Typography.Text type="secondary" style={{ fontSize: 12 }}>{tr('Click an empty day to book.')}</Typography.Text></Space>
    </div>
  );
}

export default function BookingsPage() {
  const { t: tr } = useLang();
  const { can } = useAuth();
  const [month, setMonth] = useState(dayjs().startOf('month'));
  const [edit, setEdit] = useState(null);
  const [resEdit, setResEdit] = useState(null);
  const [moneyFor, setMoneyFor] = useState(null);
  const { data: resources } = useLiveQuery(COL.bookingResources, [orderBy('name', 'asc')], []);
  const from = month.subtract(1, 'month').format('YYYY-MM-DD');
  const { data: bookings, loading } = useLiveQuery(COL.bookings, [where('toDate', '>=', from), orderBy('toDate', 'asc'), limit(2000)], [from]);
  const manage = can('bookings.manage');
  const upcoming = useMemo(() => bookings.filter((b) => b.toDate >= todayStr() && b.status !== 'cancelled').sort((a, b) => a.fromDate.localeCompare(b.fromDate)), [bookings]);
  const dueTotal = upcoming.reduce((s, b) => s + Math.max(0, (b.total || 0) - (b.paid || 0)), 0);

  const listCols = [
    { title: tr('No.'), dataIndex: 'bookingNo', width: 90 },
    { title: tr('Hall / room'), dataIndex: 'resourceName' },
    { title: tr('Dates'), render: (_, b) => `${fmtDate(b.fromDate)} – ${fmtDate(b.toDate)} (${b.days})` },
    { title: tr('Guest'), render: (_, b) => <span>{b.guest?.name}<br /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{b.guest?.mobile} {b.purpose ? `· ${b.purpose}` : ''}</Typography.Text></span> },
    { title: tr('Total'), dataIndex: 'total', align: 'right', render: (v) => <Money value={v} /> },
    { title: tr('Received'), dataIndex: 'paid', align: 'right', render: (v, b) => <span style={{ color: (v || 0) < b.total ? '#d46b08' : '#237804' }}><Money value={v || 0} /></span> },
    { title: tr('Status'), dataIndex: 'status', render: (s) => <Tag color={STATUS[s]}>{tr(s)}</Tag> },
    {
      title: '', width: 120,
      render: (_, b) => (manage ? (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => setEdit(b)} />
          {b.status !== 'cancelled' && (b.paid || 0) < b.total ? <Tooltip title={tr('Receive payment')}><Button size="small" type="primary" icon={<DollarOutlined />} onClick={() => setMoneyFor({ b, kind: 'pay' })} /></Tooltip> : null}
          {(b.payments || []).some((p) => p.kind === 'deposit') ? <Tooltip title={tr('Refund deposit')}><Button size="small" icon={<RollbackOutlined />} onClick={() => setMoneyFor({ b, kind: 'refund' })} /></Tooltip> : null}
        </Space>
      ) : null),
    },
  ];

  return (
    <Guard perm="bookings.view">
      <PageHeader
        title={tr('Hall / room booking')}
        subtitle={tr('Dharamshala, hall and room bookings – rent and deposit go to the cash / bank book.')}
        extra={[manage ? <Button key="n" type="primary" icon={<PlusOutlined />} disabled={!resources.length} onClick={() => setEdit({})}>{tr('New booking')}</Button> : null]}
      />
      {!resources.length ? <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tr('First add your halls / rooms in the “Halls & rooms” tab.')} /> : null}
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Upcoming bookings')} value={upcoming.length} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Amount still to receive')} value={money(dueTotal)} styles={{ content: { color: dueTotal ? '#d46b08' : undefined } }} /></Card></Col>
      </Row>
      <Card size="small">
        <Tabs
          items={[
            {
              key: 'cal', label: tr('Calendar'),
              children: (
                <>
                  <Space style={{ marginBottom: 8 }}>
                    <Button icon={<LeftOutlined />} onClick={() => setMonth(month.subtract(1, 'month'))} />
                    <DatePicker picker="month" value={month} onChange={(v) => v && setMonth(v.startOf('month'))} allowClear={false} format="MMM YYYY" />
                    <Button icon={<RightOutlined />} onClick={() => setMonth(month.add(1, 'month'))} />
                  </Space>
                  <CalendarGrid resources={resources} bookings={bookings} month={month} onCell={(r, d) => manage && setEdit({ preset: { resourceId: r.id, date: d.format('YYYY-MM-DD') } })} onOpen={(b) => setEdit(b)} />
                </>
              ),
            },
            { key: 'up', label: `${tr('Upcoming')} (${upcoming.length})`, children: <Table size="small" rowKey="id" loading={loading} dataSource={upcoming} columns={listCols} scroll={{ x: 900 }} pagination={{ pageSize: 30 }} /> },
            { key: 'all', label: tr('All'), children: <Table size="small" rowKey="id" loading={loading} dataSource={[...bookings].reverse()} columns={listCols} scroll={{ x: 900 }} pagination={{ pageSize: 30 }} /> },
            {
              key: 'res', label: tr('Halls & rooms'),
              children: (
                <>
                  {can('bookings.manage') ? <Button icon={<PlusOutlined />} style={{ marginBottom: 8 }} onClick={() => setResEdit({})}>{tr('New hall / room')}</Button> : null}
                  <Table
                    size="small"
                    rowKey="id"
                    dataSource={resources}
                    pagination={false}
                    columns={[
                      { title: tr('Name'), dataIndex: 'name' },
                      { title: tr('Type'), dataIndex: 'type', render: (t) => tr(t) },
                      { title: tr('Capacity (persons)'), dataIndex: 'capacity' },
                      { title: tr('Rent per day (₹)'), dataIndex: 'rentPerDay', render: (v) => <Money value={v} /> },
                      { title: tr('Security deposit (₹)'), dataIndex: 'deposit', render: (v) => <Money value={v} /> },
                      { title: tr('Status'), dataIndex: 'active', render: (a) => (a === false ? <Tag>{tr('inactive')}</Tag> : <Tag color="green">{tr('active')}</Tag>) },
                      { title: '', render: (_, r) => (can('bookings.manage') ? <Button size="small" icon={<EditOutlined />} onClick={() => setResEdit(r)} /> : null) },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>
      {edit ? <BookingModal booking={edit.id ? edit : null} preset={edit.preset} resources={resources} onClose={() => setEdit(null)} /> : null}
      {resEdit ? <ResourceModal res={resEdit.id ? resEdit : null} onClose={() => setResEdit(null)} /> : null}
      {moneyFor ? <MoneyModal booking={moneyFor.b} kind={moneyFor.kind} onClose={() => setMoneyFor(null)} /> : null}
    </Guard>
  );
}

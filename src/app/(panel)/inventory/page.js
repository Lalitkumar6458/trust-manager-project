'use client';

import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Select, Row, Col, Tag, Space, DatePicker, Typography, Switch, Segmented, Statistic, Drawer,
} from 'antd';
import { PlusOutlined, EditOutlined, ImportOutlined, ExportOutlined, HistoryOutlined, WarningOutlined } from '@ant-design/icons';
import { Guard, PageHeader, Money } from '@/components/common';
import { useAuth } from '@/contexts/AuthContext';
import { useAction, useLiveQuery } from '@/lib/hooks';
import { rpc } from '@/lib/api';
import { where, orderBy, limit } from '@/lib/q';
import { COL } from '@/lib/constants';
import { fmtDate, money } from '@/lib/format';
import { useLang } from '@/i18n/LangContext';

const CATS = ['prasad', 'pooja', 'kitchen', 'stationery', 'maintenance', 'other'];
const MOVES = [
  { value: 'purchase', label: 'Purchase (in)', dir: 1 }, { value: 'donation', label: 'Donation in kind (in)', dir: 1 }, { value: 'return', label: 'Returned (in)', dir: 1 },
  { value: 'issue', label: 'Issue / used (out)', dir: -1 }, { value: 'wastage', label: 'Wastage / damaged (out)', dir: -1 }, { value: 'adjust', label: 'Stock count correction', dir: 0 },
];

function ItemModal({ item, onClose }) {
  const { t: tr } = useLang();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const ok = async () => { const v = await form.validateFields(); if (await run(() => rpc('inventory.saveItem', item?.id || null, v), 'Saved')) onClose(); };
  return (
    <Modal open onCancel={onClose} onOk={ok} confirmLoading={busy} title={item?.id ? `${tr('Edit item')} ${item.code || ''}` : tr('New item')} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ category: 'pooja', unit: 'kg', active: true, ...item }}>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="name" label={tr('Name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="nameHi" label={tr('Name (Hindi)')}><Input /></Form.Item></Col>
          <Col span={8}><Form.Item name="unit" label={tr('Unit')} rules={[{ required: true }]}><Select options={['kg', 'gram', 'litre', 'piece', 'packet', 'box', 'metre', 'dozen'].map((u) => ({ value: u, label: u }))} /></Form.Item></Col>
          <Col span={8}><Form.Item name="category" label={tr('Category')}><Select options={CATS.map((c) => ({ value: c, label: tr(c) }))} /></Form.Item></Col>
          <Col span={8}><Form.Item name="minStock" label={tr('Alert below')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item name="rate" label={tr('Rate per unit (₹)')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item name="location" label={tr('Kept at')}><Input /></Form.Item></Col>
        </Row>
        <Form.Item name="active" label={tr('Active')} valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Modal>
  );
}

function MoveModal({ item, dir, onClose }) {
  const { t: tr } = useLang();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const type = Form.useWatch('type', form);
  const opts = MOVES.filter((m) => (dir > 0 ? m.dir > 0 : dir < 0 ? m.dir < 0 : m.dir === 0));
  const ok = async () => {
    const v = await form.validateFields();
    if (await run(() => rpc('inventory.move', { ...v, itemId: item.id, date: v.date.format('YYYY-MM-DD') }), 'Stock updated')) onClose();
  };
  return (
    <Modal open onCancel={onClose} onOk={ok} confirmLoading={busy} title={`${item.name} – ${tr('stock')} ${item.stock || 0} ${item.unit}`} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ type: opts[0].value, date: dayjs(), rate: item.rate }}>
        <Form.Item name="type" label={tr('Type')}><Select options={opts.map((m) => ({ value: m.value, label: tr(m.label) }))} /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="qty" label={type === 'adjust' ? tr('Counted stock') : `${tr('Quantity')} (${item.unit})`} rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item name="rate" label={tr('Rate per unit (₹)')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item name="date" label={tr('Date')}><DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item></Col>
          <Col span={12}><Form.Item name="reference" label={type === 'purchase' ? tr('Bill / voucher no.') : tr('Reference')}><Input /></Form.Item></Col>
          <Col span={24}><Form.Item name="party" label={type === 'donation' ? tr('Donor name') : type === 'issue' ? tr('Issued to (kitchen, bhandara …)') : tr('Party')}><Input /></Form.Item></Col>
          <Col span={24}><Form.Item name="note" label={tr('Note')}><Input /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}

function History({ item, onClose }) {
  const { t: tr } = useLang();
  const { data } = useLiveQuery(COL.stockMoves, [where('itemId', '==', item.id), orderBy('date', 'desc'), limit(300)], [item.id]);
  return (
    <Drawer open onClose={onClose} width={720} title={`${item.name} – ${tr('stock register')}`}>
      <Table
        size="small"
        rowKey="id"
        dataSource={data}
        pagination={{ pageSize: 50 }}
        columns={[
          { title: tr('Date'), dataIndex: 'date', render: fmtDate, width: 95 },
          { title: tr('Type'), dataIndex: 'type', render: (t) => tr(MOVES.find((m) => m.value === t)?.label || t) },
          { title: tr('In / out'), dataIndex: 'delta', align: 'right', render: (v) => <span style={{ color: v >= 0 ? '#237804' : '#a8071a' }}>{v > 0 ? '+' : ''}{v}</span> },
          { title: tr('Stock'), dataIndex: 'stockAfter', align: 'right' },
          { title: tr('Value'), dataIndex: 'value', align: 'right', render: (v) => <Money value={v} /> },
          { title: tr('Details'), render: (_, m) => [m.party, m.reference, m.note].filter(Boolean).join(' · ') },
          { title: tr('By'), dataIndex: 'createdByName' },
        ]}
      />
    </Drawer>
  );
}

export default function InventoryPage() {
  const { t: tr, pick } = useLang();
  const { can } = useAuth();
  const [filter, setFilter] = useState('all');
  const [cat, setCat] = useState(null);
  const [edit, setEdit] = useState(null);
  const [move, setMove] = useState(null);
  const [hist, setHist] = useState(null);
  const { data, loading } = useLiveQuery(COL.inventoryItems, [orderBy('name', 'asc'), limit(3000)], []);
  const manage = can('inventory.manage');
  const low = data.filter((i) => i.active !== false && i.minStock > 0 && (i.stock || 0) <= i.minStock);
  const rows = useMemo(() => data.filter((i) => (filter === 'low' ? low.includes(i) : filter === 'inactive' ? i.active === false : i.active !== false) && (!cat || i.category === cat)), [data, filter, cat, low]);
  const value = data.reduce((s, i) => s + (i.value || 0), 0);
  return (
    <Guard perm="inventory.view">
      <PageHeader
        title={tr('Store / inventory')}
        subtitle={tr('Prasad, pooja samagri, kitchen and other items – stock in, stock out and donation in kind.')}
        extra={[manage ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => setEdit({})}>{tr('New item')}</Button> : null]}
      />
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Items')} value={data.filter((i) => i.active !== false).length} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Low stock')} value={low.length} prefix={low.length ? <WarningOutlined /> : null} styles={{ content: { color: low.length ? '#a8071a' : undefined } }} /></Card></Col>
        <Col xs={24} md={12}><Card size="small"><Statistic title={tr('Stock value (approx.)')} value={money(value)} /></Card></Col>
      </Row>
      <Card size="small">
        <Space wrap style={{ marginBottom: 8 }}>
          <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: tr('All') }, { value: 'low', label: `${tr('Low stock')} (${low.length})` }, { value: 'inactive', label: tr('inactive') }]} />
          <Select allowClear placeholder={tr('Category')} style={{ width: 160 }} value={cat} onChange={setCat} options={CATS.map((c) => ({ value: c, label: tr(c) }))} />
        </Space>
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 800 }}
          pagination={{ pageSize: 50 }}
          columns={[
            { title: tr('Code'), dataIndex: 'code', width: 80 },
            { title: tr('Item'), render: (_, i) => <span>{pick(i.name, i.nameHi)}{i.location ? <Typography.Text type="secondary" style={{ fontSize: 12 }}> · {i.location}</Typography.Text> : null}</span> },
            { title: tr('Category'), dataIndex: 'category', render: (c) => tr(c) },
            { title: tr('Stock'), align: 'right', render: (_, i) => <b style={{ color: low.includes(i) ? '#a8071a' : undefined }}>{i.stock || 0} {i.unit}</b> },
            { title: tr('Alert below'), dataIndex: 'minStock', align: 'right' },
            { title: tr('Value'), dataIndex: 'value', align: 'right', render: (v) => <Money value={v || 0} /> },
            { title: tr('Last move'), dataIndex: 'lastMoveDate', render: fmtDate },
            {
              title: '', width: 170,
              render: (_, i) => (
                <Space size={4}>
                  {manage ? <Button size="small" icon={<ImportOutlined />} title={tr('Stock in')} onClick={() => setMove({ i, dir: 1 })} /> : null}
                  {manage ? <Button size="small" icon={<ExportOutlined />} title={tr('Stock out')} onClick={() => setMove({ i, dir: -1 })} /> : null}
                  {manage ? <Button size="small" title={tr('Stock count correction')} onClick={() => setMove({ i, dir: 0 })}>=</Button> : null}
                  <Button size="small" icon={<HistoryOutlined />} onClick={() => setHist(i)} />
                  {manage ? <Button size="small" icon={<EditOutlined />} onClick={() => setEdit(i)} /> : null}
                </Space>
              ),
            },
          ]}
        />
      </Card>
      {edit ? <ItemModal item={edit.id ? edit : null} onClose={() => setEdit(null)} /> : null}
      {move ? <MoveModal item={move.i} dir={move.dir} onClose={() => setMove(null)} /> : null}
      {hist ? <History item={hist} onClose={() => setHist(null)} /> : null}
    </Guard>
  );
}

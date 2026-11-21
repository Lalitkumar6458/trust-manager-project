'use client';

import { useMemo, useState } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Select, Row, Col, Tag, Space, Typography, Statistic, Radio,
} from 'antd';
import { PlusOutlined, EditOutlined, DownloadOutlined } from '@ant-design/icons';
import { Guard, PageHeader, Money } from '@/components/common';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { useAction, useLiveQuery } from '@/lib/hooks';
import { rpc } from '@/lib/api';
import { orderBy, limit } from '@/lib/q';
import { COL } from '@/lib/constants';
import { fmtDate, money, round2 } from '@/lib/format';
import { assetYear } from '@/lib/depreciation';
import { openBlob } from '@/pdf/generate';
import { useLang } from '@/i18n/LangContext';

const CATS = { land: 0, building: 10, furniture: 10, vehicle: 15, electronics: 40, machinery: 15, ornaments: 0, other: 10 };

function AssetModal({ asset, onClose }) {
  const { t: tr } = useLang();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const status = Form.useWatch('status', form);
  const cat = Form.useWatch('category', form);
  const ok = async () => { const v = await form.validateFields(); if (await run(() => rpc('assets.save', asset?.id || null, v), 'Saved')) onClose(); };
  return (
    <Modal open onCancel={onClose} onOk={ok} confirmLoading={busy} width={720} title={asset?.id ? `${tr('Edit asset')} ${asset.assetNo}` : tr('New asset')} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ category: 'furniture', depMethod: 'wdv', depRate: 10, status: 'active', ...asset }}>
        <Row gutter={12}>
          <Col xs={24} md={12}><Form.Item name="name" label={tr('Asset name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="category" label={tr('Category')}><Select onChange={(c) => form.setFieldValue('depRate', CATS[c])} options={Object.keys(CATS).map((c) => ({ value: c, label: tr(c) }))} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="purchaseDate" label={tr('Purchase date')} rules={[{ required: true }]}><Input type="date" /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="cost" label={tr('Cost (₹)')} rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="depRate" label={tr('Depreciation %')}><InputNumber min={0} max={100} style={{ width: '100%' }} disabled={['land', 'ornaments'].includes(cat)} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="depMethod" label={tr('Method')}><Radio.Group options={[{ value: 'wdv', label: tr('WDV (reducing)') }, { value: 'slm', label: tr('Straight line') }]} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="location" label={tr('Location')}><Input /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="custodian" label={tr('In charge')}><Input /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="fundId" label={tr('Fund / Project')}><Select allowClear options={app.funds.map((f) => ({ value: f.id, label: f.name }))} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="vendor" label={tr('Vendor')}><Input /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="billNo" label={tr('Bill / voucher no.')}><Input /></Form.Item></Col>
          {cat === 'ornaments' ? <Col xs={12} md={8}><Form.Item name="weight" label={tr('Weight (gram) / purity')}><Input placeholder="120 g, 22K" /></Form.Item></Col> : null}
          <Col xs={24}><Form.Item name="notes" label={tr('Notes')}><Input.TextArea rows={2} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="status" label={tr('Status')}><Select options={[{ value: 'active', label: tr('active') }, { value: 'disposed', label: tr('Sold / disposed') }]} /></Form.Item></Col>
          {status === 'disposed' ? (
            <>
              <Col xs={12} md={8}><Form.Item name="disposalDate" label={tr('Disposal date')} rules={[{ required: true }]}><Input type="date" /></Form.Item></Col>
              <Col xs={12} md={8}><Form.Item name="disposalValue" label={tr('Sale value (₹)')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            </>
          ) : null}
        </Row>
      </Form>
    </Modal>
  );
}

export default function AssetsPage() {
  const { t: tr } = useLang();
  const { can } = useAuth();
  const app = useAppData();
  const [edit, setEdit] = useState(null);
  const [fyId, setFyId] = useState(null);
  const fy = fyId || app.selectedFyId;
  const { data, loading } = useLiveQuery(COL.assets, [orderBy('purchaseDate', 'asc'), limit(5000)], []);
  const rows = useMemo(() => data.map((a) => ({ ...a, y: fy ? assetYear(a, fy) : null })), [data, fy]);
  const shown = rows.filter((r) => r.y);
  const tot = shown.reduce((s, r) => ({ opening: s.opening + r.y.opening, addition: s.addition + r.y.addition, depreciation: s.depreciation + r.y.depreciation, disposal: s.disposal + r.y.disposal, closing: s.closing + r.y.closing }), { opening: 0, addition: 0, depreciation: 0, disposal: 0, closing: 0 });
  const exportCsv = () => {
    const head = ['Asset No', 'Name', 'Category', 'Purchase date', 'Cost', 'Rate %', 'Method', 'Opening', 'Addition', 'Depreciation', 'Disposal', 'Closing', 'Location', 'Status'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.join(','), ...shown.map((r) => [r.assetNo, r.name, r.category, r.purchaseDate, r.cost, r.depRate, r.depMethod, r.y.opening, r.y.addition, r.y.depreciation, r.y.disposal, r.y.closing, r.location, r.status].map(q).join(','))];
    openBlob(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv' }), `Asset-register-${fy}.csv`, true);
  };
  return (
    <Guard perm="assets.view">
      <PageHeader
        title={tr('Asset register')}
        subtitle={tr('Land, building, furniture, vehicles, ornaments … with yearly depreciation for the audit.')}
        extra={[
          <Select key="fy" style={{ width: 130 }} value={fy} onChange={setFyId} options={(app.fys || []).map((f) => f.id).sort().reverse().map((id) => ({ value: id, label: `FY ${id}` }))} />,
          <Button key="x" icon={<DownloadOutlined />} disabled={!shown.length || !can('reports.export')} onClick={exportCsv}>CSV</Button>,
          can('assets.manage') ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => setEdit({})}>{tr('New asset')}</Button> : null,
        ]}
      />
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Opening value')} value={money(tot.opening)} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Added this year')} value={money(tot.addition)} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Depreciation')} value={money(tot.depreciation)} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Closing value')} value={money(tot.closing)} styles={{ content: { color: '#237804' } }} /></Card></Col>
      </Row>
      <Card size="small">
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={shown}
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 50 }}
          columns={[
            { title: tr('No.'), dataIndex: 'assetNo', width: 80 },
            { title: tr('Asset'), render: (_, a) => <span>{a.name}{a.weight ? ` (${a.weight})` : ''}<br /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{[a.location, a.custodian].filter(Boolean).join(' · ')}</Typography.Text></span> },
            { title: tr('Category'), dataIndex: 'category', render: (c) => tr(c) },
            { title: tr('Purchase date'), dataIndex: 'purchaseDate', render: fmtDate, width: 100 },
            { title: tr('Cost'), dataIndex: 'cost', align: 'right', render: (v) => <Money value={v} /> },
            { title: tr('Rate'), render: (_, a) => (['land', 'ornaments'].includes(a.category) ? '—' : `${a.depRate}% ${a.depMethod === 'slm' ? 'SLM' : 'WDV'}`) },
            { title: tr('Opening'), align: 'right', render: (_, a) => <Money value={a.y.opening} /> },
            { title: tr('Addition'), align: 'right', render: (_, a) => (a.y.addition ? <Money value={a.y.addition} /> : '') },
            { title: tr('Depreciation'), align: 'right', render: (_, a) => <Money value={a.y.depreciation} /> },
            { title: tr('Closing'), align: 'right', render: (_, a) => <b><Money value={a.y.closing} /></b> },
            { title: tr('Status'), dataIndex: 'status', render: (s, a) => (s === 'disposed' ? <Tag>{tr('Sold / disposed')} {fmtDate(a.disposalDate)}</Tag> : <Tag color="green">{tr('active')}</Tag>) },
            { title: '', width: 50, render: (_, a) => (can('assets.manage') ? <Button size="small" icon={<EditOutlined />} onClick={() => setEdit(a)} /> : null) },
          ]}
          summary={() => (shown.length ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6}><b>{tr('Total')}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right"><b>{money(round2(tot.opening))}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right"><b>{money(round2(tot.addition))}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={8} align="right"><b>{money(round2(tot.depreciation))}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={9} align="right"><b>{money(round2(tot.closing))}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={10} colSpan={2} />
            </Table.Summary.Row>
          ) : null)}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{tr('Half-year depreciation in the year of purchase if used less than 180 days. Land and ornaments are not depreciated.')}</Typography.Text>
      </Card>
      {edit ? <AssetModal asset={edit.id ? edit : null} onClose={() => setEdit(null)} /> : null}
    </Guard>
  );
}

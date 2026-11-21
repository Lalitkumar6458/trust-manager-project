'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Card, Table, Button, Input, Space, Typography, Modal, Form, Select, InputNumber, Switch, Row, Col, Alert, Segmented, Divider, Result, Tag,
} from 'antd';
import { PlusOutlined, CopyOutlined } from '@ant-design/icons';
import { crpc, useControl, useRun } from '@/components/control/ControlShell';
import { inr, dmy, StateTag, daysText, FeaturePicker, siteUrl } from '@/components/control/bits';

function NewTenant({ plans, onClose }) {
  const [form] = Form.useForm();
  const [run, busy] = useRun();
  const [done, setDone] = useState(null);
  const existing = Form.useWatch('existing', form);
  const trial = Form.useWatch('trial', form);
  const planId = Form.useWatch('planId', form);
  const fixed = Form.useWatch('billing', form) === 'fixed';
  const noExpiry = Form.useWatch('noExpiry', form);
  const onPlan = (id) => form.setFieldValue('featureList', (plans || []).find((p) => p.id === id)?.features || []);
  const slugW = Form.useWatch('slug', form);
  const plan = (plans || []).find((p) => p.id === planId);
  const [st] = useControl('settings.get');
  useEffect(() => { if (plans?.length && !form.getFieldValue('planId') && form.getFieldValue('billing') !== 'fixed') form.setFieldValue('planId', (plans.find((p) => p.active) || plans[0]).id); }, [plans, form]);
  const nameToSlug = (n) => String(n || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const ok = async () => {
    const v = await form.validateFields();
    const r = await run(() => crpc('tenants.create', {
      name: v.name, slug: v.slug, hosts: v.hosts, planId: v.planId || null, billing: v.billing, featureList: v.billing === 'fixed' ? (v.featureList || []) : undefined, noExpiry: v.billing === 'fixed' && v.noExpiry, maxUsers: v.maxUsers,
      oneTimeAmount: v.billing === 'fixed' ? v.oneTimeAmount : 0, oneTimeMethod: v.oneTimeMethod, oneTimeReference: v.oneTimeReference, trial: v.billing === 'fixed' ? false : v.trial, trialDays: v.trialDays, months: v.months, startsOn: v.startsOn,
      graceDays: v.graceDays, existingDb: v.existing ? v.existingDb : '', priceYear: v.priceYear, priceMonth: v.priceMonth,
      contact: { person: v.person, mobile: v.mobile, email: v.contactEmail, city: v.city }, admin: v.existing ? null : { name: v.adminName, email: v.adminEmail, mobile: v.mobile },
      notes: v.notes,
    }), 'Sanstha created');
    if (r) setDone(r);
  };
  if (done) {
    const text = `${siteUrl(done.url)}\nEmail: ${done.admin?.email || ''}\nPassword: ${done.admin?.password || ''}\n(First login par naya password banana hoga)`;
    return (
      <Modal open title="Sanstha ready" onCancel={onClose} footer={<Button type="primary" onClick={onClose}>Done</Button>}>
        <Result
          status="success"
          title="Database, setup and Super Admin login are ready"
          subTitle={done.admin ? 'Copy these details now and send them to the sanstha – the password is shown only once.' : 'Existing database registered.'}
          extra={done.admin ? (
            <div style={{ textAlign: 'left' }}>
              <pre style={{ background: '#f6f3ee', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap' }}>{text}</pre>
              <Button icon={<CopyOutlined />} onClick={() => navigator.clipboard.writeText(text)}>Copy</Button>
            </div>
          ) : <a href={siteUrl(done.url)} target="_blank" rel="noreferrer">{siteUrl(done.url)}</a>}
        />
      </Modal>
    );
  }
  return (
    <Modal open title="New sanstha" width={760} onCancel={onClose} onOk={ok} okText="Create" confirmLoading={busy} destroyOnHidden mask={{ closable: false }}>
      <Form form={form} layout="vertical" initialValues={{ billing: 'subscription', months: 12, graceDays: 7, trial: false, trialDays: 14, planId: plans?.[0]?.id, noExpiry: true, featureList: [], oneTimeMethod: 'UPI' }}>
        <Row gutter={12}>
          <Col xs={24} md={14}><Form.Item name="name" label="Sanstha name" rules={[{ required: true }]}><Input onChange={(e) => { if (!form.isFieldTouched('slug')) form.setFieldValue('slug', nameToSlug(e.target.value)); }} placeholder="Shri Shawlaji Seva Sansthan" /></Form.Item></Col>
          <Col xs={24} md={10}><Form.Item name="slug" label="Short name (web address)" rules={[{ required: true, pattern: /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, message: '3–32 small letters, numbers, -' }]} extra={`→ ${slugW || 'shortname'}.${st?.base_domain || 'yourbrand.in'}`}><Input /></Form.Item></Col>
          <Col xs={24}><Form.Item name="hosts" label="Own domain (optional)" extra="e.g. seva.shawlaji.org – sanstha points this domain (A record) to your server IP"><Select mode="tags" tokenSeparators={[',', ' ']} open={false} /></Form.Item></Col>
          <Col xs={24}>
            <Form.Item name="billing" label="Deal type">
              <Segmented block onChange={(v) => { if (v === 'fixed') { form.setFieldValue('planId', undefined); form.setFieldValue('featureList', []); } else if (!form.getFieldValue('planId')) form.setFieldValue('planId', (plans || []).find((p) => p.active)?.id); }} options={[{ value: 'subscription', label: 'Subscription (plan + renewal)' }, { value: 'fixed', label: 'Fixed deal (one-time payment)' }]} />
            </Form.Item>
          </Col>
          {fixed ? (
            <>
              <Col xs={24}><Alert type="info" showIcon style={{ marginBottom: 12 }} message="One-time payment: you tick the features once, they stay fixed. The sanstha sees no plan, no billing page and no renewal." /></Col>
              <Col xs={24} md={8}><Form.Item name="planId" label="Start from plan (optional)"><Select allowClear placeholder="Custom" onChange={onPlan} options={(plans || []).map((p) => ({ value: p.id, label: p.name }))} /></Form.Item></Col>
              <Col xs={12} md={8}><Form.Item name="maxUsers" label="Max active users" extra="Empty = unlimited"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
              <Col xs={12} md={8}><Form.Item name="noExpiry" label="Lifetime (no expiry)" valuePropName="checked"><Switch /></Form.Item></Col>
              {!noExpiry ? <Col xs={12} md={8}><Form.Item name="months" label="Valid for"><Select options={[{ value: 12, label: '1 year' }, { value: 24, label: '2 years' }, { value: 36, label: '3 years' }, { value: 60, label: '5 years' }]} /></Form.Item></Col> : null}
              <Col xs={24}><Form.Item name="featureList" label="Features for this sanstha (fixed)"><FeaturePicker /></Form.Item></Col>
              <Col xs={12} md={8}><Form.Item name="oneTimeAmount" label="Amount received (₹)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
              <Col xs={12} md={6}><Form.Item name="oneTimeMethod" label="Via"><Select options={['UPI', 'Cash', 'Bank transfer', 'Cheque', 'Other'].map((m) => ({ value: m, label: m }))} /></Form.Item></Col>
              <Col xs={24} md={10}><Form.Item name="oneTimeReference" label="UTR / cheque no."><Input /></Form.Item></Col>
            </>
          ) : (
            <>
              <Col xs={24} md={8}><Form.Item name="planId" label="Plan" rules={[{ required: true }]}><Select options={(plans || []).filter((p) => p.active).map((p) => ({ value: p.id, label: `${p.name} – ${inr(p.price_year)}/yr` }))} /></Form.Item></Col>
              <Col xs={12} md={5}><Form.Item name="trial" label="Free trial" valuePropName="checked"><Switch /></Form.Item></Col>
              {trial ? <Col xs={12} md={5}><Form.Item name="trialDays" label="Trial days"><InputNumber min={1} max={90} style={{ width: '100%' }} /></Form.Item></Col>
                : <Col xs={12} md={5}><Form.Item name="months" label="Paid for"><Select options={[{ value: 1, label: '1 month' }, { value: 3, label: '3 months' }, { value: 6, label: '6 months' }, { value: 12, label: '1 year' }, { value: 24, label: '2 years' }, { value: 36, label: '3 years' }]} /></Form.Item></Col>}
              <Col xs={12} md={6}><Form.Item name="graceDays" label="Grace days after expiry"><InputNumber min={0} max={60} style={{ width: '100%' }} /></Form.Item></Col>
              <Col xs={12} md={6}><Form.Item name="priceYear" label="Special yearly price" extra={plan ? `Plan: ${inr(plan.price_year)}` : ''}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
              <Col xs={12} md={6}><Form.Item name="priceMonth" label="Special monthly price" extra={plan ? `Plan: ${inr(plan.price_month)}` : ''}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            </>
          )}
        </Row>
        <Divider titlePlacement="left" plain>Contact</Divider>
        <Row gutter={12}>
          <Col xs={24} md={8}><Form.Item name="person" label="Contact person"><Input /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="mobile" label="Mobile"><Input maxLength={10} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="city" label="City"><Input /></Form.Item></Col>
        </Row>
        <Divider titlePlacement="left" plain>First login (Super Admin)</Divider>
        <Form.Item name="existing" valuePropName="checked"><Switch checkedChildren="Database already exists" unCheckedChildren="Create new database" /></Form.Item>
        {existing ? (
          <>
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message="For a sanstha that already uses the panel (e.g. your current client). Nothing inside that database is changed; its uploads folder must be moved to uploads/<short name> (see README)." />
            <Form.Item name="existingDb" label="Existing database name" rules={[{ required: true, pattern: /^[a-z_][a-z0-9_]*$/ }]}><Input placeholder="trust" /></Form.Item>
          </>
        ) : (
          <Row gutter={12}>
            <Col xs={24} md={12}><Form.Item name="adminName" label="Name" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="adminEmail" label="Login email" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item></Col>
          </Row>
        )}
        <Form.Item name="notes" label="Notes (only you see this)"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}

function TenantsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [rows, loading, reload] = useControl('tenants.list');
  const [plans] = useControl('plans.list');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (sp.get('new')) setCreating(true); }, [sp]);
  const shown = useMemo(() => (rows || []).filter((t) => {
    const s = t.license?.state;
    if (filter === 'due' && !['warning', 'grace'].includes(s)) return false;
    if (filter === 'expired' && !['readonly', 'locked'].includes(s)) return false;
    if (filter === 'trial' && !t.trial) return false;
    if (filter === 'fixed' && t.billing !== 'fixed') return false;
    const k = q.trim().toLowerCase();
    return !k || [t.name, t.slug, t.contact?.mobile, t.contact?.person, ...(t.hosts || [])].some((x) => String(x || '').toLowerCase().includes(k));
  }), [rows, q, filter]);
  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>Sansthaen</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>New sanstha</Button>
      </Space>
      <Card size="small">
        <Space wrap style={{ marginBottom: 8 }}>
          <Input.Search allowClear placeholder="Name, mobile, address…" style={{ width: 260 }} onChange={(e) => setQ(e.target.value)} />
          <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'due', label: 'Renewal due' }, { value: 'expired', label: 'Read-only / suspended' }, { value: 'trial', label: 'Trial' }, { value: 'fixed', label: 'Fixed deals' }]} />
        </Space>
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={shown}
          scroll={{ x: 1000 }}
          pagination={{ pageSize: 50 }}
          onRow={(r) => ({ onClick: () => router.push(`/control/tenants/${r.id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Sanstha', render: (_, t) => <div><Link href={`/control/tenants/${t.id}`} onClick={(e) => e.stopPropagation()}><b>{t.name}</b></Link><br /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{siteUrl(t.url).replace(/^https?:\/\//, '')}</Typography.Text></div> },
            { title: 'Plan', render: (_, t) => (t.billing === 'fixed' ? <Tag color="purple">Fixed deal</Tag> : t.license?.planName) },
            { title: 'Features', render: (_, t) => `${t.license?.features?.length || 0} add-ons` },
            { title: 'Expiry', dataIndex: 'expires_on', render: dmy, sorter: (a, b) => String(a.expires_on || '9').localeCompare(String(b.expires_on || '9')) },
            { title: 'Status', render: (_, t) => <div><StateTag lic={t.license} trial={t.trial} /><br /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{daysText(t.license)}</Typography.Text></div> },
            { title: 'Last paid', dataIndex: 'last_paid', render: (v) => (v ? dmy(String(new Date(v).toISOString()).slice(0, 10)) : '—') },
            { title: 'Contact', render: (_, t) => [t.contact?.person, t.contact?.mobile].filter(Boolean).join(' · ') || '—' },
          ]}
        />
      </Card>
      {creating ? <NewTenant plans={plans} onClose={() => { setCreating(false); reload(); if (sp.get('new')) router.replace('/control/tenants'); }} /> : null}
    </div>
  );
}

export default function Page() {
  return <Suspense><TenantsPage /></Suspense>;
}

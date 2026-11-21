'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card, Tabs, Descriptions, Button, Space, Typography, Modal, Form, Input, InputNumber, Select, Row, Col, Table, Tag, Alert, Switch, DatePicker, Spin, Popconfirm, Statistic, Segmented,
} from 'antd';
import { ArrowLeftOutlined, DollarOutlined, PauseCircleOutlined, PlayCircleOutlined, LinkOutlined, WhatsAppOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { crpc, useControl, useRun } from '@/components/control/ControlShell';
import { inr, dmy, dmyt, StateTag, daysText, FeaturePicker, siteUrl } from '@/components/control/bits';
import { featureLabel } from '@/lib/features';
import { effectiveFeatures } from '@/lib/license';

const METHODS = ['UPI', 'Cash', 'Bank transfer', 'Cheque', 'Razorpay', 'Other'];

function PaymentModal({ t, plans, onClose }) {
  const [form] = Form.useForm();
  const [run, busy] = useRun();
  const months = Form.useWatch('months', form);
  const planId = Form.useWatch('planId', form);
  const plan = plans.find((p) => p.id === planId);
  useEffect(() => {
    if (!plan) return;
    const y = planId === t.plan_id ? (t.price_year ?? plan.price_year) : plan.price_year;
    const m = planId === t.plan_id ? (t.price_month ?? plan.price_month) : plan.price_month;
    const amt = months === 12 ? y : months === 1 ? m : months > 0 && m ? m * months : months % 12 === 0 && y ? (y * months) / 12 : null;
    if (amt !== null && amt !== undefined && !form.isFieldTouched('amount')) form.setFieldValue('amount', Number(amt));
  }, [months, planId]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = async () => {
    const v = await form.validateFields();
    if (await run(() => crpc('payments.add', t.id, v), 'Payment saved – expiry updated')) onClose(true);
  };
  return (
    <Modal open title={`Payment received – ${t.name}`} onCancel={() => onClose(false)} onOk={ok} confirmLoading={busy} destroyOnHidden>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Current expiry: ${dmy(t.expires_on)}. Renewed before grace ends → continues from the old expiry; later → starts today.`} />
      <Form form={form} layout="vertical" initialValues={{ months: t.billing === 'fixed' ? 0 : 12, method: 'UPI', planId: t.plan_id }}>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="planId" label="Plan"><Select options={plans.map((p) => ({ value: p.id, label: p.name }))} /></Form.Item></Col>
          <Col span={12}><Form.Item name="months" label="Extend by"><Select options={[{ value: 0, label: 'Do not extend (part payment)' }, { value: 1, label: '1 month' }, { value: 3, label: '3 months' }, { value: 6, label: '6 months' }, { value: 12, label: '1 year' }, { value: 24, label: '2 years' }, { value: 36, label: '3 years' }]} /></Form.Item></Col>
          <Col span={12}><Form.Item name="amount" label="Amount received (₹)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item name="method" label="Via"><Select options={METHODS.map((m) => ({ value: m, label: m }))} /></Form.Item></Col>
          <Col span={24}><Form.Item name="reference" label="UTR / cheque no. / note"><Input /></Form.Item></Col>
          <Col span={24}><Form.Item name="note" label="Remarks"><Input /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}

function EditForm({ t, plans, onSaved }) {
  const [form] = Form.useForm();
  const [run, busy] = useRun();
  const planId = Form.useWatch('planId', form);
  const plan = plans.find((p) => p.id === planId);
  const base = plan?.features || [];
  const fixed = Form.useWatch('billing', form) === 'fixed';
  const save = async () => {
    const v = await form.validateFields();
    const sel = v.featureList || [];
    const features = { add: sel.filter((k) => !base.includes(k)), remove: base.filter((k) => !sel.includes(k)) };
    const ok = await run(() => crpc('tenants.update', t.id, {
      name: v.name, hosts: v.hosts || [], planId: v.planId || null, billing: v.billing, features, maxUsers: v.maxUsers, priceYear: v.priceYear, priceMonth: v.priceMonth,
      trial: v.billing === 'fixed' ? false : v.trial, expiresOn: v.noExpiry ? null : v.expiresOn?.format('YYYY-MM-DD'), noExpiry: v.noExpiry, graceDays: v.graceDays,
      contact: { person: v.person, mobile: v.mobile, email: v.email, city: v.city, gst: v.gst }, notes: v.notes,
    }), 'Saved');
    if (ok) onSaved();
  };
  const onPlan = (id) => {
    const p = plans.find((x) => x.id === id);
    form.setFieldValue('featureList', effectiveFeatures(p?.features || [], {}));
  };
  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{
        name: t.name, hosts: t.hosts, billing: t.billing || 'subscription', planId: t.plan_id, featureList: t.license.features, maxUsers: t.max_users, priceYear: t.price_year, priceMonth: t.price_month,
        trial: t.trial, expiresOn: t.expires_on ? dayjs(t.expires_on) : null, noExpiry: !t.expires_on, graceDays: t.grace_days,
        person: t.contact?.person, mobile: t.contact?.mobile, email: t.contact?.email, city: t.contact?.city, gst: t.contact?.gst, notes: t.notes,
      }}
    >
      <Row gutter={12}>
        <Col xs={24} md={12}><Form.Item name="name" label="Sanstha name" rules={[{ required: true }]}><Input /></Form.Item></Col>
        <Col xs={24} md={12}><Form.Item name="hosts" label="Own domains" extra={`Always works: ${t.slug}.<your base domain>`}><Select mode="tags" tokenSeparators={[',', ' ']} open={false} /></Form.Item></Col>
        <Col xs={24}>
          <Form.Item name="billing" label="Deal type" extra={fixed ? 'Fixed deal: features below stay as you tick them; the sanstha sees no plan, billing page or renewal.' : null}>
            <Segmented options={[{ value: 'subscription', label: 'Subscription (plan + renewal)' }, { value: 'fixed', label: 'Fixed deal (one-time payment)' }]} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}><Form.Item name="planId" label={fixed ? 'Plan (optional)' : 'Plan'}><Select allowClear={fixed} placeholder="Custom" onChange={onPlan} options={plans.map((p) => ({ value: p.id, label: p.name }))} /></Form.Item></Col>
        <Col xs={12} md={6}><Form.Item name="maxUsers" label="Max active users" extra={`Plan: ${plan?.max_users ?? 'unlimited'} (empty = plan)`}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
        {fixed ? null : <><Col xs={12} md={6}><Form.Item name="priceYear" label="Special yearly price" extra={`Plan: ${inr(plan?.price_year)}`}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
        <Col xs={12} md={6}><Form.Item name="priceMonth" label="Special monthly price" extra={`Plan: ${inr(plan?.price_month)}`}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col></>}
        <Col xs={24}><Form.Item name="featureList" label="Features (add-ons) for this sanstha" extra="Ticks start from the plan; anything you add / remove here is only for this sanstha."><FeaturePicker base={fixed ? undefined : base} /></Form.Item></Col>
        <Col xs={12} md={6}><Form.Item name="expiresOn" label="Expiry date"><DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} /></Form.Item></Col>
        <Col xs={12} md={6}><Form.Item name="noExpiry" label="Lifetime (no expiry)" valuePropName="checked"><Switch /></Form.Item></Col>
        <Col xs={12} md={6}><Form.Item name="graceDays" label="Grace days"><InputNumber min={0} max={60} style={{ width: '100%' }} /></Form.Item></Col>
        {fixed ? null : <Col xs={12} md={6}><Form.Item name="trial" label="Trial" valuePropName="checked"><Switch /></Form.Item></Col>}
        <Col xs={24} md={8}><Form.Item name="person" label="Contact person"><Input /></Form.Item></Col>
        <Col xs={12} md={4}><Form.Item name="mobile" label="Mobile"><Input /></Form.Item></Col>
        <Col xs={12} md={6}><Form.Item name="email" label="Email"><Input /></Form.Item></Col>
        <Col xs={12} md={3}><Form.Item name="city" label="City"><Input /></Form.Item></Col>
        <Col xs={12} md={3}><Form.Item name="gst" label="GSTIN"><Input /></Form.Item></Col>
        <Col xs={24}><Form.Item name="notes" label="Notes (only you see this)"><Input.TextArea rows={2} /></Form.Item></Col>
      </Row>
      <Button type="primary" loading={busy} onClick={save}>Save changes</Button>
    </Form>
  );
}

export default function TenantDetail({ params }) {
  const { id } = use(params);
  const [t, loading, reload, error] = useControl('tenants.get', id);
  const [plans] = useControl('plans.list');
  const [pay, setPay] = useState(false);
  const [run, busy] = useRun();
  const [reason, setReason] = useState('');
  if (error) return <Alert type="error" showIcon message={error} />;
  if (loading && !t) return <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>;
  if (!t) return null;
  const lic = t.license;
  const suspended = t.status === 'suspended';
  const toggle = () => run(() => crpc('tenants.status', t.id, suspended ? 'active' : 'suspended', reason), suspended ? 'Resumed' : 'Suspended').then(reload);
  const waText = encodeURIComponent(`Namaste ${t.contact?.person || ''}, ${t.name} ka software plan ${dmy(t.expires_on)} ${lic.daysLeft >= 0 ? 'ko samapt ho raha hai' : 'ko samapt ho gaya hai'}. Renew karne ke liye panel me "Plan & billing" kholen ya hamein sampark karein. Dhanyavaad.`);
  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Link href="/control/tenants"><Button icon={<ArrowLeftOutlined />} /></Link>
        <Typography.Title level={3} style={{ margin: 0 }}>{t.name}</Typography.Title>
        <StateTag lic={lic} trial={t.trial} />
      </Space>
      {suspended ? <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Suspended – nobody of this sanstha can sign in. Data is safe." /> : null}
      {lic.state === 'readonly' ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Plan expired and grace over – the sanstha can only view / download. Record a payment to unlock." /> : null}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Expiry" value={dmy(t.expires_on)} /><Typography.Text type="secondary">{daysText(lic)}</Typography.Text></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Plan" value={lic.planName} /><Typography.Text type="secondary">{t.billing === 'fixed' ? `One-time · ${lic.features.length} add-ons` : `${inr(t.price_year ?? (plans || []).find((p) => p.id === t.plan_id)?.price_year)}/year`}</Typography.Text></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Active users" value={t.usage?.users ?? '—'} suffix={lic.maxUsers ? `/ ${lic.maxUsers}` : ''} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Donation entries" value={t.usage?.donations ?? '—'} /><Typography.Text type="secondary">DB {t.usage?.db_size || '—'}</Typography.Text></Card></Col>
      </Row>
      <Space wrap style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<DollarOutlined />} onClick={() => setPay(true)}>{t.billing === 'fixed' ? 'Payment received' : 'Payment received / renew'}</Button>
        <a href={siteUrl(t.url)} target="_blank" rel="noreferrer"><Button icon={<LinkOutlined />}>Open panel</Button></a>
        {t.contact?.mobile && t.billing !== 'fixed' ? <a href={`https://wa.me/91${String(t.contact.mobile).replace(/\D/g, '').slice(-10)}?text=${waText}`} target="_blank" rel="noreferrer"><Button icon={<WhatsAppOutlined />}>Reminder on WhatsApp</Button></a> : null}
        <Popconfirm
          title={suspended ? 'Resume this sanstha?' : 'Suspend – block all sign-ins?'}
          description={suspended ? null : <Input placeholder="Reason (optional)" onChange={(e) => setReason(e.target.value)} />}
          onConfirm={toggle}
        >
          <Button danger={!suspended} loading={busy} icon={suspended ? <PlayCircleOutlined /> : <PauseCircleOutlined />}>{suspended ? 'Resume' : 'Suspend'}</Button>
        </Popconfirm>
      </Space>
      <Card size="small">
        <Tabs
          items={[
            {
              key: 'o',
              label: 'Overview',
              children: (
                <Descriptions size="small" column={{ xs: 1, md: 2 }} bordered>
                  <Descriptions.Item label="Web address"><a href={siteUrl(t.url)} target="_blank" rel="noreferrer">{siteUrl(t.url)}</a>{(t.hosts || []).slice(1).map((h) => <div key={h}>{h}</div>)}</Descriptions.Item>
                  <Descriptions.Item label="Database">{t.db_name}</Descriptions.Item>
                  <Descriptions.Item label="Started">{dmy(t.starts_on)}</Descriptions.Item>
                  <Descriptions.Item label="Grace">{t.grace_days} days{lic.graceEndsOn ? ` (till ${dmy(lic.graceEndsOn)})` : ''}</Descriptions.Item>
                  <Descriptions.Item label="Add-on features" span={2}>{lic.features.length ? lic.features.map((f) => <Tag key={f} color="geekblue" style={{ marginBottom: 4 }}>{featureLabel(f)}</Tag>) : 'Core only'}</Descriptions.Item>
                  <Descriptions.Item label="Last sign-in">{dmyt(t.usage?.last_login)}</Descriptions.Item>
                  <Descriptions.Item label="Last donation entry">{dmyt(t.usage?.last_entry)}</Descriptions.Item>
                  <Descriptions.Item label="Contact">{[t.contact?.person, t.contact?.mobile, t.contact?.email, t.contact?.city].filter(Boolean).join(' · ') || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Notes">{t.notes || '—'}</Descriptions.Item>
                </Descriptions>
              ),
            },
            { key: 'e', label: 'Edit / features / expiry', children: plans ? <EditForm t={t} plans={plans} onSaved={reload} /> : <Spin /> },
            {
              key: 'p',
              label: `Payments (${t.payments.length})`,
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={t.payments}
                  pagination={{ pageSize: 20 }}
                  scroll={{ x: 800 }}
                  columns={[
                    { title: 'No.', dataIndex: 'receipt_no' },
                    { title: 'Date', dataIndex: 'created_at', render: dmyt },
                    { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v, r) => (r.voided_at ? <s>{inr(v)}</s> : inr(v)) },
                    { title: 'Via', render: (_, r) => `${r.method}${r.reference ? ` · ${r.reference}` : ''}` },
                    { title: 'Period', render: (_, r) => (r.months ? `${dmy(r.period_from)} → ${dmy(r.period_to)}` : '—') },
                    { title: 'By', dataIndex: 'created_by' },
                    { title: '', render: (_, r) => (r.voided_at ? <Tag>Voided: {r.void_reason}</Tag> : <VoidBtn id={r.id} onDone={reload} />) },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>
      {pay && plans ? <PaymentModal t={t} plans={plans} onClose={(changed) => { setPay(false); if (changed) reload(); }} /> : null}
    </div>
  );
}

function VoidBtn({ id, onDone }) {
  const [run] = useRun();
  const [reason, setReason] = useState('');
  return (
    <Popconfirm title="Void this payment?" description={<div><Input placeholder="Reason" onChange={(e) => setReason(e.target.value)} /><Typography.Text type="secondary" style={{ fontSize: 12 }}>Expiry is not changed – edit it if needed.</Typography.Text></div>} onConfirm={() => run(() => crpc('payments.void', id, reason), 'Voided').then(onDone)}>
      <Button size="small" danger type="link">Void</Button>
    </Popconfirm>
  );
}

'use client';

import { Card, Form, Input, InputNumber, Switch, Button, Row, Col, Typography, Alert, Spin, Tag } from 'antd';
import { crpc, useControl, useRun } from '@/components/control/ControlShell';

export default function ControlSettings() {
  const [s, loading, reload] = useControl('settings.get');
  const [form] = Form.useForm();
  const [run, busy] = useRun();
  if (loading && !s) return <Spin />;
  const set = (k) => (s?.secretsSet || []).includes(k);
  const save = async () => {
    const v = await form.validateFields();
    const payload = { ...v };
    ['rzp_key_secret', 'rzp_webhook_secret'].forEach((k) => { if (!payload[k]) delete payload[k]; }); // empty = keep
    if (await run(() => crpc('settings.save', payload), 'Saved')) { form.setFieldsValue({ rzp_key_secret: '', rzp_webhook_secret: '' }); reload(); }
  };
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <div>
      <Typography.Title level={3}>Settings</Typography.Title>
      <Form form={form} layout="vertical" initialValues={s || {}}>
        <Card size="small" title="Your business (shown to sansthas on banners and the billing page)" style={{ marginBottom: 12 }}>
          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="brand_name" label="Brand / company name"><Input /></Form.Item></Col>
            <Col xs={12} md={8}><Form.Item name="support_phone" label="Support mobile / WhatsApp"><Input /></Form.Item></Col>
            <Col xs={12} md={8}><Form.Item name="support_email" label="Support email"><Input /></Form.Item></Col>
            <Col xs={24} md={16}><Form.Item name="company_address" label="Address (for your invoices)"><Input /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="company_gst" label="Your GSTIN (if any)"><Input /></Form.Item></Col>
          </Row>
        </Card>
        <Card size="small" title="Expiry rules" style={{ marginBottom: 12 }}>
          <Row gutter={12}>
            <Col xs={12} md={8}><Form.Item name="warn_days" label="Show “expiring soon” banner (days before)"><InputNumber min={1} max={60} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={8}><Form.Item name="default_grace_days" label="Default grace days for new sansthas"><InputNumber min={0} max={60} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Typography.Text type="secondary">After grace: read-only (view / download only, no new entries). Data is never deleted.</Typography.Text>
        </Card>
        <Card size="small" title="Online renewal – your Razorpay account" style={{ marginBottom: 12 }}>
          <Row gutter={12}>
            <Col xs={24} md={6}><Form.Item name="online_renewal" label="Sansthas can renew online" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="rzp_key_id" label="Key ID"><Input placeholder="rzp_live_…" /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name="rzp_key_secret" label={<span>Key secret {set('rzp_key_secret') ? <Tag color="green">saved</Tag> : null}</span>}><Input.Password placeholder={set('rzp_key_secret') ? 'leave empty to keep' : ''} autoComplete="new-password" /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name="rzp_webhook_secret" label={<span>Webhook secret {set('rzp_webhook_secret') ? <Tag color="green">saved</Tag> : null}</span>}><Input.Password placeholder={set('rzp_webhook_secret') ? 'leave empty to keep' : ''} autoComplete="new-password" /></Form.Item></Col>
          </Row>
          <Alert type="info" showIcon message={<span>Razorpay dashboard → Webhooks → URL <code>{origin}/api/license/webhook</code>, events <code>payment.captured</code> and <code>order.paid</code>. This is YOUR account (subscription money) – separate from each sanstha&apos;s own donation Razorpay.</span>} />
        </Card>
        <Button type="primary" loading={busy} onClick={save}>Save settings</Button>
      </Form>
    </div>
  );
}

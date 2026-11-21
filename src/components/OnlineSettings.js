'use client';

import { useEffect, useState } from 'react';
import { Card, Row, Col, Form, Input, InputNumber, Switch, Select, Button, Alert, Typography, Space } from 'antd';
import { SaveOutlined, CheckCircleTwoTone, LinkOutlined } from '@ant-design/icons';
import { useAppData } from '@/contexts/AppDataContext';
import { useAction } from '@/lib/hooks';
import { rpc, rpcRead } from '@/lib/api';
import { useLang } from '@/i18n/LangContext';

export default function OnlineSettings() {
  const { t: tr, pick } = useLang();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const [saved, setSaved] = useState({});
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    const o = app.settings.online || {};
    form.setFieldsValue({ enabled: false, minAmount: 10, maxAmount: 500000, suggested: [101, 251, 501, 1100, 2100, 5100], ...o, suggestedText: (o.suggested || [101, 251, 501, 1100, 2100, 5100]).join(', ') });
  }, [app.settings.online, form]);
  const loadStatus = () => rpcRead('online.status').then(setSaved).catch(() => {});
  useEffect(() => { loadStatus(); }, []);
  const save = () => run(async () => {
    const v = await form.validateFields();
    const { rzpSecret, rzpWebhook, suggestedText, ...online } = v;
    online.suggested = String(suggestedText || '').split(/[,\s]+/).map(Number).filter((n) => n > 0);
    await rpc('online.saveSettings', online, { rzp_secret: rzpSecret || '', rzp_webhook_secret: rzpWebhook || '' });
    form.setFieldsValue({ rzpSecret: '', rzpWebhook: '' });
    await loadStatus();
  }, 'Saved');
  const on = Form.useWatch('enabled', form);
  const hint = (k) => (saved[k] ? <span><CheckCircleTwoTone twoToneColor="#52c41a" /> {tr('saved – leave empty to keep')}</span> : null);
  return (
    <Row gutter={16}>
      <Col xs={24} xl={14}>
        <Form form={form} layout="vertical">
          <Card size="small" title={tr('Online donation page (Razorpay)')} extra={<Form.Item name="enabled" valuePropName="checked" noStyle><Switch /></Form.Item>} style={{ marginBottom: 12 }}>
            <Row gutter={12}>
              <Col xs={24} md={12}><Form.Item name="keyId" label="Razorpay Key ID" rules={[{ required: on, message: tr('Required') }]}><Input placeholder="rzp_live_…" /></Form.Item></Col>
              <Col xs={24} md={12}><Form.Item name="rzpSecret" label="Razorpay Key Secret" extra={hint('rzp_secret')}><Input.Password autoComplete="new-password" /></Form.Item></Col>
              <Col xs={24} md={12}><Form.Item name="rzpWebhook" label={tr('Webhook secret')} extra={hint('rzp_webhook_secret')}><Input.Password autoComplete="new-password" /></Form.Item></Col>
              <Col xs={24} md={12}>
                <Form.Item name="accountId" label={tr('Money comes into (bank account)')} rules={[{ required: on, message: tr('Required') }]}>
                  <Select options={app.bankAccounts.map((a) => ({ value: a.id, label: a.name }))} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="categoryIds" label={tr('Categories shown to donors')} extra={tr('Empty = all “print on receipt” categories')}>
                  <Select mode="multiple" allowClear options={app.activeDonationCategories.map((c) => ({ value: c.id, label: pick(c.name, c.nameHi) }))} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}><Form.Item name="defaultCategoryId" label={tr('Default category')}><Select allowClear options={app.activeDonationCategories.map((c) => ({ value: c.id, label: pick(c.name, c.nameHi) }))} /></Form.Item></Col>
              <Col xs={12} md={6}><Form.Item name="minAmount" label={tr('Minimum ₹')}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
              <Col xs={12} md={6}><Form.Item name="maxAmount" label={tr('Maximum ₹')}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
              <Col xs={24} md={12}><Form.Item name="suggestedText" label={tr('Amount buttons')}><Input placeholder="101, 251, 501, 1100" /></Form.Item></Col>
              <Col xs={24}><Form.Item name="title" label={tr('Page heading')}><Input placeholder="ऑनलाइन दान / Donate online" /></Form.Item></Col>
              <Col xs={24}><Form.Item name="intro" label={tr('Text above the form')}><Input.TextArea rows={2} /></Form.Item></Col>
              <Col xs={24}><Form.Item name="thankYou" label={tr('Thank-you message')}><Input.TextArea rows={2} /></Form.Item></Col>
            </Row>
          </Card>
          <Button type="primary" icon={<SaveOutlined />} loading={busy} onClick={save}>{tr('Save')}</Button>
        </Form>
      </Col>
      <Col xs={24} xl={10}>
        <Card size="small" title={tr('Links to share')} style={{ marginBottom: 12 }}>
          <Space orientation="vertical" style={{ width: '100%' }}>
            <div><b>{tr('Donation page')}:</b> <a href="/donate" target="_blank" rel="noreferrer">{origin}/donate <LinkOutlined /></a></div>
            <div><b>{tr('Donor portal (receipts & statements)')}:</b> <a href="/portal" target="_blank" rel="noreferrer">{origin}/portal <LinkOutlined /></a></div>
            <div><b>Webhook URL:</b> <Typography.Text copyable>{`${origin}/api/public/razorpay/webhook`}</Typography.Text></div>
          </Space>
        </Card>
        <Alert
          type="info"
          showIcon
          title={tr('Setup')}
          description={(
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>{tr('Razorpay Dashboard → Account & Settings → API keys → generate Key ID + Secret.')}</li>
              <li>{tr('Webhooks → add the URL above with events payment.captured, order.paid, payment.failed and a secret.')}</li>
              <li>{tr('Donations are saved as approved receipts automatically; Razorpay fees reach the bank as a lower credit – record them as bank charges during reconciliation.')}</li>
              <li>{tr('Donor portal needs WhatsApp (OTP template) or email set up in Messages.')}</li>
            </ol>
          )}
        />
      </Col>
    </Row>
  );
}

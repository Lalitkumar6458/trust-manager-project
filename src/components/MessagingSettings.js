'use client';

import { useEffect, useState } from 'react';
import {
  Card, Row, Col, Form, Input, InputNumber, Switch, Button, Space, Alert, Table, Tag, Typography, Collapse, Select,
} from 'antd';
import { SaveOutlined, SendOutlined, CheckCircleTwoTone } from '@ant-design/icons';
import { useAppData } from '@/contexts/AppDataContext';
import { useAction, useLiveQuery } from '@/lib/hooks';
import { rpc, rpcRead } from '@/lib/api';
import { orderBy, limit } from '@/lib/q';
import { COL } from '@/lib/constants';
import { fmtDateTime } from '@/lib/format';
import { useLang } from '@/i18n/LangContext';

const DEFAULTS = {
  emailEnabled: false, smtpHost: '', smtpPort: 587, smtpSecure: false, smtpUser: '', fromEmail: '', fromName: '',
  whatsappEnabled: false, waPhoneNumberId: '', waApiVersion: 'v21.0', waLanguage: 'hi',
  waReceiptTemplate: 'donation_receipt', waGreetingTemplate: 'donor_greeting', waReminderTemplate: 'pledge_reminder', waOtpTemplate: 'login_otp',
  autoReceiptEmail: false, autoReceiptWhatsApp: false, birthdayGreetings: false, anniversaryGreetings: false, pledgeReminders: true,
};

export default function MessagingSettings() {
  const { t: tr } = useLang();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const [saved, setSaved] = useState({});
  const [testTo, setTestTo] = useState('');
  const [testCh, setTestCh] = useState('email');
  const { data: logs } = useLiveQuery(COL.messageLogs, [orderBy('createdAt', 'desc'), limit(50)], []);

  useEffect(() => { form.setFieldsValue({ ...DEFAULTS, ...(app.settings.messaging || {}) }); }, [app.settings.messaging, form]);
  const loadStatus = () => rpcRead('messages.status').then(setSaved).catch(() => {});
  useEffect(() => { loadStatus(); }, []);

  const save = () => run(async () => {
    const v = await form.validateFields();
    const { smtpPass, waToken, ...messaging } = v;
    await rpc('messages.saveSettings', messaging, { smtp_pass: smtpPass || '', wa_token: waToken || '' });
    form.setFieldsValue({ smtpPass: '', waToken: '' });
    await loadStatus();
  }, 'Saved');
  const test = () => run(() => rpc('messages.test', testCh, testTo), 'Test message sent');

  const emailOn = Form.useWatch('emailEnabled', form);
  const waOn = Form.useWatch('whatsappEnabled', form);
  const secretHint = (k) => (saved[k] ? <span><CheckCircleTwoTone twoToneColor="#52c41a" /> {tr('saved – leave empty to keep')}</span> : null);

  return (
    <Row gutter={16}>
      <Col xs={24} xl={14}>
        <Form form={form} layout="vertical">
          <Card size="small" title={tr('Email (SMTP)')} style={{ marginBottom: 12 }} extra={<Form.Item name="emailEnabled" valuePropName="checked" noStyle><Switch /></Form.Item>}>
            <Row gutter={12}>
              <Col xs={24} md={12}><Form.Item name="smtpHost" label={tr('SMTP server')} extra="smtp.gmail.com / smtp.hostinger.com"><Input disabled={!emailOn} /></Form.Item></Col>
              <Col xs={12} md={6}><Form.Item name="smtpPort" label={tr('Port')}><InputNumber disabled={!emailOn} style={{ width: '100%' }} /></Form.Item></Col>
              <Col xs={12} md={6}><Form.Item name="smtpSecure" label="SSL (465)" valuePropName="checked"><Switch disabled={!emailOn} /></Form.Item></Col>
              <Col xs={24} md={12}><Form.Item name="smtpUser" label={tr('Login (email)')}><Input disabled={!emailOn} autoComplete="off" /></Form.Item></Col>
              <Col xs={24} md={12}><Form.Item name="smtpPass" label={tr('Password / App password')} extra={secretHint('smtp_pass')}><Input.Password disabled={!emailOn} autoComplete="new-password" /></Form.Item></Col>
              <Col xs={24} md={12}><Form.Item name="fromEmail" label={tr('From email')} rules={[{ type: 'email' }]}><Input disabled={!emailOn} /></Form.Item></Col>
              <Col xs={24} md={12}><Form.Item name="fromName" label={tr('From name')}><Input disabled={!emailOn} placeholder={app.settings.name} /></Form.Item></Col>
            </Row>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{tr('Gmail: turn on 2-step verification and create an “App password” – use that here, not your normal password.')}</Typography.Text>
          </Card>

          <Card size="small" title={tr('WhatsApp (Meta WhatsApp Cloud API)')} style={{ marginBottom: 12 }} extra={<Form.Item name="whatsappEnabled" valuePropName="checked" noStyle><Switch /></Form.Item>}>
            <Row gutter={12}>
              <Col xs={24} md={12}><Form.Item name="waPhoneNumberId" label={tr('Phone number ID')}><Input disabled={!waOn} /></Form.Item></Col>
              <Col xs={24} md={12}><Form.Item name="waToken" label={tr('Permanent access token')} extra={secretHint('wa_token')}><Input.Password disabled={!waOn} autoComplete="new-password" /></Form.Item></Col>
              <Col xs={12} md={6}><Form.Item name="waApiVersion" label={tr('API version')}><Input disabled={!waOn} /></Form.Item></Col>
              <Col xs={12} md={6}><Form.Item name="waLanguage" label={tr('Template language')}><Select disabled={!waOn} options={[{ value: 'hi', label: 'hi' }, { value: 'en', label: 'en' }, { value: 'en_US', label: 'en_US' }, { value: 'gu', label: 'gu' }, { value: 'mr', label: 'mr' }]} /></Form.Item></Col>
            </Row>
            <Collapse
              size="small"
              items={[{
                key: 't',
                label: tr('Approved template names'),
                children: (
                  <Row gutter={12}>
                    <Col xs={24} md={12}><Form.Item name="waReceiptTemplate" label={tr('Receipt')} extra="{{1}} name, {{2}} amount, {{3}} receipt no. + PDF header"><Input disabled={!waOn} /></Form.Item></Col>
                    <Col xs={24} md={12}><Form.Item name="waGreetingTemplate" label={tr('Greeting')} extra="{{1}} name, {{2}} occasion, {{3}} trust"><Input disabled={!waOn} /></Form.Item></Col>
                    <Col xs={24} md={12}><Form.Item name="waReminderTemplate" label={tr('Sankalp reminder')} extra="{{1}} name, {{2}} amount, {{3}} date, {{4}} trust"><Input disabled={!waOn} /></Form.Item></Col>
                    <Col xs={24} md={12}><Form.Item name="waOtpTemplate" label={tr('Donor login OTP')} extra="{{1}} OTP (authentication template)"><Input disabled={!waOn} /></Form.Item></Col>
                  </Row>
                ),
              }]}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>{tr('WhatsApp allows business-started messages only with templates approved in Meta Business Manager. Create them with the parameters shown above.')}</Typography.Text>
          </Card>

          <Card size="small" title={tr('Automatic messages')} style={{ marginBottom: 12 }}>
            <Row gutter={[12, 8]}>
              <Col xs={24} md={12}><Form.Item name="autoReceiptEmail" valuePropName="checked" noStyle><Switch size="small" disabled={!emailOn} /></Form.Item> {tr('Email the receipt when a donation is approved')}</Col>
              <Col xs={24} md={12}><Form.Item name="autoReceiptWhatsApp" valuePropName="checked" noStyle><Switch size="small" disabled={!waOn} /></Form.Item> {tr('WhatsApp the receipt when a donation is approved')}</Col>
              <Col xs={24} md={12}><Form.Item name="birthdayGreetings" valuePropName="checked" noStyle><Switch size="small" /></Form.Item> {tr('Birthday wishes to donors (8:30 am)')}</Col>
              <Col xs={24} md={12}><Form.Item name="anniversaryGreetings" valuePropName="checked" noStyle><Switch size="small" /></Form.Item> {tr('Anniversary wishes to donors')}</Col>
              <Col xs={24} md={12}><Form.Item name="pledgeReminders" valuePropName="checked" noStyle><Switch size="small" /></Form.Item> {tr('Sankalp reminders before the due date')}</Col>
            </Row>
            <Collapse
              size="small"
              style={{ marginTop: 12 }}
              items={[{
                key: 'x',
                label: tr('Email text'),
                children: (
                  <>
                    <Form.Item name="emailSubject" label={tr('Receipt email subject')}><Input placeholder="दान रसीद / Donation receipt {receiptNo} – {trust}" /></Form.Item>
                    <Form.Item name="emailBody" label={tr('Receipt email text')} extra="{name} {amount} {receiptNo} {date} {trust}"><Input.TextArea rows={5} /></Form.Item>
                    <Form.Item name="greetingText" label={tr('Greeting email text')} extra="{name} {occasion} {trust}"><Input.TextArea rows={2} /></Form.Item>
                    <Form.Item name="reminderText" label={tr('Reminder email text')} extra="{name} {amount} {date} {trust}"><Input.TextArea rows={2} /></Form.Item>
                  </>
                ),
              }]}
            />
          </Card>
          <Button type="primary" icon={<SaveOutlined />} loading={busy} onClick={save}>{tr('Save')}</Button>
        </Form>
      </Col>
      <Col xs={24} xl={10}>
        <Card size="small" title={tr('Send a test')} style={{ marginBottom: 12 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Select value={testCh} onChange={setTestCh} style={{ width: 130 }} options={[{ value: 'email', label: 'Email' }, { value: 'whatsapp', label: 'WhatsApp' }]} />
            <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={testCh === 'email' ? 'you@example.com' : '98XXXXXXXX'} />
            <Button icon={<SendOutlined />} loading={busy} onClick={test} disabled={!testTo}>{tr('Send')}</Button>
          </Space.Compact>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{tr('Save the settings first.')}</Typography.Text>
        </Card>
        <Card size="small" title={tr('Recent messages')}>
          <Table
            size="small"
            rowKey="id"
            dataSource={logs}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            columns={[
              { title: tr('When'), dataIndex: 'createdAt', render: fmtDateTime, width: 130 },
              { title: tr('To'), render: (_, r) => <span>{r.toName}<br /><Typography.Text type="secondary" style={{ fontSize: 11 }}>{r.to}</Typography.Text></span> },
              { title: tr('Type'), render: (_, r) => <span><Tag>{r.channel}</Tag>{r.kind}{r.ref ? ` · ${r.ref}` : ''}</span> },
              { title: tr('Status'), dataIndex: 'status', render: (v, r) => (v === 'sent' ? <Tag color="green">{tr('Sent')}</Tag> : <Tag color="red" title={r.error}>{tr('Failed')}</Tag>) },
            ]}
            expandable={{ rowExpandable: (r) => !!r.error, expandedRowRender: (r) => <Alert type="error" title={r.error} /> }}
          />
        </Card>
      </Col>
    </Row>
  );
}

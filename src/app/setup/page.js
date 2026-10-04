'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Form, Input, Button, Typography, Alert, App, Divider, InputNumber, Result, Spin, Segmented } from 'antd';
import { bootstrapTrust, isBootstrapped } from '@/services/setup';
import { DEFAULT_TRUST_SETTINGS } from '@/lib/constants';
import { isFirebaseConfigured } from '@/lib/firebase';
import { useLang } from '@/i18n/LangContext';

export default function SetupPage() {
  const { t: tr, lang, setLang } = useLang();
  const router = useRouter();
  const { message } = App.useApp();
  const [state, setState] = useState('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setState('noconfig');
      return;
    }
    isBootstrapped().then((b) => setState(b ? 'done' : 'ready')).catch(() => setState('ready'));
  }, []);

  const onFinish = async (v) => {
    setBusy(true);
    try {
      await bootstrapTrust({
        name: v.name,
        email: v.email.trim(),
        password: v.password,
        mobile: v.mobile,
        cashOpening: v.cashOpening,
        trust: {
          name: v.trustName, nameEn: v.trustNameEn, address: v.address, phones: v.phones,
          registrationNo: v.registrationNo, registrationDate: v.registrationDate, pan: (v.pan || '').toUpperCase(),
        },
      });
      message.success(tr('Setup complete. Welcome!'));
      router.replace('/dashboard');
    } catch (e) {
      message.error(e.message, 8);
    } finally {
      setBusy(false);
    }
  };

  if (state === 'checking') return <div className="login-bg"><Spin /></div>;
  if (state === 'noconfig') return <Result status="warning" title={tr('Firebase is not configured')} subTitle="Fill .env.local first (see README)." />;
  if (state === 'done') {
    return <Result status="info" title={tr('Setup already completed')} subTitle="Ask your Super Admin for a login." extra={<Button type="primary" onClick={() => router.push('/login')}>{tr('Go to login')}</Button>} />;
  }

  const d = DEFAULT_TRUST_SETTINGS;
  return (
    <div className="login-bg">
      <Card style={{ width: 640, maxWidth: '100%' }}>
        <div style={{ float: 'right' }}>
          <Segmented size="small" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी' }]} />
        </div>
        <Typography.Title level={3} className="brand-title">{tr('One-time setup')}</Typography.Title>
        <Alert type="info" showIcon style={{ marginBottom: 16 }} title={tr('This creates the Super Admin login, trust profile, default donation & expense categories, a Cash account and the current financial year. It can be run only once.')} />
        <Form
          layout="vertical"
          onFinish={onFinish}
          initialValues={{
            trustName: d.name, trustNameEn: d.nameEn, address: d.address, phones: d.phones,
            registrationNo: d.registrationNo, registrationDate: d.registrationDate, pan: d.pan, cashOpening: 0,
          }}
        >
          <Divider titlePlacement="left">{tr('Trust')}</Divider>
          <Form.Item name="trustName" label={tr('Trust name (Hindi – printed on receipts)')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="trustNameEn" label={tr('Trust name (English)')}><Input /></Form.Item>
          <Form.Item name="address" label={tr('Address')} rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="phones" label={tr('Phone numbers')}><Input /></Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
            <Form.Item name="registrationNo" label={tr('Registration no.')}><Input /></Form.Item>
            <Form.Item name="registrationDate" label={tr('Registration date')}><Input /></Form.Item>
            <Form.Item name="pan" label={tr('Trust PAN')}><Input style={{ textTransform: 'uppercase' }} /></Form.Item>
          </div>
          <Form.Item name="cashOpening" label={tr('Opening cash in hand (₹) for current FY')}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Divider titlePlacement="left">{tr('Super Admin login')}</Divider>
          <Form.Item name="name" label={tr('Your name')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="mobile" label={tr('Mobile')}><Input /></Form.Item>
          <Form.Item name="email" label={tr('Email')} rules={[{ required: true, type: 'email' }]}><Input autoComplete="username" /></Form.Item>
          <Form.Item name="password" label={tr('Password')} rules={[{ required: true, min: 8 }]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Form.Item
            name="confirmPassword"
            label={tr('Confirm password')}
            dependencies={['password']}
            rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, v) => (!v || v === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error(tr('Passwords do not match')))) })]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={busy}>{tr('Complete setup')}</Button>
        </Form>
      </Card>
    </div>
  );
}

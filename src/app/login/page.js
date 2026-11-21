'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Form, Input, Button, Typography, Alert, App, Segmented } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { useAuth } from '@/contexts/AuthContext';
import { isBootstrapped } from '@/services/setup';
import { useLang } from '@/i18n/LangContext';

function LoginInner() {
  const { t: tr, lang, setLang } = useLang();
  const { login, verify2fa, user, error } = useAuth();
  const [step2, setStep2] = useState(false);
  const [code, setCode] = useState('');
  const router = useRouter();
  const params = useSearchParams();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    // only same-site paths – never an absolute / protocol-relative URL (open redirect)
    const next = params.get('next');
    if (user) router.replace(next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/dashboard');
  }, [user, router, params]);

  useEffect(() => {
    isBootstrapped().then((b) => setNeedsSetup(!b)).catch(() => {});
  }, []);

  const onFinish = async ({ email, password }) => {
    setBusy(true);
    try {
      const r = await login(email.trim(), password);
      if (r?.needs2fa) setStep2(true);
    } catch (e) {
      message.error(tr(e.message), 6);
    } finally {
      setBusy(false);
    }
  };

  const onCode = async () => {
    setBusy(true);
    try {
      await verify2fa(code.trim());
    } catch (e) {
      message.error(tr(e.message), 6);
      if (/expired/i.test(e.message)) { setStep2(false); setCode(''); }
    } finally {
      setBusy(false);
    }
  };

  const onForgot = () => {
    message.info(tr('Ask the Super Admin to reset your password (Users & Roles → Reset password).'), 8);
  };

  return (
    <div className="login-bg">
      <Card style={{ width: 400, maxWidth: '100%' }}>
        <div style={{ textAlign: 'right' }}>
          <Segmented size="small" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी' }]} />
        </div>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 28 }}>॥</div>
          <Typography.Title level={3} className="brand-title" style={{ marginBottom: 0 }}>{tr('Trust Manager')}</Typography.Title>
          <Typography.Text type="secondary">{tr('Donation • Expense • Accounting • Audit')}</Typography.Text>
        </div>
        {error ? <Alert type="error" showIcon title={tr(error)} style={{ marginBottom: 16 }} /> : null}
        {needsSetup ? (
          <Alert type="info" showIcon style={{ marginBottom: 16 }} title={tr('First time here?')} description={<Link href="/setup">{tr('Run the one-time setup to create the Super Admin →')}</Link>} />
        ) : null}
        {step2 ? (
          <div>
            <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tr('2-step login')} description={tr('Enter the 6-digit code from your authenticator app (or a recovery code).')} />
            <Input size="large" autoFocus value={code} onChange={(e) => setCode(e.target.value)} onPressEnter={onCode} placeholder="123456" inputMode="numeric" autoComplete="one-time-code" style={{ letterSpacing: 4, fontSize: 20, textAlign: 'center' }} />
            <Button type="primary" block size="large" loading={busy} style={{ marginTop: 12 }} disabled={code.trim().length < 6} onClick={onCode}>{tr('Verify')}</Button>
            <Button type="link" block onClick={() => { setStep2(false); setCode(''); }}>{tr('Back')}</Button>
          </div>
        ) : (
        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item name="email" label={tr('Email')} rules={[{ required: true, type: 'email' }]}>
            <Input prefix={<MailOutlined />} autoComplete="username" size="large" />
          </Form.Item>
          <Form.Item name="password" label={tr('Password')} rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={busy}>{tr('Sign in')}</Button>
          <Button type="link" block onClick={onForgot} style={{ marginTop: 8 }}>{tr('Forgot password?')}</Button>
        </Form>
        )}
      </Card>
    </div>
  );
}

export default function LoginPage() {
  const { t: tr } = useLang();
  return <Suspense><LoginInner /></Suspense>;
}

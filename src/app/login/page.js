'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Form, Input, Button, Typography, Alert, App, Segmented } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { useAuth } from '@/contexts/AuthContext';
import { isBootstrapped } from '@/services/setup';
import { isFirebaseConfigured } from '@/lib/firebase';
import { useLang } from '@/i18n/LangContext';

function LoginInner() {
  const { t: tr, lang, setLang } = useLang();
  const { login, user, resetPassword, error } = useAuth();
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
    if (!isFirebaseConfigured) return;
    isBootstrapped().then((b) => setNeedsSetup(!b)).catch(() => {});
  }, []);

  const onFinish = async ({ email, password }) => {
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      const known = {
        'auth/invalid-credential': 'Invalid email or password',
        'auth/wrong-password': 'Invalid email or password',
        'auth/user-not-found': 'Invalid email or password',
        'auth/invalid-email': 'Invalid email or password',
        'auth/too-many-requests': 'Too many failed attempts. The account is temporarily locked – try again later or reset the password.',
        'auth/user-disabled': 'Your account is disabled. Contact the Super Admin.',
        'auth/network-request-failed': 'No internet connection. Check your network and try again.',
      };
      message.error(tr(known[e.code] || e.message), 6);
    } finally {
      setBusy(false);
    }
  };

  const onForgot = async () => {
    const email = form.getFieldValue('email');
    if (!email) {
      message.info(tr('Enter your email first'));
      return;
    }
    try {
      await resetPassword(email.trim());
      message.success(tr('Password reset email sent'));
    } catch (e) {
      message.error(e.message);
    }
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
        {!isFirebaseConfigured ? (
          <Alert type="warning" showIcon title={tr('Firebase is not configured')} description={tr('Copy .env.example to .env.local and fill in your Firebase keys.')} style={{ marginBottom: 16 }} />
        ) : null}
        {error ? <Alert type="error" showIcon title={tr(error)} style={{ marginBottom: 16 }} /> : null}
        {needsSetup ? (
          <Alert type="info" showIcon style={{ marginBottom: 16 }} title={tr('First time here?')} description={<Link href="/setup">{tr('Run the one-time setup to create the Super Admin →')}</Link>} />
        ) : null}
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
      </Card>
    </div>
  );
}

export default function LoginPage() {
  const { t: tr } = useLang();
  return <Suspense><LoginInner /></Suspense>;
}

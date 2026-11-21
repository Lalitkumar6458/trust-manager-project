'use client';

import { useEffect, useState } from 'react';
import {
  Card, Form, Input, InputNumber, Button, Select, Result, Spin, Alert, Typography, Space, Row, Col,
} from 'antd';
import { HeartFilled, SafetyCertificateOutlined, FilePdfOutlined } from '@ant-design/icons';

// Public online donation page (Razorpay). No login.

const loadScript = () => new Promise((resolve, reject) => {
  if (window.Razorpay) { resolve(); return; }
  const s = document.createElement('script');
  s.src = 'https://checkout.razorpay.com/v1/checkout.js';
  s.onload = resolve;
  s.onerror = () => reject(new Error('Payment page could not load – check internet and try again'));
  document.body.appendChild(s);
});

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}

export default function DonatePage() {
  const [cfg, setCfg] = useState(null);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const amount = Form.useWatch('amount', form);

  useEffect(() => {
    fetch('/api/public/donate/config').then((r) => r.json()).then((c) => {
      setCfg(c);
      if (c.enabled) form.setFieldsValue({ categoryId: c.defaultCategoryId, amount: c.suggested?.[2] || c.suggested?.[0] || null });
    }).catch(() => setCfg({ enabled: false }));
  }, [form]);

  const pay = async () => {
    setError(null);
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setBusy(true);
    try {
      await loadScript();
      const order = await post('/api/public/donate/order', v);
      await new Promise((resolve, reject) => {
        const rz = new window.Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: Math.round(order.amount * 100),
          currency: 'INR',
          name: cfg.trust.nameEn || cfg.trust.name,
          description: 'Donation',
          prefill: { name: order.name, contact: order.mobile, email: order.email || undefined },
          notes: { ref: order.ref },
          theme: { color: '#7d1a12' },
          handler: async (resp) => {
            try { setDone(await post('/api/public/donate/verify', resp)); resolve(); } catch (e) { reject(e); }
          },
          modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
        });
        rz.on('payment.failed', (r) => reject(new Error(r?.error?.description || 'Payment failed')));
        rz.open();
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const page = { minHeight: '100vh', background: 'linear-gradient(180deg,#fff4e0 0%,#f5f3ef 40%)', padding: '24px 12px' };
  if (!cfg) return <div style={{ ...page, display: 'grid', placeItems: 'center' }}><Spin size="large" /></div>;
  if (!cfg.enabled) {
    return <div style={page}><Card style={{ maxWidth: 520, margin: '40px auto' }}><Result status="info" title={cfg.trust?.name || 'Online donation'} subTitle="Online donation is not available right now. / ऑनलाइन दान अभी उपलब्ध नहीं है।" /></Card></div>;
  }
  const t = cfg.trust;
  return (
    <div style={page}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <img src="/api/public/logo" alt="" width={64} height={64} style={{ borderRadius: 32, objectFit: 'contain' }} />
          <Typography.Title level={3} style={{ margin: '8px 0 0', color: '#7d1a12' }}>{t.name}</Typography.Title>
          {t.nameEn && t.nameEn !== t.name ? <div style={{ fontWeight: 600 }}>{t.nameEn}</div> : null}
          {t.address ? <Typography.Text type="secondary">{t.address}</Typography.Text> : null}
        </div>
        {done ? (
          <Card>
            {done.paidButNotRecorded || done.processing ? (
              <Result status="success" title="धन्यवाद! Payment received" subTitle="Your receipt will be sent to you shortly. / रसीद जल्द ही भेज दी जाएगी।" />
            ) : (
              <Result
                status="success"
                icon={<HeartFilled style={{ color: '#a4161a' }} />}
                title={`₹${Number(done.amount).toLocaleString('en-IN')} – धन्यवाद!`}
                subTitle={<span>{cfg.thankYou}<br />Receipt No.: <b>{done.receiptNo}</b></span>}
                extra={done.token ? [
                  <a key="pdf" href={`/api/public/receipt/${done.token}`} target="_blank" rel="noreferrer"><Button type="primary" icon={<FilePdfOutlined />}>रसीद डाउनलोड करें / Download receipt</Button></a>,
                  <a key="v" href={`/r/${done.token}`} target="_blank" rel="noreferrer"><Button icon={<SafetyCertificateOutlined />}>Verify</Button></a>,
                ] : null}
              />
            )}
          </Card>
        ) : (
          <Card title={<span><HeartFilled style={{ color: '#a4161a' }} /> {cfg.title || 'ऑनलाइन दान / Donate online'}</span>}>
            {cfg.intro ? <Typography.Paragraph>{cfg.intro}</Typography.Paragraph> : null}
            <Form form={form} layout="vertical" requiredMark={false}>
              <Form.Item label="राशि / Amount (₹)" required>
                <Space wrap style={{ marginBottom: 8 }}>
                  {cfg.suggested.map((a) => <Button key={a} type={Number(amount) === a ? 'primary' : 'default'} onClick={() => form.setFieldValue('amount', a)}>₹{a.toLocaleString('en-IN')}</Button>)}
                </Space>
                <Form.Item name="amount" noStyle rules={[{ required: true, message: 'Enter amount' }, { type: 'number', min: cfg.minAmount, max: cfg.maxAmount, message: `₹${cfg.minAmount} – ₹${cfg.maxAmount}` }]}>
                  <InputNumber size="large" style={{ width: '100%' }} min={1} precision={0} placeholder="Other amount" />
                </Form.Item>
              </Form.Item>
              {cfg.categories.length > 1 ? (
                <Form.Item name="categoryId" label="किस हेतु / Donation for">
                  <Select size="large" options={cfg.categories.map((c) => ({ value: c.id, label: c.nameHi && c.nameHi !== c.name ? `${c.nameHi} (${c.name})` : c.name }))} />
                </Form.Item>
              ) : null}
              <Row gutter={12}>
                <Col xs={24} md={12}><Form.Item name="name" label="नाम / Name" rules={[{ required: true, message: 'Enter your name' }]}><Input size="large" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name="mobile" label="मोबाइल / Mobile" rules={[{ required: true, pattern: /^[6-9]\d{9}$/, message: '10 digit mobile' }]}><Input size="large" inputMode="numeric" maxLength={10} /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name="email" label="ईमेल / Email (for receipt)" rules={[{ type: 'email' }]}><Input size="large" /></Form.Item></Col>
                <Col xs={24} md={12}>
                  <Form.Item name="pan" label="PAN (80G के लिए / for 80G)" rules={[{ pattern: /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/, message: 'Invalid PAN' }]}>
                    <Input size="large" maxLength={10} style={{ textTransform: 'uppercase' }} />
                  </Form.Item>
                </Col>
                <Col xs={24}><Form.Item name="address" label="पता / Address"><Input.TextArea rows={2} /></Form.Item></Col>
                <Col xs={24}><Form.Item name="purpose" label="उद्देश्य / Purpose (optional)"><Input /></Form.Item></Col>
              </Row>
              {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} /> : null}
              <Button type="primary" size="large" block loading={busy} onClick={pay} icon={<HeartFilled />}>
                {amount ? `₹${Number(amount).toLocaleString('en-IN')} दान करें / Donate` : 'दान करें / Donate'}
              </Button>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>
                <SafetyCertificateOutlined /> UPI · Card · Net banking – secured by Razorpay.
                {t.section80G ? ` 80G: ${t.section80G}.` : ''} {t.pan ? `Trust PAN: ${t.pan}` : ''}
              </Typography.Paragraph>
            </Form>
          </Card>
        )}
      </div>
    </div>
  );
}

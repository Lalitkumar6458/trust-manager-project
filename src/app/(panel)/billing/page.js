'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Card, Row, Col, Statistic, Table, Tag, Button, Typography, Alert, Spin, Space, Result, Descriptions, App, Radio,
} from 'antd';
import { CheckOutlined, CreditCardOutlined, LockOutlined } from '@ant-design/icons';
import { PageHeader } from '@/components/common';
import { useAuth } from '@/contexts/AuthContext';
import { useLang } from '@/i18n/LangContext';
import { FEATURES, featureLabel, CORE_INCLUDES } from '@/lib/features';
import { fmtDate, fmtDateTime, money } from '@/lib/format';

const loadRzp = () => new Promise((resolve, reject) => {
  if (window.Razorpay) { resolve(); return; }
  const s = document.createElement('script');
  s.src = 'https://checkout.razorpay.com/v1/checkout.js';
  s.onload = resolve;
  s.onerror = () => reject(new Error('Payment page could not load – check internet and try again'));
  document.body.appendChild(s);
});

async function api(body) {
  const r = await fetch('/api/license', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}

const STATE = { active: 'green', warning: 'orange', grace: 'volcano', readonly: 'red', locked: 'default' };

export default function BillingPage() {
  const { t: tr, lang } = useLang();
  const { user, refresh } = useAuth();
  const { message } = App.useApp();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [months, setMonths] = useState(12);
  const load = useCallback(() => api().then(setInfo).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (user?.role !== 'superAdmin') return <Result status="403" title={tr('Only the Super Admin can see the plan')} />;
  if (error) return <Alert type="error" showIcon message={tr(error)} />;
  if (!info) return <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>;
  if (info.mode === 'fixed') return <Result status="404" title={tr('This page is not available.')} />;
  if (info.mode !== 'saas') return <Result status="info" title={tr('This installation has no subscription – everything is included.')} />;
  const l = info.license;
  const stateLabel = { active: tr('Active'), warning: tr('Expiring soon'), grace: tr('Expired – grace period'), readonly: tr('Read-only'), locked: tr('Suspended') }[l.state];

  const pay = async (plan) => {
    setBusy(plan.id);
    try {
      await loadRzp();
      const o = await api({ action: 'order', planId: plan.id, months });
      await new Promise((resolve, reject) => {
        const rz = new window.Razorpay({
          key: o.keyId,
          order_id: o.orderId,
          amount: Math.round(o.amount * 100),
          currency: 'INR',
          name: o.name,
          description: o.description,
          prefill: o.prefill,
          theme: { color: '#8f2d1f' },
          handler: async (resp) => {
            try {
              const r = await api({ action: 'verify', orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature });
              message.success(`${tr('Thank you! Plan renewed till')} ${fmtDate(r.expiresOn)}`);
              resolve();
            } catch (e) { reject(e); }
          },
          modal: { ondismiss: () => resolve() },
        });
        rz.on('payment.failed', (r) => reject(new Error(r?.error?.description || 'Payment failed')));
        rz.open();
      });
      await Promise.all([load(), refresh()]);
    } catch (e) {
      message.error(tr(e.message));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader title={tr('Plan & billing')} subtitle={tr('Your subscription, included modules and payments')} />
      {l.state === 'readonly' ? <Alert type="error" showIcon icon={<LockOutlined />} style={{ marginBottom: 12 }} message={tr('Plan expired – read-only mode')} description={tr('Renew below to start adding entries again. Your data is safe.')} /> : null}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Current plan')} value={l.planName} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Valid till')} value={l.expiresOn ? fmtDate(l.expiresOn) : tr('No expiry')} /><Tag color={STATE[l.state]}>{stateLabel}</Tag>{l.trial ? <Tag color="blue">{tr('Trial')}</Tag> : null}</Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Days left')} value={l.daysLeft === null ? '∞' : Math.max(l.daysLeft, 0)} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('User limit')} value={l.maxUsers || tr('Unlimited')} /></Card></Col>
      </Row>

      <Card size="small" title={tr('Included in your plan')} style={{ marginBottom: 12 }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{tr('Always included')}: {lang === 'hi' ? CORE_INCLUDES.hi : CORE_INCLUDES.en}</Typography.Paragraph>
        <Row gutter={[8, 4]}>
          {FEATURES.map((f) => {
            const on = l.features.includes(f.key);
            return (
              <Col xs={24} sm={12} md={8} key={f.key} style={{ color: on ? undefined : '#aaa' }}>
                {on ? <CheckOutlined style={{ color: '#237804' }} /> : <LockOutlined />} {featureLabel(f.key, lang)}
              </Col>
            );
          })}
        </Row>
      </Card>

      <Card
        size="small"
        title={<span><CreditCardOutlined /> {tr('Renew / upgrade')}</span>}
        extra={<Radio.Group size="small" value={months} onChange={(e) => setMonths(e.target.value)} optionType="button" options={[{ value: 12, label: tr('Yearly') }, { value: 1, label: tr('Monthly') }]} />}
        style={{ marginBottom: 12 }}
      >
        {!info.onlineRenewal ? <Alert type="info" showIcon style={{ marginBottom: 12 }} message={<span>{tr('Online payment is not available – please pay your software provider directly.')} {[l.support?.name, l.support?.phone, l.support?.email].filter(Boolean).join(' · ')}</span>} /> : null}
        <Row gutter={[12, 12]}>
          {info.plans.map((p) => {
            const price = months === 12 ? p.priceYear : p.priceMonth;
            return (
              <Col xs={24} md={8} key={p.id}>
                <Card size="small" style={{ borderColor: p.current ? '#8f2d1f' : undefined, height: '100%' }} title={<span>{p.name} {p.current ? <Tag color="red">{tr('Current')}</Tag> : null}</span>}>
                  <Typography.Title level={4} style={{ margin: 0 }}>{price ? money(price) : '—'}<Typography.Text type="secondary" style={{ fontSize: 13 }}> / {months === 12 ? tr('year') : tr('month')}</Typography.Text></Typography.Title>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>{p.description}</Typography.Paragraph>
                  <div style={{ fontSize: 13, marginBottom: 8 }}>{p.features.length ? p.features.map((k) => featureLabel(k, lang)).join(', ') : tr('Core only')}{p.maxUsers ? ` · ${p.maxUsers} ${tr('users')}` : ''}</div>
                  <Button type={p.current ? 'primary' : 'default'} block disabled={!info.onlineRenewal || !price} loading={busy === p.id} onClick={() => pay(p)}>
                    {p.current ? tr('Renew') : tr('Switch to this plan')}
                  </Button>
                </Card>
              </Col>
            );
          })}
        </Row>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>{tr('Renewing before the grace period ends continues from your current expiry date – you never lose days.')}</Typography.Paragraph>
      </Card>

      <Card size="small" title={tr('Payment history')}>
        <Table
          size="small"
          rowKey={(r) => r.receipt_no || r.created_at}
          dataSource={info.payments}
          pagination={false}
          scroll={{ x: 640 }}
          locale={{ emptyText: tr('No payments yet') }}
          columns={[
            { title: tr('Receipt no.'), dataIndex: 'receipt_no' },
            { title: tr('Date'), dataIndex: 'created_at', render: (v) => fmtDateTime(v) },
            { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => money(v) },
            { title: tr('Mode'), dataIndex: 'method' },
            { title: tr('Period'), render: (_, r) => (r.months ? `${fmtDate(r.period_from)} → ${fmtDate(r.period_to)}` : '—') },
          ]}
        />
      </Card>
      {l.support && (l.support.phone || l.support.email) ? (
        <Descriptions size="small" style={{ marginTop: 12 }} column={1}>
          <Descriptions.Item label={tr('Support')}><Space wrap>{[l.support.name, l.support.phone, l.support.email].filter(Boolean).join(' · ')}</Space></Descriptions.Item>
        </Descriptions>
      ) : null}
    </div>
  );
}

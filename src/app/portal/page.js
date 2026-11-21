'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, Input, Button, Table, Tag, Typography, Space, Alert, Spin, Tabs, Form, Row, Col, Statistic, Select, Empty, App, Checkbox,
} from 'antd';
import { MobileOutlined, LogoutOutlined, FilePdfOutlined, HeartFilled, SaveOutlined } from '@ant-design/icons';

// Donor portal – sign in with OTP, see / download own receipts and yearly statements.

const fmtDate = (s) => (s ? s.split('-').reverse().join('-') : '');
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const FREQ = { monthly: 'मासिक / Monthly', quarterly: 'त्रैमासिक / Quarterly', halfYearly: 'अर्धवार्षिक / Half-yearly', yearly: 'वार्षिक / Yearly', once: 'एक बार / Once' };

async function call(url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), { status: r.status });
  return j;
}

function Login({ onIn }) {
  const [id, setId] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState(1);
  const [via, setVia] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const send = async () => {
    setBusy(true); setErr(null);
    try { const r = await call('/api/portal/otp', { id }); setVia(r.via); setStep(2); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setErr(null);
    try { await call('/api/portal/verify', { id, code }); onIn(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Card style={{ maxWidth: 420, margin: '0 auto' }} title="दाता लॉगिन / Donor login">
      {step === 1 ? (
        <>
          <Typography.Paragraph type="secondary">अपना पंजीकृत मोबाइल नंबर या ईमेल डालें। Enter your registered mobile number or email.</Typography.Paragraph>
          <Input size="large" prefix={<MobileOutlined />} value={id} onChange={(e) => setId(e.target.value)} onPressEnter={send} placeholder="98XXXXXXXX / you@example.com" autoFocus />
          <Button type="primary" size="large" block style={{ marginTop: 12 }} loading={busy} disabled={!id.trim()} onClick={send}>OTP भेजें / Send OTP</Button>
        </>
      ) : (
        <>
          <Typography.Paragraph>{via === 'whatsapp' ? 'WhatsApp' : 'Email'} पर OTP भेजा गया (अगर यह नंबर / ईमेल पंजीकृत है)। OTP sent if registered.</Typography.Paragraph>
          <Input size="large" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onPressEnter={verify} placeholder="6 digit OTP" inputMode="numeric" autoFocus style={{ letterSpacing: 6, fontSize: 22, textAlign: 'center' }} />
          <Button type="primary" size="large" block style={{ marginTop: 12 }} loading={busy} disabled={code.length !== 6} onClick={verify}>लॉगिन / Sign in</Button>
          <Button type="link" block onClick={() => { setStep(1); setCode(''); }}>नंबर बदलें / Change</Button>
        </>
      )}
      {err ? <Alert type="error" showIcon title={err} style={{ marginTop: 12 }} /> : null}
    </Card>
  );
}

function Profile({ donor, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  useEffect(() => { form.setFieldsValue(donor); }, [donor, form]);
  const save = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try { await call('/api/portal/profile', { donorId: donor.id, ...v }); message.success('Saved / सहेजा गया'); onSaved(); } catch (e) { message.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Form form={form} layout="vertical" style={{ maxWidth: 560 }}>
      <Row gutter={12}>
        <Col xs={24} md={12}><Form.Item label="नाम / Name"><Input value={donor.name} disabled /></Form.Item></Col>
        <Col xs={24} md={12}><Form.Item label="मोबाइल / Mobile"><Input value={donor.mobile} disabled /></Form.Item></Col>
        <Col xs={24} md={12}><Form.Item name="email" label="ईमेल / Email" rules={[{ type: 'email' }]}><Input /></Form.Item></Col>
        <Col xs={24} md={12}><Form.Item name="pan" label="PAN (80G)" rules={[{ pattern: /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/, message: 'Invalid PAN' }]}><Input maxLength={10} style={{ textTransform: 'uppercase' }} /></Form.Item></Col>
        <Col xs={24}><Form.Item name="address" label="पता / Address"><Input.TextArea rows={2} /></Form.Item></Col>
        <Col xs={12}><Form.Item name="dob" label="जन्मदिन / Birthday"><Input type="date" /></Form.Item></Col>
        <Col xs={12}><Form.Item name="anniversary" label="वर्षगाँठ / Anniversary"><Input type="date" /></Form.Item></Col>
        <Col xs={24}><Form.Item name="noMessages" valuePropName="checked"><Checkbox>मुझे संदेश न भेजें / Don’t send me messages</Checkbox></Form.Item></Col>
      </Row>
      <Button type="primary" icon={<SaveOutlined />} loading={busy} onClick={save}>सहेजें / Save</Button>
    </Form>
  );
}

function Dashboard({ data, reload, logout }) {
  const [donorId, setDonorId] = useState(data.donors[0]?.id);
  const donor = data.donors.find((d) => d.id === donorId) || data.donors[0];
  const mine = useMemo(() => data.donations.filter((d) => d.donorId === donor?.id), [data.donations, donor]);
  const fys = [...new Set(mine.filter((d) => d.status === 'approved').map((d) => d.financialYearId))].sort().reverse();
  const total = mine.filter((d) => d.status === 'approved').reduce((s, d) => s + d.amount, 0);
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <Card style={{ marginBottom: 12 }}>
        <Row align="middle" gutter={12}>
          <Col flex="auto">
            <Typography.Title level={4} style={{ margin: 0 }}>🙏 {donor?.name}</Typography.Title>
            <Typography.Text type="secondary">{donor?.donorCode} · {donor?.mobile}</Typography.Text>
          </Col>
          <Col>
            <Space wrap>
              {data.donors.length > 1 ? <Select value={donorId} onChange={setDonorId} options={data.donors.map((d) => ({ value: d.id, label: d.name }))} style={{ minWidth: 180 }} /> : null}
              {data.onlineDonation ? <a href="/donate"><Button type="primary" icon={<HeartFilled />}>दान करें / Donate</Button></a> : null}
              <Button icon={<LogoutOutlined />} onClick={logout}>Logout</Button>
            </Space>
          </Col>
        </Row>
        <Row gutter={12} style={{ marginTop: 12 }}>
          <Col xs={12} md={8}><Statistic title="कुल दान / Total donated" value={money(total)} /></Col>
          <Col xs={12} md={8}><Statistic title="रसीदें / Receipts" value={mine.filter((d) => d.status === 'approved').length} /></Col>
        </Row>
      </Card>
      <Card>
        <Tabs
          items={[
            {
              key: 'r', label: 'रसीदें / Receipts',
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={mine}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  scroll={{ x: 600 }}
                  columns={[
                    { title: 'Date', dataIndex: 'date', render: fmtDate, width: 100 },
                    { title: 'Receipt No.', dataIndex: 'receiptNo' },
                    { title: 'For', dataIndex: 'categories' },
                    { title: 'Amount', dataIndex: 'amount', align: 'right', render: money },
                    { title: '', width: 110, render: (_, r) => (r.status === 'approved' ? <a href={`/api/portal/receipt/${r.id}`} target="_blank" rel="noreferrer"><Button size="small" icon={<FilePdfOutlined />}>PDF</Button></a> : <Tag color="red">रद्द / Cancelled</Tag>) },
                  ]}
                />
              ),
            },
            {
              key: 's', label: 'वार्षिक विवरण / Yearly statement (80G)',
              children: fys.length ? (
                <Space wrap>
                  {fys.map((fy) => <a key={fy} href={`/api/portal/statement/${fy}?donor=${donor.id}`} target="_blank" rel="noreferrer"><Button icon={<FilePdfOutlined />}>FY {fy}</Button></a>)}
                </Space>
              ) : <Empty />,
            },
            ...(data.pledges.length ? [{
              key: 'p', label: 'संकल्प / Sankalp',
              children: (
                <Table size="small" rowKey="id" pagination={false} dataSource={data.pledges} columns={[
                  { title: 'No.', dataIndex: 'pledgeNo' }, { title: 'For', dataIndex: 'categoryName' },
                  { title: 'Amount', dataIndex: 'amount', render: money }, { title: 'How often', dataIndex: 'frequency', render: (v) => FREQ[v] || v },
                  { title: 'Next due', dataIndex: 'nextDue', render: fmtDate },
                ]}
                />
              ),
            }] : []),
            { key: 'f', label: 'प्रोफ़ाइल / Profile', children: donor ? <Profile donor={donor} onSaved={reload} /> : null },
          ]}
        />
      </Card>
      <Typography.Paragraph type="secondary" style={{ textAlign: 'center', marginTop: 12, fontSize: 12 }}>
        {data.trust.name}{data.trust.phones ? ` · ${data.trust.phones}` : ''}{data.trust.section80G ? ` · 80G: ${data.trust.section80G}` : ''}
      </Typography.Paragraph>
    </div>
  );
}

export default function PortalPage() {
  const [state, setState] = useState({ loading: true });
  const load = useCallback(async () => {
    try { setState({ data: await call('/api/portal/me') }); } catch (e) { setState({ out: true, error: e.status === 401 ? null : e.message }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const logout = async () => { await call('/api/portal/logout', {}).catch(() => {}); setState({ out: true }); };
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#fff4e0 0%,#f5f3ef 40%)', padding: '24px 12px' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <img src="/api/public/logo" alt="" width={56} height={56} style={{ borderRadius: 28, objectFit: 'contain' }} />
        <Typography.Title level={4} style={{ margin: '6px 0 0', color: '#7d1a12' }}>{state.data?.trust?.name || 'दाता पोर्टल / Donor portal'}</Typography.Title>
      </div>
      {state.loading ? <div style={{ textAlign: 'center' }}><Spin /></div> : state.data ? <Dashboard data={state.data} reload={load} logout={logout} /> : <Login onIn={load} />}
      {state.error ? <Alert type="error" title={state.error} style={{ maxWidth: 420, margin: '12px auto' }} /> : null}
    </div>
  );
}

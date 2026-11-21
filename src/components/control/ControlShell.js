'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Layout, Menu, Button, Card, Form, Input, Spin, Typography, Space, Dropdown, Modal, App, Alert, Tag,
} from 'antd';
import {
  DashboardOutlined, BankOutlined, DollarOutlined, AppstoreOutlined, SettingOutlined, HistoryOutlined, LogoutOutlined, KeyOutlined, UserOutlined, MenuOutlined,
} from '@ant-design/icons';

// ------------------------------------------------------------------
// Owner control panel shell (software provider). Separate login from sanstha staff.
// ------------------------------------------------------------------

async function call(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
  } catch {
    throw new Error('Could not reach the server. Check your internet connection.');
  }
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('tm:owner-out'));
  if (!res.ok) throw Object.assign(new Error(j.error || `Request failed (${res.status})`), { status: res.status });
  return j;
}
export async function crpc(name, ...args) {
  const { result } = await call('/api/control/rpc', { method: 'POST', body: JSON.stringify({ name, args }) });
  return result;
}

const Ctx = createContext(null);
export const useOwner = () => useContext(Ctx);

/** load data with crpc; returns [data, loading, reload] */
export function useControl(name, ...args) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const key = JSON.stringify([name, args]);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await crpc(name, ...args)); setError(null); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return [data, loading, load, error];
}

/** run an action with a success / error message */
export function useRun() {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, ok) => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) message.success(ok);
      return r ?? true;
    } catch (e) {
      message.error(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [message]);
  return [run, busy];
}

const MENU = [
  { key: '/control', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/control/tenants', icon: <BankOutlined />, label: 'Sansthaen' },
  { key: '/control/payments', icon: <DollarOutlined />, label: 'Payments' },
  { key: '/control/plans', icon: <AppstoreOutlined />, label: 'Plans & pricing' },
  { key: '/control/settings', icon: <SettingOutlined />, label: 'Settings' },
  { key: '/control/audit', icon: <HistoryOutlined />, label: 'Activity log' },
];

function Login({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (v) => {
    setBusy(true);
    setError(null);
    try { const r = await call('/api/control/auth', { method: 'POST', body: JSON.stringify(v) }); onDone(r.owner); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#2b1712', padding: 16 }}>
      <Card style={{ width: 380, maxWidth: '100%' }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>Control panel</Typography.Title>
        <Typography.Paragraph type="secondary">Software owner sign-in (not for sanstha staff).</Typography.Paragraph>
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
        <Form layout="vertical" onFinish={submit}>
          <Form.Item name="email" label="Email" rules={[{ required: true }]}><Input autoComplete="username" autoFocus /></Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy}>Sign in</Button>
        </Form>
      </Card>
    </div>
  );
}

function PasswordModal({ onClose }) {
  const [form] = Form.useForm();
  const [run, busy] = useRun();
  const ok = async () => {
    const v = await form.validateFields();
    if (await run(() => crpc('owner.password', v.current, v.next), 'Password changed')) onClose();
  };
  return (
    <Modal open title="Change password" onCancel={onClose} onOk={ok} confirmLoading={busy} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="current" label="Current password" rules={[{ required: true }]}><Input.Password /></Form.Item>
        <Form.Item name="next" label="New password (min 10)" rules={[{ required: true, min: 10 }]}><Input.Password /></Form.Item>
        <Form.Item name="again" label="Repeat" dependencies={['next']} rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, v) => (v === getFieldValue('next') ? Promise.resolve() : Promise.reject(new Error('Does not match'))) })]}><Input.Password /></Form.Item>
      </Form>
    </Modal>
  );
}

export default function ControlShell({ children }) {
  const path = usePathname();
  const [owner, setOwner] = useState(undefined);
  const [error, setError] = useState(null);
  const [pw, setPw] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  useEffect(() => {
    call('/api/control/auth').then((r) => setOwner(r.owner)).catch((e) => { setOwner(null); if (e.status === 404) setError('The control panel opens only on the control address (CONTROL_HOST).'); });
    const out = () => setOwner(null);
    window.addEventListener('tm:owner-out', out);
    return () => window.removeEventListener('tm:owner-out', out);
  }, []);
  if (owner === undefined) return <div style={{ padding: 80, textAlign: 'center' }}><Spin /></div>;
  if (error) return <div style={{ padding: 40 }}><Alert type="warning" showIcon message={error} /></div>;
  if (!owner) return <Login onDone={setOwner} />;
  const selected = MENU.map((m) => m.key).filter((k) => path === k || (k !== '/control' && path.startsWith(k))).pop() || '/control';
  const menu = <Menu theme="dark" mode="inline" selectedKeys={[selected]} onClick={() => setMobileMenu(false)} items={MENU.map((m) => ({ key: m.key, icon: m.icon, label: <Link href={m.key}>{m.label}</Link> }))} />;
  const logout = async () => { await call('/api/control/auth', { method: 'DELETE' }).catch(() => {}); setOwner(null); };
  return (
    <Ctx.Provider value={owner}>
      <Layout style={{ minHeight: '100vh' }}>
        <Layout.Sider breakpoint="lg" collapsedWidth={0} trigger={null} width={220} className="control-sider" style={{ position: 'sticky', top: 0, height: '100vh' }}>
          <div style={{ color: '#fff', padding: '18px 20px', fontWeight: 600, fontSize: 16 }}>Control panel <Tag color="gold" style={{ marginLeft: 4 }}>Owner</Tag></div>
          {menu}
        </Layout.Sider>
        <Layout>
          <Layout.Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', position: 'sticky', top: 0, zIndex: 10, borderBottom: '1px solid #eee' }}>
            <Button className="control-burger" icon={<MenuOutlined />} onClick={() => setMobileMenu(true)} />
            <span />
            <Dropdown menu={{ items: [{ key: 'pw', icon: <KeyOutlined />, label: 'Change password', onClick: () => setPw(true) }, { key: 'out', icon: <LogoutOutlined />, label: 'Sign out', onClick: logout }] }}>
              <Button icon={<UserOutlined />}>{owner.name || owner.email}</Button>
            </Dropdown>
          </Layout.Header>
          <Layout.Content style={{ padding: 16, maxWidth: 1400, width: '100%', margin: '0 auto' }}>{children}</Layout.Content>
        </Layout>
      </Layout>
      <Modal open={mobileMenu} footer={null} onCancel={() => setMobileMenu(false)} styles={{ content: { background: '#2b1712', padding: 8 } }} width={280}>
        <Space direction="vertical" style={{ width: '100%', paddingTop: 24 }}>{menu}</Space>
      </Modal>
      {pw ? <PasswordModal onClose={() => setPw(false)} /> : null}
    </Ctx.Provider>
  );
}

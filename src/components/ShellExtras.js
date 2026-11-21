'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Modal, Form, Input, App,
} from 'antd';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { fyIdOf, todayStr } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { createFinancialYear, refreshProvisionalOpening, prevFyIdOf } from '@/services/closing';
import { useLang } from '@/i18n/LangContext';

/** Shows a banner while the browser is offline (saves need a connection). */
export function OfflineBanner() {
  const { t: tr } = useLang();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  if (online) return null;
  return <Alert type="error" showIcon banner style={{ marginBottom: 12 }} title={tr('You are offline. Saved data is shown, but new entries, approvals and payments need an internet connection.')} />;
}

/**
 * Year-level warnings:
 *  - today's financial year does not exist (nothing can be entered after 1 April)
 *  - the selected year's opening balances are provisional (previous year not yet closed)
 */
export function YearBanners() {
  const { t: tr } = useLang();
  const { user, role } = useAuth();
  const app = useAppData();
  const [run, busy] = useAction();
  const isSuper = role === 'superAdmin';
  const todayFy = fyIdOf(todayStr());
  const missing = app.ready && !app.fys.some((f) => f.id === todayFy);
  const fy = app.selectedFy;
  const prevId = fy ? prevFyIdOf(fy.id) : null;
  const prev = prevId ? app.fys.find((f) => f.id === prevId) : null;
  const provisional = fy && (fy.openingProvisional || (prev && prev.status === 'open' && !fy.openingCarriedFrom));

  return (
    <>
      {missing ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={tr('Financial year {v0} has not been created yet – entries dated today cannot be saved.', { v0: todayFy })}
          action={isSuper ? (
            <Button size="small" type="primary" loading={busy} onClick={() => run(() => createFinancialYear(todayFy, user, { accounts: app.accounts, makeCurrent: true }), tr('FY {v0} created', { v0: todayFy }))}>
              {tr('Create FY {v0}', { v0: todayFy })}
            </Button>
          ) : <span className="muted">{tr('Ask the Super Admin to create it.')}</span>}
        />
      ) : null}
      {provisional ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={tr('Opening balances of FY {v0} are provisional until FY {v1} is closed.', { v0: fy.id, v1: prevId })}
          description={tr('They are taken from FY {v0} as it stands now. Close FY {v0} (Financial Year menu) to fix them; monthly closing of FY {v1} is possible after that.', { v0: prevId, v1: fy.id })}
          action={isSuper && prev?.status === 'open' ? (
            <Button size="small" loading={busy} onClick={() => run(() => refreshProvisionalOpening({ fy, fys: app.fys, accounts: app.accounts, user }), 'Opening balances refreshed')}>
              {tr('Refresh opening')}
            </Button>
          ) : null}
        />
      ) : null}
    </>
  );
}

/** `forced`: a temporary password set by the Super Admin must be changed before working */
export function ChangePasswordModal({ open, onClose, forced = false }) {
  const { t: tr } = useLang();
  const { changePassword } = useAuth();
  const [run, busy] = useAction();
  const [form] = Form.useForm();
  const save = async () => {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    if (await run(() => changePassword(v.current, v.password), 'Password changed')) { form.resetFields(); onClose(); }
  };
  return (
    <Modal open={open} onCancel={forced ? undefined : onClose} closable={!forced} maskClosable={!forced} keyboard={!forced} cancelButtonProps={forced ? { style: { display: 'none' } } : undefined} onOk={save} confirmLoading={busy} title={tr('Change password')} destroyOnHidden>
      {forced ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tr('Your password was set by the Super Admin. Please choose your own password to continue.')} /> : null}
      <Form form={form} layout="vertical">
        <Form.Item name="current" label={tr('Current password')} rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
        <Form.Item name="password" label={tr('New password')} rules={[{ required: true, min: 8 }]} hasFeedback><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item
          name="confirm"
          label={tr('Confirm new password')}
          dependencies={['password']}
          hasFeedback
          rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, v) => (!v || v === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error(tr('Passwords do not match')))) })]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Signs the user out after N idle minutes (Settings → idleMinutes, default 30, 0 = never). */
export function useIdleLogout() {
  const { user, logout } = useAuth();
  const app = useAppData();
  const { message } = App.useApp();
  const { t: tr } = useLang();
  const last = useRef(Date.now());
  const minutes = Number(app.settings?.idleMinutes ?? 30);
  useEffect(() => {
    if (!user || !minutes) return undefined;
    const bump = () => { last.current = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'visibilitychange'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - last.current > minutes * 60_000) {
        clearInterval(timer);
        message.warning(tr('Signed out after {n} minutes without activity', { n: minutes }), 5);
        logout();
      }
    }, 30_000);
    return () => { clearInterval(timer); events.forEach((e) => window.removeEventListener(e, bump)); };
  }, [user, minutes, logout, message, tr]);
}

/** "Install app" button – appears when the browser offers to install the panel (PWA) */
export function InstallAppButton() {
  const { t: tr } = useLang();
  const [evt, setEvt] = useState(null);
  useEffect(() => {
    const h = (e) => { e.preventDefault(); setEvt(e); };
    const done = () => setEvt(null);
    window.addEventListener('beforeinstallprompt', h);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', h); window.removeEventListener('appinstalled', done); };
  }, []);
  if (!evt) return null;
  return (
    <Button size="small" onClick={async () => { evt.prompt(); try { await evt.userChoice; } catch { /* ignore */ } setEvt(null); }}>
      📱 {tr('Install app')}
    </Button>
  );
}

/** 2-step login (authenticator app) – set up / turn off; `forced` when the Super Admin requires it for the role */
export function TwoFactorModal({ open, onClose, forced = false }) {
  const { t: tr } = useLang();
  const { refresh } = useAuth();
  const [run, busy] = useAction();
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [pw, setPw] = useState('');
  useEffect(() => {
    if (!open) return;
    setSetup(null); setCode(''); setCodes(null); setPw('');
    import('@/lib/api').then(({ rpcRead }) => rpcRead('auth.totpStatus')).then(setStatus).catch(() => setStatus({ enabled: false }));
  }, [open]);
  const start = () => run(async () => { const { rpc } = await import('@/lib/api'); setSetup(await rpc('auth.totpSetup')); });
  const enable = () => run(async () => {
    const { rpc } = await import('@/lib/api');
    const r = await rpc('auth.totpEnable', code.trim());
    setCodes(r.recoveryCodes);
    setStatus({ enabled: true, recoveryLeft: r.recoveryCodes.length });
    await refresh?.();
  }, '2-step login is on');
  const disable = () => run(async () => {
    const { rpc } = await import('@/lib/api');
    await rpc('auth.totpDisable', pw);
    setStatus({ enabled: false });
    await refresh?.();
  }, '2-step login is off');
  const done = codes || (status?.enabled && !setup);
  return (
    <Modal
      open={open}
      title={tr('2-step login (authenticator app)')}
      onCancel={forced && !status?.enabled ? undefined : onClose}
      closable={!(forced && !status?.enabled)}
      maskClosable={false}
      footer={forced && !status?.enabled ? null : <Button onClick={onClose}>{tr('Close')}</Button>}
      destroyOnHidden
    >
      {forced && !status?.enabled ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tr('The Super Admin has made 2-step login compulsory for your role.')} /> : null}
      {codes ? (
        <>
          <Alert type="success" showIcon title={tr('2-step login is on')} description={tr('Save these recovery codes somewhere safe. Each works once if you lose your phone.')} />
          <pre style={{ background: '#fafafa', padding: 12, marginTop: 12, fontSize: 16, textAlign: 'center' }}>{codes.join('\n')}</pre>
        </>
      ) : status?.enabled ? (
        <>
          <Alert type="success" showIcon title={tr('2-step login is on')} description={tr('{n} recovery codes left.', { n: status.recoveryLeft })} />
          {!forced ? (
            <div style={{ marginTop: 12 }}>
              <Input.Password placeholder={tr('Your password')} value={pw} onChange={(e) => setPw(e.target.value)} />
              <Button danger block style={{ marginTop: 8 }} loading={busy} disabled={!pw} onClick={disable}>{tr('Turn off 2-step login')}</Button>
            </div>
          ) : null}
        </>
      ) : setup ? (
        <>
          <ol style={{ paddingLeft: 18 }}>
            <li>{tr('Open Google Authenticator / Microsoft Authenticator on your phone → “+” → scan this QR code.')}</li>
            <li>{tr('Type the 6-digit code shown in the app.')}</li>
          </ol>
          <div style={{ textAlign: 'center' }}><img src={setup.qr} alt="QR" width={200} height={200} /></div>
          <div style={{ textAlign: 'center', fontSize: 12, color: '#888', wordBreak: 'break-all' }}>{tr('Key')}: {setup.secret}</div>
          <Input size="large" style={{ marginTop: 12, textAlign: 'center', letterSpacing: 4 }} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onPressEnter={enable} placeholder="123456" inputMode="numeric" />
          <Button type="primary" block style={{ marginTop: 8 }} loading={busy} disabled={code.length !== 6} onClick={enable}>{tr('Turn on')}</Button>
        </>
      ) : (
        <>
          <p>{tr('After your password, the login will also ask for a 6-digit code from an app on your phone. Even if someone learns your password, they cannot sign in.')}</p>
          <Button type="primary" block loading={busy || !status} onClick={start}>{tr('Set up 2-step login')}</Button>
        </>
      )}
      {done && forced ? <Button type="primary" block style={{ marginTop: 12 }} onClick={onClose}>{tr('Continue')}</Button> : null}
    </Modal>
  );
}

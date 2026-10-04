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

export function ChangePasswordModal({ open, onClose }) {
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
    <Modal open={open} onCancel={onClose} onOk={save} confirmLoading={busy} title={tr('Change password')} destroyOnHidden>
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

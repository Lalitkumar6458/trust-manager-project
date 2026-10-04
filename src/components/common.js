'use client';

import { useState } from 'react';
import { Tag, Result, Modal, Input, Form, Timeline, Typography, Space, Tooltip } from 'antd';
import { STATUS_META } from '@/lib/constants';
import { money, fmtDateTime } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import { useLang } from '@/i18n/LangContext';

export function PageHeader({ title, subtitle, extra }) {
  const { t: tr } = useLang();
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <div className="sub">{subtitle}</div> : null}
      </div>
      {extra ? <Space wrap className="no-print">{extra}</Space> : null}
    </div>
  );
}

export function StatusTag({ status }) {
  const { t: tr } = useLang();
  const m = STATUS_META[status] || { label: status, color: 'default' };
  return <Tag color={m.color}>{tr(m.label)}</Tag>;
}

export function Money({ value, type, strong }) {
  const { t: tr } = useLang();
  const cls = `money${type ? ` ${type}` : ''}`;
  const v = money(value);
  return <span className={cls} style={strong ? { fontWeight: 600 } : undefined}>{v}</span>;
}

export function Guard({ perm, children }) {
  const { t: tr } = useLang();
  const { can, loading } = useAuth();
  if (loading) return null;
  if (!can(perm)) {
    return <Result status="403" title={tr('Access denied')} subTitle={tr('Your role does not have permission to view this page.')} />;
  }
  return children;
}

/** Ask for a mandatory reason. Usage: const [ask, modal] = useReasonPrompt(); const r = await ask('Void donation'); */
export function useReasonPrompt() {
  const { t: tr } = useLang();
  const [state, setState] = useState(null);
  const [form] = Form.useForm();
  const ask = (title, { okText = 'Confirm', danger = true, label = 'Reason', placeholder = 'Enter reason (mandatory – saved in audit trail)' } = {}) => new Promise((resolve) => {
    form.resetFields();
    setState({ title, okText: tr(okText), danger, label: tr(label), placeholder: tr(placeholder), resolve });
  });
  const close = (val) => {
    state?.resolve(val);
    setState(null);
  };
  const modal = (
    <Modal
      open={!!state}
      title={state?.title}
      okText={state?.okText}
      okButtonProps={{ danger: state?.danger }}
      onCancel={() => close(null)}
      onOk={() => form.validateFields().then((v) => close(v.reason.trim()))}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item name="reason" label={state?.label} rules={[{ required: true, whitespace: true, message: tr('Reason is required') }]}>
          <Input.TextArea rows={3} placeholder={state?.placeholder} autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
  return [ask, modal];
}

export function WorkflowTimeline({ workflow = [] }) {
  const { t: tr } = useLang();
  if (!workflow.length) return <Typography.Text type="secondary">{tr('No history')}</Typography.Text>;
  return (
    <Timeline
      items={workflow.map((w) => ({
        color: w.status === 'void' ? 'red' : ['approved', 'paid'].includes(w.status) ? 'green' : w.status === 'edited' ? 'orange' : 'blue',
        content: (
          <div>
            <StatusTag status={w.status} /> <b>{w.byName}</b>
            <div className="muted" style={{ fontSize: 12 }}>{fmtDateTime(new Date(w.at))}</div>
            {w.note ? <div style={{ fontSize: 13 }}>{w.note}</div> : null}
          </div>
        ),
      }))}
    />
  );
}

export function Masked({ value, show }) {
  const { t: tr } = useLang();
  if (!value) return null;
  return <Tooltip title={show ? value : tr('Hidden for privacy')}><span>{show ? value : `XXXX${String(value).slice(-4)}`}</span></Tooltip>;
}

'use client';

import { useState } from 'react';
import {
  Button, Card, Table, Modal, Form, Input, Select, DatePicker, Tag, Switch,
} from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { COL, DESIGNATIONS } from '@/lib/constants';
import { fmtDate, MOBILE_REGEX } from '@/lib/format';
import { useLiveQuery, useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader, Guard, StatusTag } from '@/components/common';
import ExportButtons from '@/components/ExportButtons';
import { saveMaster } from '@/services/masters';
import { useLang } from '@/i18n/LangContext';

function TrusteeModal({ trustee, open, onClose }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const submit = async () => {
    const v = await form.validateFields();
    const payload = { ...v, joiningDate: v.joiningDate ? v.joiningDate.format('YYYY-MM-DD') : null, leavingDate: v.leavingDate ? v.leavingDate.format('YYYY-MM-DD') : null };
    if (!trustee) payload.status = payload.status || 'active';
    if (await run(() => saveMaster(COL.trustees, trustee?.id, payload, user), 'Saved')) onClose();
  };
  return (
    <Modal open={open} onCancel={onClose} onOk={submit} confirmLoading={busy} title={trustee ? tr('Edit {v0}', { v0: trustee.name }) : tr('Add trustee / committee member')} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={trustee ? { ...trustee, joiningDate: trustee.joiningDate ? dayjs(trustee.joiningDate) : null, leavingDate: trustee.leavingDate ? dayjs(trustee.leavingDate) : null } : { designation: 'Trustee', status: 'active', signingAuthority: false }}
      >
        <Form.Item name="name" label={tr('Name')} rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="designation" label={tr('Designation')}><Select options={DESIGNATIONS.map((d) => ({ value: d, label: tr(d) }))} /></Form.Item>
        <Form.Item name="mobile" label={tr('Mobile')} rules={[{ pattern: MOBILE_REGEX, message: tr('10 digit mobile') }]}><Input maxLength={10} /></Form.Item>
        <Form.Item name="email" label={tr('Email')} rules={[{ type: 'email' }]}><Input /></Form.Item>
        <Form.Item name="address" label={tr('Address')}><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="joiningDate" label={tr('Joining date')}><DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} /></Form.Item>
        <Form.Item
          name="leavingDate"
          label={tr('Leaving date')}
          dependencies={['joiningDate']}
          rules={[({ getFieldValue }) => ({ validator: (_, v) => (!v || !getFieldValue('joiningDate') || !v.isBefore(getFieldValue('joiningDate'), 'day') ? Promise.resolve() : Promise.reject(new Error(tr('Leaving date cannot be before the joining date')))) })]}
        >
          <DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="role" label={tr('Role / responsibility')}><Input placeholder={tr('e.g. Cheque signatory, Finance committee')} /></Form.Item>
        <Form.Item name="signingAuthority" label={tr('Authorised signatory (bank / approvals)')} valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="authorization" label={tr('Authorization details')}><Input.TextArea rows={2} placeholder={tr('e.g. Can approve expenses up to ₹50,000; joint signatory with Treasurer')} /></Form.Item>
        <Form.Item name="status" label={tr('Status')}><Select options={[{ value: 'active', label: tr('Active') }, { value: 'inactive', label: tr('Inactive') }]} /></Form.Item>
      </Form>
    </Modal>
  );
}

export default function TrusteesPage() {
  const { t: tr } = useLang();
  const { can } = useAuth();
  const { data, loading } = useLiveQuery(COL.trustees, [], []);
  const [edit, setEdit] = useState(null);
  const [open, setOpen] = useState(false);
  const order = (d) => { const i = DESIGNATIONS.indexOf(d); return i < 0 ? 99 : i; };
  const rows = [...data].sort((a, b) => (a.status === b.status ? order(a.designation) - order(b.designation) : a.status === 'active' ? -1 : 1));
  const cols = [
    { title: tr('Name'), key: 'name', width: 2 }, { title: tr('Designation'), key: 'designation' }, { title: tr('Mobile'), key: 'mobile' }, { title: tr('Email'), key: 'email' },
    { title: tr('Joining'), key: 'joiningDate', value: (r) => fmtDate(r.joiningDate) }, { title: tr('Role'), key: 'role' },
    { title: tr('Signatory'), key: 'signingAuthority', value: (r) => (r.signingAuthority ? tr('Yes') : '') }, { title: tr('Status'), key: 'status' },
  ];
  return (
    <Guard perm="trustees.view">
      <PageHeader
        title={tr('Trustees / Committee')}
        subtitle={tr('Trust members, designations and authorizations')}
        extra={[
          <ExportButtons key="x" title={tr('Trustee List')} columns={cols} rows={rows} />,
          can('trustees.manage') ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{tr('Add member')}</Button> : null,
        ]}
      />
      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 800 }}
          pagination={false}
          columns={[
            { title: tr('Name'), dataIndex: 'name', render: (v) => <b>{v}</b> },
            { title: tr('Designation'), dataIndex: 'designation', render: (d) => <Tag color={['President', 'Secretary', 'Treasurer'].includes(d) ? 'gold' : 'default'}>{d}</Tag> },
            { title: tr('Mobile'), dataIndex: 'mobile' },
            { title: tr('Email'), dataIndex: 'email', responsive: ['lg'] },
            { title: tr('Joining'), dataIndex: 'joiningDate', render: fmtDate },
            { title: tr('Role / authorization'), render: (_, r) => <span>{r.role}{r.signingAuthority ? <Tag color="blue" style={{ marginLeft: 6 }}>{tr('Signatory')}</Tag> : null}<div className="muted" style={{ fontSize: 12 }}>{r.authorization}</div></span> },
            { title: tr('Status'), dataIndex: 'status', render: (s) => <StatusTag status={s || 'active'} /> },
            { title: '', width: 50, render: (_, r) => (can('trustees.manage') ? <Button size="small" icon={<EditOutlined />} onClick={() => setEdit(r)} /> : null) },
          ]}
        />
      </Card>
      {open ? <TrusteeModal open onClose={() => setOpen(false)} /> : null}
      {edit ? <TrusteeModal open trustee={edit} onClose={() => setEdit(null)} /> : null}
    </Guard>
  );
}

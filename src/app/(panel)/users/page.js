'use client';

import { useMemo, useState } from 'react';
import {
  Button, Card, Table, Modal, Form, Input, Select, Tag, Dropdown, Alert, Typography, Tabs, Drawer, Checkbox, Space, Popconfirm, Empty, Tooltip,
} from 'antd';
import { PlusOutlined, MoreOutlined, EditOutlined, DeleteOutlined, CopyOutlined, LockOutlined } from '@ant-design/icons';
import { COL, ROLES, ROLE_LABELS, ROLE_COLORS } from '@/lib/constants';
import {
  ROLE_DESCRIPTIONS, PERMISSIONS, PERMISSION_GROUPS, SUPER_ONLY, CUSTOM_ROLE, normalizePerms, builtInPerms, can as roleCan,
} from '@/lib/permissions';
import { fmtDateTime } from '@/lib/format';
import { useLiveQuery, useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Guard } from '@/components/common';
import { createStaffUser, updateStaffLogin } from '@/services/users';
import { saveRole, deleteRole, assignRole, roleValueOf } from '@/services/roles';
import { useLang } from '@/i18n/LangContext';

const BUILT_IN = Object.values(ROLES);

function RoleTag({ u }) {
  const { t: tr } = useLang();
  if (u?.role === CUSTOM_ROLE) return <Tag color={ROLE_COLORS.custom}>{u.roleName || tr('Custom role')}</Tag>;
  return <Tag color={ROLE_COLORS[u?.role]}>{tr(ROLE_LABELS[u?.role] || u?.role || '—')}</Tag>;
}

/** Screen / action checkbox grid used by the role editor */
function PermissionPicker({ value = [], onChange }) {
  const { t: tr } = useLang();
  const set = new Set(value);
  const update = (next) => onChange(normalizePerms([...next]));
  const toggleView = (g, on) => {
    const next = new Set(set);
    if (on) next.add(g.view);
    else { next.delete(g.view); g.actions.forEach((a) => next.delete(a.perm)); }
    update(next);
  };
  const toggleAction = (p, on) => {
    const next = new Set(set);
    if (on) next.add(p); else next.delete(p);
    update(next);
  };
  const rows = PERMISSION_GROUPS.map((g) => ({ ...g, superOnly: SUPER_ONLY.includes(g.view) }));
  return (
    <Table
      size="small"
      rowKey="key"
      pagination={false}
      dataSource={rows}
      columns={[
        {
          title: tr('Screen access'), width: 230,
          render: (_, g) => (g.superOnly ? (
            <Space><LockOutlined className="muted" /><span className="muted">{tr(g.label)}</span></Space>
          ) : (
            <Checkbox checked={set.has(g.view)} onChange={(e) => toggleView(g, e.target.checked)}><b>{tr(g.label)}</b></Checkbox>
          )),
        },
        {
          title: tr('Allowed actions'),
          render: (_, g) => {
            if (g.superOnly) return <Tag icon={<LockOutlined />}>{tr('Super Admin only')}</Tag>;
            if (!g.actions.length) return <span className="muted">{tr('View only')}</span>;
            return (
              <Space orientation="vertical" size={2}>
                {g.actions.map((a) => (SUPER_ONLY.includes(a.perm) ? (
                  <span key={a.perm} className="muted" style={{ fontSize: 13 }}><LockOutlined /> {tr(a.label)} <Tag style={{ marginLeft: 4 }}>{tr('Super Admin only')}</Tag></span>
                ) : (
                  <Checkbox key={a.perm} checked={set.has(a.perm)} onChange={(e) => toggleAction(a.perm, e.target.checked)}>{tr(a.label)}</Checkbox>
                )))}
              </Space>
            );
          },
        },
      ]}
    />
  );
}

function RoleEditor({ open, role, onClose }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const [run, busy] = useAction();
  const [form] = Form.useForm();
  const perms = Form.useWatch('permissions', form) || [];

  const save = async () => {
    const v = await form.validateFields();
    if (await run(() => saveRole({ id: role?.id, ...v }, user, role), role?.id ? 'Role updated' : 'Role created')) onClose();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={760}
      destroyOnHidden
      title={role?.id ? tr('Edit role – {v0}', { v0: role.name }) : tr('New custom role')}
      afterOpenChange={(o) => { if (o) form.setFieldsValue({ name: role?.name || '', description: role?.description || '', permissions: role?.permissions || [] }); }}
      extra={<Button type="primary" loading={busy} onClick={save}>{tr('Save role')}</Button>}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label={tr('Role name')} rules={[{ required: true }]}><Input placeholder={tr('e.g. Cashier, Donation Clerk, Trustee (view only)')} maxLength={60} /></Form.Item>
        <Form.Item name="description" label={tr('Description')}><Input.TextArea rows={2} maxLength={300} /></Form.Item>
        <Space wrap style={{ marginBottom: 10 }}>
          <Typography.Text type="secondary">{tr('Start from:')}</Typography.Text>
          {BUILT_IN.filter((r) => r !== 'superAdmin').map((r) => (
            <Button key={r} size="small" icon={<CopyOutlined />} onClick={() => form.setFieldValue('permissions', builtInPerms(r))}>{tr(ROLE_LABELS[r])}</Button>
          ))}
          <Button size="small" onClick={() => form.setFieldValue('permissions', normalizePerms(Object.keys(PERMISSIONS)))}>{tr('Select all')}</Button>
          <Button size="small" onClick={() => form.setFieldValue('permissions', [])}>{tr('Clear')}</Button>
          <Tag color="blue">{tr('{n} permission(s) selected', { n: perms.length })}</Tag>
        </Space>
        <Form.Item name="permissions" rules={[{ validator: (_, v) => (v?.length ? Promise.resolve() : Promise.reject(new Error(tr('Select at least one screen')))) }]}>
          <PermissionPicker />
        </Form.Item>
        <Alert type="info" showIcon title={tr('Changes apply immediately to every user who has this role. Users, period locks, reopening months and finalizing years always stay with the Super Admin.')} />
      </Form>
    </Drawer>
  );
}

export default function UsersPage() {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const app = useAppData();
  const roles = app.roles || [];
  const { data, loading } = useLiveQuery(COL.users, [], []);
  const [run, busy] = useAction();
  const [rowRun] = useAction();
  const [rowBusy, setRowBusy] = useState({}); // uid → true while that row saves
  const [pendingRole, setPendingRole] = useState({}); // optimistic select value
  const [open, setOpen] = useState(false);
  const [pwFor, setPwFor] = useState(null);
  const [editing, setEditing] = useState(null); // role being edited ({} = new)
  const [form] = Form.useForm();
  const [pwForm] = Form.useForm();

  const roleOptions = useMemo(() => [
    { label: tr('Built-in roles'), options: BUILT_IN.map((r) => ({ value: r, label: tr(ROLE_LABELS[r]) })) },
    ...(roles.length ? [{ label: tr('Custom roles'), options: roles.map((r) => ({ value: `custom:${r.id}`, label: r.name })) }] : []),
  ], [roles, tr]);

  const usersByRole = useMemo(() => {
    const m = {};
    data.forEach((u) => { const k = roleValueOf(u); m[k] = (m[k] || 0) + 1; });
    return m;
  }, [data]);

  const rowAction = async (uid, fn, msg) => {
    setRowBusy((s) => ({ ...s, [uid]: true }));
    try { return await rowRun(fn, msg); } finally { setRowBusy((s) => ({ ...s, [uid]: false })); }
  };

  const changeRole = async (u, value) => {
    setPendingRole((s) => ({ ...s, [u.id]: value }));
    await rowAction(u.id, () => assignRole(u, value, roles, user), 'Role updated');
    setPendingRole((s) => { const n = { ...s }; delete n[u.id]; return n; });
  };

  const create = async () => {
    const v = await form.validateFields();
    if (await run(() => createStaffUser(v), 'User created')) {
      form.resetFields();
      setOpen(false);
    }
  };

  const matrixCols = [
    ...BUILT_IN.map((r) => ({ key: r, title: tr(ROLE_LABELS[r]), has: (p) => roleCan(r, p) })),
    ...roles.map((r) => ({ key: r.id, title: r.name, has: (p) => !SUPER_ONLY.includes(p) && (r.permissions || []).includes(p) })),
  ];
  const matrixRows = PERMISSION_GROUPS.flatMap((g) => [
    { key: g.view, label: tr(g.label), screen: true },
    ...g.actions.map((a) => ({ key: a.perm, label: tr(a.label) })),
  ]);

  const usersTab = (
    <Card>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        scroll={{ x: 800 }}
        pagination={false}
        columns={[
          { title: tr('Name'), dataIndex: 'name', render: (v, r) => <b>{v}{r.id === user.uid ? ` (${tr('you')})` : ''}</b> },
          { title: tr('Email'), dataIndex: 'email' },
          { title: tr('Mobile'), dataIndex: 'mobile', responsive: ['lg'] },
          {
            title: tr('Role'), key: 'role', width: 240,
            render: (_, u) => (u.id === user.uid ? <RoleTag u={u} /> : (
              <Select
                size="small"
                style={{ width: 220 }}
                value={pendingRole[u.id] ?? roleValueOf(u)}
                options={roleOptions}
                loading={!!rowBusy[u.id]}
                disabled={!!rowBusy[u.id]}
                onChange={(v) => changeRole(u, v)}
              />
            )),
          },
          { title: tr('Status'), dataIndex: 'active', render: (a) => (a === false ? <Tag color="red">{tr('Disabled')}</Tag> : <Tag color="green">{tr('Active')}</Tag>) },
          { title: tr('Created'), dataIndex: 'createdAt', render: fmtDateTime, responsive: ['xl'] },
          {
            title: '', width: 50,
            render: (_, u) => (u.id === user.uid ? null : (
              <Dropdown menu={{
                items: [
                  { key: 'p', label: tr('Reset password'), onClick: () => setPwFor(u) },
                  { key: 'd', label: u.active === false ? tr('Enable login') : tr('Disable login'), danger: u.active !== false, onClick: () => rowAction(u.id, () => updateStaffLogin({ uid: u.id, disabled: u.active !== false }), 'Updated') },
                ],
              }}
              >
                <Button size="small" icon={<MoreOutlined />} loading={!!rowBusy[u.id]} />
              </Dropdown>
            )),
          },
        ]}
      />
    </Card>
  );

  const rolesTab = (
    <>
      <Card
        size="small"
        title={tr('Custom roles')}
        style={{ marginBottom: 12 }}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>{tr('New custom role')}</Button>}
      >
        {roles.length ? (
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={roles}
            columns={[
              { title: tr('Role'), dataIndex: 'name', render: (v) => <Tag color={ROLE_COLORS.custom}>{v}</Tag> },
              { title: tr('Description'), dataIndex: 'description', responsive: ['md'] },
              {
                title: tr('Screens'), key: 's',
                render: (_, r) => {
                  const screens = PERMISSION_GROUPS.filter((g) => (r.permissions || []).includes(g.view));
                  return <span>{screens.map((g) => tr(g.label)).join(', ') || '—'}</span>;
                },
              },
              { title: tr('Users'), key: 'u', width: 70, align: 'center', render: (_, r) => usersByRole[`custom:${r.id}`] || 0 },
              {
                title: '', key: 'a', width: 90,
                render: (_, r) => (
                  <Space size={4}>
                    <Tooltip title={tr('Edit')}><Button size="small" icon={<EditOutlined />} onClick={() => setEditing(r)} /></Tooltip>
                    <Popconfirm title={tr('Delete this role?')} onConfirm={() => run(() => deleteRole(r, user), 'Role deleted')}>
                      <Button size="small" danger icon={<DeleteOutlined />} disabled={!!usersByRole[`custom:${r.id}`]} />
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        ) : (
          <Empty description={tr('No custom roles yet. Create one and choose exactly which screens and actions it can use.')} />
        )}
      </Card>
      <Card size="small" title={tr('Built-in roles')} style={{ marginBottom: 12 }}>
        <Table
          size="small"
          rowKey="r"
          pagination={false}
          dataSource={BUILT_IN.map((r) => ({ r }))}
          columns={[
            { title: tr('Role'), key: 'n', width: 180, render: (_, { r }) => <Tag color={ROLE_COLORS[r]}>{tr(ROLE_LABELS[r])}</Tag> },
            { title: tr('Description'), key: 'd', render: (_, { r }) => tr(ROLE_DESCRIPTIONS[r]) },
            { title: tr('Users'), key: 'u', width: 70, align: 'center', render: (_, { r }) => usersByRole[r] || 0 },
            {
              title: '', key: 'c', width: 50,
              render: (_, { r }) => (r === 'superAdmin' ? null : (
                <Tooltip title={tr('Copy as custom role')}>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => setEditing({ name: `${tr(ROLE_LABELS[r])} (${tr('custom')})`, permissions: builtInPerms(r) })} />
                </Tooltip>
              )),
            },
          ]}
        />
      </Card>
      <Card title={tr('Permission matrix')} size="small">
        <Table
          size="small"
          rowKey="key"
          dataSource={matrixRows}
          pagination={false}
          scroll={{ x: 600 + roles.length * 110, y: 460 }}
          columns={[
            { title: tr('Screen / action'), dataIndex: 'label', width: 280, fixed: 'left', render: (v, r) => (r.screen ? <b>{v}</b> : <span style={{ paddingLeft: 16 }}>{v}</span>) },
            ...matrixCols.map((c) => ({ title: c.title, key: c.key, width: 110, align: 'center', render: (_, r) => (c.has(r.key) ? '✓' : '') })),
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>{tr('The same rules are enforced on the server by Firestore & Storage security rules.')}</Typography.Paragraph>
      </Card>
    </>
  );

  return (
    <Guard perm="users.manage">
      <PageHeader
        title={tr('Users & Roles')}
        subtitle={tr('Staff logins and role-based permissions')}
        extra={[
          <Button key="r" icon={<PlusOutlined />} onClick={() => setEditing({})}>{tr('New custom role')}</Button>,
          <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{tr('Add user')}</Button>,
        ]}
      />
      <Tabs
        items={[
          { key: 'users', label: tr('Users'), children: usersTab },
          { key: 'roles', label: tr('Roles & permissions'), children: rolesTab },
        ]}
      />

      <Modal open={open} onCancel={() => setOpen(false)} onOk={create} confirmLoading={busy} title={tr('Add staff user')} destroyOnHidden>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tr('Creates a Firebase login. Requires the server-side Firebase Admin credentials (see README).')} />
        <Form form={form} layout="vertical" initialValues={{ role: 'operator' }}>
          <Form.Item name="name" label={tr('Name')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="email" label={tr('Email')} rules={[{ required: true, type: 'email' }]}><Input /></Form.Item>
          <Form.Item name="mobile" label={tr('Mobile')}><Input /></Form.Item>
          <Form.Item
            name="role"
            label={tr('Role')}
            rules={[{ required: true }]}
            extra={<Button type="link" size="small" style={{ padding: 0 }} onClick={() => setEditing({})}>{tr('+ Create a custom role')}</Button>}
          >
            <Select options={roleOptions} />
          </Form.Item>
          <Form.Item name="password" label={tr('Temporary password')} rules={[{ required: true, min: 8 }]}><Input.Password /></Form.Item>
        </Form>
      </Modal>
      <Modal open={!!pwFor} onCancel={() => setPwFor(null)} title={tr('Reset password – {v0}', { v0: pwFor?.email })} confirmLoading={busy} destroyOnHidden
        onOk={async () => { const v = await pwForm.validateFields(); if (await run(() => updateStaffLogin({ uid: pwFor.id, password: v.password }), 'Password updated')) setPwFor(null); }}
      >
        <Form form={pwForm} layout="vertical"><Form.Item name="password" label={tr('New password')} rules={[{ required: true, min: 8 }]}><Input.Password /></Form.Item></Form>
      </Modal>
      <RoleEditor open={!!editing} role={editing} onClose={() => setEditing(null)} />
    </Guard>
  );
}

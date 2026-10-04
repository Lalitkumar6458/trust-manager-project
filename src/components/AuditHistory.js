'use client';

import { Table, Tag, Typography } from 'antd';
import { where } from 'firebase/firestore';
import { COL } from '@/lib/constants';
import { fmtDateTime } from '@/lib/format';
import { useLiveQuery } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useLang } from '@/i18n/LangContext';

const ACTION_COLOR = {
  create: 'green', update: 'orange', void: 'red', reverse: 'red', approve: 'blue', pay: 'blue', status_change: 'cyan', close: 'purple', reopen: 'magenta',
};

export const fmtVal = (v) => {
  if (v === null || v === undefined) return <Typography.Text type="secondary">—</Typography.Text>;
  if (typeof v === 'object') return <code style={{ fontSize: 11 }}>{JSON.stringify(v).slice(0, 200)}</code>;
  return String(v).slice(0, 200);
};

export function ChangesTable({ changes = [] }) {
  const { t: tr } = useLang();
  if (!changes.length) return <Typography.Text type="secondary">{tr('No field changes recorded')}</Typography.Text>;
  return (
    <Table
      size="small"
      pagination={false}
      rowKey={(r, i) => `${r.field}-${i}`}
      dataSource={changes}
      columns={[
        { title: tr('Field'), dataIndex: 'field', width: 160 },
        { title: tr('Old value'), dataIndex: 'old', render: fmtVal },
        { title: tr('New value'), dataIndex: 'new', render: fmtVal },
      ]}
    />
  );
}

/** Audit trail of a single record */
export default function AuditHistory({ docId }) {
  const { t: tr } = useLang();
  const { can } = useAuth();
  const allowed = can('auditLogs.view');
  const { data, loading } = useLiveQuery(allowed && docId ? COL.auditLogs : null, [where('docId', '==', docId || '-')], [docId, allowed]);
  if (!allowed) return <Typography.Text type="secondary">{tr('Audit trail is visible to Admin / Accountant / Auditor.')}</Typography.Text>;
  const rows = [...data].sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0));
  return (
    <Table
      size="small"
      loading={loading}
      rowKey="id"
      dataSource={rows}
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
      expandable={{ expandedRowRender: (r) => <ChangesTable changes={r.changes} />, rowExpandable: (r) => (r.changes || []).length > 0 }}
      columns={[
        { title: tr('When'), dataIndex: 'at', render: fmtDateTime, width: 170 },
        { title: tr('User'), dataIndex: 'userName', render: (v, r) => <span>{v} <Typography.Text type="secondary">({r.role})</Typography.Text></span> },
        { title: tr('Action'), dataIndex: 'action', render: (a) => <Tag color={ACTION_COLOR[a]}>{a}</Tag> },
        { title: tr('Details'), render: (_, r) => [r.summary, r.reason && tr('Reason: {v0}', { v0: r.reason })].filter(Boolean).join(' · ') },
      ]}
    />
  );
}

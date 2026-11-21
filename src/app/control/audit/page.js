'use client';

import { Card, Table, Typography } from 'antd';
import { useControl } from '@/components/control/ControlShell';
import { dmyt } from '@/components/control/bits';

const LABEL = {
  login: 'Signed in', create_tenant: 'Sanstha created', update_tenant: 'Sanstha changed', suspend: 'Suspended', resume: 'Resumed', payment: 'Payment',
  void_payment: 'Payment voided', create_plan: 'Plan created', update_plan: 'Plan changed', settings: 'Settings changed', change_password: 'Password changed',
};

export default function AuditPage() {
  const [rows, loading] = useControl('audit.list');
  return (
    <div>
      <Typography.Title level={3}>Activity log</Typography.Title>
      <Card size="small">
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={rows || []}
          scroll={{ x: 800 }}
          pagination={{ pageSize: 50 }}
          columns={[
            { title: 'When', dataIndex: 'at', render: dmyt, width: 170 },
            { title: 'Who', dataIndex: 'actor' },
            { title: 'What', dataIndex: 'action', render: (a) => LABEL[a] || a },
            { title: 'Sanstha', dataIndex: 'tenant_name' },
            { title: 'Details', dataIndex: 'detail', render: (d) => <code style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{Object.keys(d || {}).length ? JSON.stringify(d) : ''}</code> },
          ]}
        />
      </Card>
    </div>
  );
}

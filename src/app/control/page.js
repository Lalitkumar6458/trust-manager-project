'use client';

import Link from 'next/link';
import { Card, Row, Col, Statistic, Table, Typography, Alert, Button, Space } from 'antd';
import { PlusOutlined, WhatsAppOutlined } from '@ant-design/icons';
import { useControl } from '@/components/control/ControlShell';
import { inr, dmy, dmyt, StateTag, daysText } from '@/components/control/bits';

export default function ControlDashboard() {
  const [d, loading, , error] = useControl('dashboard');
  if (error) return <Alert type="error" showIcon message={error} />;
  const s = d || { revenue: {}, soon: [], recent: [] };
  const stat = (title, value, color) => <Card size="small" loading={loading} className="control-stat"><Statistic title={title} value={value} styles={color ? { content: { color } } : undefined} /></Card>;
  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>Dashboard</Typography.Title>
        <Link href="/control/tenants?new=1"><Button type="primary" icon={<PlusOutlined />}>New sanstha</Button></Link>
      </Space>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>{stat('Total sansthaen', s.total)}</Col>
        <Col xs={12} md={6}>{stat('Active', s.active, '#237804')}</Col>
        <Col xs={12} md={6}>{stat('Expiring in 15 days', s.expiring, '#d46b08')}</Col>
        <Col xs={12} md={6}>{stat('Expired (grace / read-only)', (s.grace || 0) + (s.readonly || 0), '#a8071a')}</Col>
        <Col xs={12} md={6}>{stat('Collected this month', inr(s.revenue.month || 0))}</Col>
        <Col xs={12} md={6}>{stat('Collected this FY', inr(s.revenue.fy || 0))}</Col>
        <Col xs={12} md={6}>{stat('Yearly value of active plans', inr(s.arr || 0))}</Col>
        <Col xs={12} md={6}>{stat('Trial / fixed deals / suspended', `${s.trial || 0} / ${s.fixed || 0} / ${s.suspended || 0}`)}</Col>
      </Row>
      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={14}>
          <Card size="small" title="Renewal due – call these first">
            <Table
              size="small"
              rowKey="id"
              loading={loading}
              dataSource={s.soon}
              pagination={false}
              scroll={{ x: 560 }}
              locale={{ emptyText: 'Nothing due in the next 30 days' }}
              columns={[
                { title: 'Sanstha', render: (_, r) => <Link href={`/control/tenants/${r.id}`}>{r.name}</Link> },
                { title: 'Plan', dataIndex: 'planName' },
                { title: 'Expiry', dataIndex: 'expiresOn', render: dmy },
                { title: 'Status', render: (_, r) => <><StateTag lic={{ state: r.state }} /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{daysText(r)}</Typography.Text></> },
                { title: '', width: 50, render: (_, r) => (r.mobile ? <a target="_blank" rel="noreferrer" href={`https://wa.me/91${String(r.mobile).replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(`Namaste, ${r.name} ka software plan ${dmy(r.expiresOn)} ko samapt ho raha hai. Kripya renew karein.`)}`}><WhatsAppOutlined style={{ color: '#25d366', fontSize: 18 }} /></a> : null) },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title="Latest payments" extra={<Link href="/control/payments">All</Link>}>
            <Table
              size="small"
              rowKey="id"
              loading={loading}
              dataSource={s.recent}
              pagination={false}
              columns={[
                { title: 'Date', dataIndex: 'created_at', render: (v) => dmyt(v).split(',')[0] },
                { title: 'Sanstha', dataIndex: 'tenant_name' },
                { title: 'Amount', dataIndex: 'amount', align: 'right', render: inr },
                { title: 'Via', dataIndex: 'method' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import {
  Card, Row, Col, Statistic, Table, Tag, Button, Typography, Alert, Popconfirm, Input, Space, Badge,
} from 'antd';
import { ReloadOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { Guard, PageHeader } from '@/components/common';
import { useAppData } from '@/contexts/AppDataContext';
import { useAction, useLiveQuery } from '@/lib/hooks';
import { rpc, rpcRead } from '@/lib/api';
import { orderBy, limit } from '@/lib/q';
import { COL } from '@/lib/constants';
import { fmtDateTime } from '@/lib/format';
import { useLang } from '@/i18n/LangContext';

export default function SystemPage() {
  const { t: tr } = useLang();
  const app = useAppData();
  const [run, busy] = useAction();
  const [h, setH] = useState(null);
  const [email, setEmail] = useState('');
  const { data: errors, loading } = useLiveQuery(COL.errorLogs, [orderBy('at', 'desc'), limit(200)], []);
  const load = () => rpcRead('system.health').then(setH).catch((e) => setH({ error: e.message }));
  useEffect(() => { load(); }, []);
  useEffect(() => { setEmail(app.settings.monitor?.alertEmail || ''); }, [app.settings.monitor]);
  const backupAge = h?.backup?.at ? (Date.now() - new Date(h.backup.at).getTime()) / 3600000 : null;
  const upt = h?.uptimeSec ? `${Math.floor(h.uptimeSec / 86400)}d ${Math.floor((h.uptimeSec % 86400) / 3600)}h` : '—';
  return (
    <Guard perm="system.monitor">
      <PageHeader title={tr('System health')} subtitle={tr('Server, database, backup and error log')} extra={[<Button key="r" icon={<ReloadOutlined />} onClick={load}>{tr('Refresh')}</Button>]} />
      {h?.error ? <Alert type="error" showIcon title={h.error} style={{ marginBottom: 12 }} /> : null}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Database')} value={h?.db?.ok ? `OK · ${h.db.ms} ms` : h ? tr('DOWN') : '…'} styles={{ content: { color: h?.db?.ok ? '#237804' : '#a8071a', fontSize: 20 } }} /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{h?.db?.sizeMb ?? '–'} MB · {h?.db?.version || ''}</Typography.Text></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Disk free')} value={h?.disk ? `${h.disk.freeGb} / ${h.disk.totalGb} GB` : '—'} styles={{ content: { fontSize: 20, color: h?.disk && h.disk.freeGb < 2 ? '#a8071a' : undefined } }} /></Card></Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tr('Last backup')} value={h?.backup?.at ? fmtDateTime(h.backup.at) : tr('Not found')} styles={{ content: { fontSize: 16, color: backupAge === null || backupAge > 30 ? '#a8071a' : '#237804' } }} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{h?.backup ? tr('{n} backups on the server', { n: h.backup.count || 0 }) : tr('Backup folder not found (normal on a laptop)')}</Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Errors (7 days)')} value={h?.errors7d ? `${h.errors7d.distinct} / ${h.errors7d.total}` : '—'} styles={{ content: { fontSize: 20, color: h?.errors7d?.distinct ? '#d46b08' : '#237804' } }} /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{tr('different / total')}</Typography.Text></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Running since')} value={upt} styles={{ content: { fontSize: 20 } }} /><Typography.Text type="secondary" style={{ fontSize: 12 }}>Node {h?.node} · {h?.memoryMb} MB</Typography.Text></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Signed-in sessions')} value={h?.db?.sessions ?? '—'} styles={{ content: { fontSize: 20 } }} /></Card></Col>
        <Col xs={24} md={12}>
          <Card size="small" title={tr('Email me when a new server error happens')}>
            <Space.Compact style={{ width: '100%' }}>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
              <Button icon={<SaveOutlined />} loading={busy} onClick={() => run(() => rpc('system.alertEmail', email), 'Saved')}>{tr('Save')}</Button>
            </Space.Compact>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{tr('Needs email set up in Settings → Messages. Also add the free UptimeRobot check on /api/health (README).')}</Typography.Text>
          </Card>
        </Col>
      </Row>
      <Card
        size="small"
        title={tr('Error log')}
        extra={<Popconfirm title={tr('Clear the whole error log?')} onConfirm={() => run(() => rpc('system.clearErrors'), 'Cleared')}><Button size="small" danger icon={<DeleteOutlined />}>{tr('Clear')}</Button></Popconfirm>}
      >
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={errors}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          columns={[
            { title: tr('Last seen'), dataIndex: 'at', render: fmtDateTime, width: 150 },
            { title: tr('Type'), dataIndex: 'kind', width: 90, render: (k) => <Tag color={k === 'server' ? 'red' : 'orange'}>{k}</Tag> },
            { title: tr('Message'), dataIndex: 'message', render: (m, r) => <span>{m}{r.path ? <div style={{ fontSize: 11, color: '#888' }}>{r.path}</div> : null}</span> },
            { title: tr('Times'), dataIndex: 'count', width: 70, render: (c) => <Badge count={c} showZero color="#d46b08" overflowCount={9999} /> },
            { title: tr('User'), dataIndex: 'lastUser', width: 140 },
          ]}
          expandable={{ rowExpandable: (r) => !!r.stack, expandedRowRender: (r) => <pre style={{ fontSize: 11, maxHeight: 300, overflow: 'auto', margin: 0 }}>{r.stack}</pre> }}
        />
      </Card>
    </Guard>
  );
}

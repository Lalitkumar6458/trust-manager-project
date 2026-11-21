'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import {
  Card, Table, Button, Select, Space, Alert, Row, Col, Statistic, Input, Tag, Typography, Tabs, Spin,
} from 'antd';
import { DownloadOutlined, FilePdfOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { PageHeader, Guard, Money } from '@/components/common';
import { useAppData } from '@/contexts/AppDataContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAction } from '@/lib/hooks';
import { rpc, rpcRead } from '@/lib/api';
import { openBlob, form10bePdf } from '@/pdf/generate';
import { fmtDate } from '@/lib/format';
import { useLang } from '@/i18n/LangContext';

const maskUin = (r) => (r.idName === 'Aadhaar' ? `XXXX XXXX ${String(r.uin).slice(-4)}` : r.uin);
const ddmmyyyy = (s) => (s ? dayjs(s).format('DD-MM-YYYY') : '');
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Columns of the Income-tax portal Form 10BD CSV template */
const HEAD = [
  'Sr. No.', 'Pre Acknowledgement Number', 'ID Code', 'Unique Identification Number', 'Section Code', 'Unique Registration Number (URN)',
  'Date of Issuance of Unique Registration Number', 'Name of donor', 'Address of donor', 'Donation Type', 'Mode of receipt', 'Amount of donation (Indian rupees)',
];

export default function Form10BDPage() {
  const { t: tr } = useLang();
  const app = useAppData();
  const { can } = useAuth();
  const [run, busy] = useAction();
  const [fyId, setFyId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filing, setFiling] = useState({ arn: '', date: '' });

  // default: the last closed year is the one usually filed (10BD of FY X is due 31 May of X+1)
  useEffect(() => {
    if (fyId || !app.fys?.length) return;
    const ids = app.fys.map((f) => f.id).sort();
    const cur = app.currentFy?.id;
    const prev = ids.filter((x) => !cur || x < cur).pop();
    setFyId(prev || cur || ids[ids.length - 1]);
  }, [app.fys, app.currentFy, fyId]);

  const load = useCallback(async () => {
    if (!fyId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await rpcRead('reports.form10bd', fyId);
      setData(r);
      setFiling({ arn: r.trust.filing?.arn || '', date: r.trust.filing?.date || '' });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fyId]);
  useEffect(() => { load(); }, [load]);

  const s = app.settings || {};
  const missing = [!s.section80G && tr('80G registration no.'), !s.section80GDate && tr('80G approval date'), !s.pan && tr('Trust PAN')].filter(Boolean);
  const canExport = can('reports.export');

  const downloadCsv = () => {
    const lines = [HEAD.map(csvCell).join(',')];
    data.rows.forEach((r) => {
      lines.push([
        r.sr, '', r.idCode, r.uin, 'Section 80G', s.section80G || '', ddmmyyyy(s.section80GDate),
        r.name, String(r.address || '').replace(/\s*\n\s*/g, ', '), r.donationType, r.mode, Number(r.amount).toFixed(2),
      ].map(csvCell).join(','));
    });
    openBlob(new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), `Form-10BD-${fyId}.csv`, true);
  };

  const pdf10be = (rows, name) => run(() => form10bePdf({
    rows, settings: s, fyId, filing, download: !!name, fileName: name,
  }));

  const saveFiling = () => run(async () => {
    await rpc('reports.form10bdFiling', fyId, filing);
    await load();
  }, 'Saved');

  const columns = [
    { title: '#', dataIndex: 'sr', width: 50 },
    { title: tr('Donor'), dataIndex: 'name', render: (v, r) => (r.donorRef ? <Link href={`/donors/${r.donorRef}`}>{v}</Link> : v) },
    { title: tr('ID'), render: (_, r) => <span><Tag>{r.idCode}</Tag>{r.idName}: {maskUin(r)}</span> },
    { title: tr('Donation type'), dataIndex: 'donationType', width: 110 },
    { title: tr('Mode'), dataIndex: 'mode', render: (v) => (v.startsWith('Electronic') ? tr('Electronic / cheque') : v), width: 140 },
    { title: tr('Receipts'), dataIndex: 'receipts', render: (v) => <Typography.Text style={{ fontSize: 12 }}>{v.join(', ')}</Typography.Text> },
    { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} />, width: 130 },
    {
      title: '10BE', width: 70,
      render: (_, r) => (
        <Button size="small" icon={<FilePdfOutlined />} onClick={() => pdf10be(data.rows.filter((x) => (x.donorRef || x.name) === (r.donorRef || r.name) && x.uin === r.uin), null)} />
      ),
    },
  ];
  const skippedCols = [
    { title: tr('Receipt No.'), dataIndex: 'receiptNo', render: (v, r) => <Link href={`/donations/${r.donationId}`}>{v}</Link> },
    { title: tr('Date'), dataIndex: 'date', render: fmtDate, width: 110 },
    { title: tr('Donor'), dataIndex: 'donor', render: (v, r) => (r.donorRef ? <Link href={`/donors/${r.donorRef}`}>{v}</Link> : v) },
    { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> },
    {
      title: tr('Reason'), dataIndex: 'reason',
      render: (v) => (v === 'cash'
        ? <Tag color="red">{tr('Cash above ₹2,000 – no 80G deduction')}</Tag>
        : <Tag color="orange">{tr('No PAN / Aadhaar of donor – add it in the donor record')}</Tag>),
    },
  ];

  const fyOptions = useMemo(() => (app.fys || []).map((f) => f.id).sort().reverse().map((id) => ({ value: id, label: `FY ${id}` })), [app.fys]);
  const dueYear = fyId ? Number(fyId.slice(0, 4)) + 1 : '';

  return (
    <Guard perm="reports.view">
      <PageHeader
        title={tr('80G – Form 10BD / 10BE')}
        subtitle={tr('Yearly statement of 80G donations for the Income-tax portal (due 31 May) and donor certificates.')}
        extra={[
          <Select key="fy" style={{ width: 140 }} value={fyId} options={fyOptions} onChange={setFyId} />,
          <Button key="r" icon={<ReloadOutlined />} onClick={load} loading={loading} />,
        ]}
      />
      {missing.length ? (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tr('Fill these in Settings → Trust profile first: {list}', { list: missing.join(', ') })} action={<Link href="/settings"><Button size="small">{tr('Settings')}</Button></Link>} />
      ) : null}
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} /> : null}
      {!data && loading ? <Spin /> : null}
      {data ? (
        <>
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Approved donations')} value={data.totals.donations} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Total received')} value={data.totals.all} precision={2} prefix="₹" /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Reported in 10BD')} value={data.totals.reported} precision={2} prefix="₹" styles={{ content: { color: '#1b7f3b' } }} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Left out (see list)')} value={data.totals.skipped} precision={2} prefix="₹" styles={{ content: { color: data.skipped.length ? '#b42318' : undefined } }} /></Card></Col>
          </Row>

          <Card size="small" style={{ marginBottom: 12 }} title={tr('Steps')}>
            <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
              <li>{tr('Check the “Left out” list – add PAN / Aadhaar to donors where possible.')}</li>
              <li>
                {tr('Download the CSV and upload it in the Income-tax portal → Form 10BD (before 31 May {y}).', { y: dueYear })}{' '}
                <Button size="small" type="primary" icon={<DownloadOutlined />} disabled={!data.rows.length || !canExport} onClick={downloadCsv}>{tr('Form 10BD CSV')}</Button>
              </li>
              <li>
                {tr('After filing, enter the ARN and filing date here:')}
                <Space wrap style={{ marginLeft: 8 }}>
                  <Input size="small" style={{ width: 200 }} placeholder="ARN" value={filing.arn} onChange={(e) => setFiling({ ...filing, arn: e.target.value })} />
                  <Input size="small" type="date" style={{ width: 150 }} value={filing.date} onChange={(e) => setFiling({ ...filing, date: e.target.value })} />
                  <Button size="small" icon={<SaveOutlined />} loading={busy} disabled={!(can('settings.manage') || canExport)} onClick={saveFiling}>{tr('Save')}</Button>
                </Space>
              </li>
              <li>
                {tr('Give every donor the Form 10BE certificate.')}{' '}
                <Button size="small" icon={<FilePdfOutlined />} disabled={!data.rows.length} loading={busy} onClick={() => pdf10be(data.rows, null)}>{tr('All 10BE certificates (PDF)')}</Button>
              </li>
            </ol>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              {tr('Check the column order with the latest template on the Income-tax portal before uploading; your CA can confirm. The portal also issues official 10BE after filing.')}
            </Typography.Text>
          </Card>

          <Tabs
            items={[
              {
                key: 'rows',
                label: `${tr('Form 10BD rows')} (${data.rows.length})`,
                children: <Table size="small" rowKey={(r) => `${r.donorRef}|${r.uin}|${r.donationType}|${r.mode}`} columns={columns} dataSource={data.rows} pagination={{ pageSize: 50, showSizeChanger: false }} scroll={{ x: 900 }} />,
              },
              {
                key: 'skipped',
                label: <span>{tr('Left out')} {data.skipped.length ? <Tag color="red">{data.skipped.length}</Tag> : null}</span>,
                children: <Table size="small" rowKey="donationId" columns={skippedCols} dataSource={data.skipped} pagination={{ pageSize: 50, showSizeChanger: false }} scroll={{ x: 800 }} />,
              },
            ]}
          />
        </>
      ) : null}
    </Guard>
  );
}

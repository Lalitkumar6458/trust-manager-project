'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Card, Row, Col, InputNumber, Select, Button, Table, Typography, Statistic, Input, Alert, Space, DatePicker, Tag,
} from 'antd';
import { SaveOutlined, ClearOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Guard, PageHeader, Money } from '@/components/common';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { useAction, useLiveQuery } from '@/lib/hooks';
import { rpc } from '@/lib/api';
import { where, orderBy, limit } from '@/lib/q';
import { COL } from '@/lib/constants';
import { fmtDate, money, round2, todayStr } from '@/lib/format';
import { useLang } from '@/i18n/LangContext';

const DENOMS = [500, 200, 100, 50, 20, 10];

export default function CashCountPage() {
  const { t: tr } = useLang();
  const { can } = useAuth();
  const app = useAppData();
  const [run, busy] = useAction();
  const [accountId, setAccountId] = useState(null);
  const [notes, setNotes] = useState({});
  const [coins, setCoins] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [date, setDate] = useState(dayjs(todayStr()));
  useEffect(() => { if (!accountId && app.cashAccounts.length) setAccountId(app.cashAccounts[0].id); }, [app.cashAccounts, accountId]);
  const account = app.cashAccounts.find((a) => a.id === accountId);
  const total = useMemo(() => round2(DENOMS.reduce((s, d) => s + d * (Number(notes[d]) || 0), 0) + (Number(coins) || 0)), [notes, coins]);
  const system = round2(Number(account?.currentBalance) || 0);
  const diff = round2(total - system);
  const seeBalance = can('accounts.view');
  const { data: history } = useLiveQuery(accountId ? COL.cashCounts : null, [where('accountId', '==', accountId || '-'), orderBy('date', 'desc'), limit(30)], [accountId]);

  const clear = () => { setNotes({}); setCoins(null); setRemarks(''); };
  const save = () => run(async () => {
    await rpc('cash.count', { accountId, date: date.format('YYYY-MM-DD'), notes, coins, remarks });
    clear();
  }, 'Cash count saved');

  return (
    <Guard perm="cash.count">
      <PageHeader
        title={tr('Cash count (नोट गिनती)')}
        subtitle={tr('Count the notes in the cash box – the total is compared with the cash book balance.')}
        extra={[app.cashAccounts.length > 1 ? <Select key="a" style={{ width: 220 }} value={accountId} onChange={setAccountId} options={app.cashAccounts.map((a) => ({ value: a.id, label: a.name }))} /> : null]}
      />
      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card size="small" title={account?.name || tr('Cash account')} extra={<DatePicker value={date} onChange={(v) => setDate(v || dayjs())} format="DD-MM-YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />}>
            <Table
              size="small"
              pagination={false}
              rowKey="d"
              dataSource={DENOMS.map((d) => ({ d }))}
              columns={[
                { title: tr('Note'), dataIndex: 'd', render: (d) => <b>₹ {d}</b>, width: 90 },
                { title: tr('Count'), render: (_, r) => <InputNumber min={0} precision={0} value={notes[r.d] ?? null} onChange={(v) => setNotes({ ...notes, [r.d]: v })} style={{ width: '100%' }} placeholder="0" /> },
                { title: tr('Amount'), align: 'right', render: (_, r) => money(r.d * (Number(notes[r.d]) || 0)), width: 140 },
              ]}
              summary={() => (
                <>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}><b>{tr('Coins')}</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={1}><InputNumber min={0} precision={2} value={coins} onChange={setCoins} style={{ width: '100%' }} placeholder={tr('Total of all coins')} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">{money(Number(coins) || 0)}</Table.Summary.Cell>
                  </Table.Summary.Row>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={2}><b>{tr('Total counted')}</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right"><b style={{ fontSize: 16 }}>{money(total)}</b></Table.Summary.Cell>
                  </Table.Summary.Row>
                </>
              )}
            />
            <Input.TextArea rows={2} style={{ marginTop: 12 }} placeholder={tr('Remarks (e.g. who counted, reason for difference)')} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            <Space style={{ marginTop: 12 }}>
              <Button type="primary" icon={<SaveOutlined />} loading={busy} disabled={!accountId || total <= 0} onClick={save}>{tr('Save count')}</Button>
              <Button icon={<ClearOutlined />} onClick={clear}>{tr('Clear')}</Button>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          {seeBalance ? (
            <Card size="small" style={{ marginBottom: 12 }}>
              <Row gutter={12}>
                <Col span={8}><Statistic title={tr('Counted')} value={money(total)} /></Col>
                <Col span={8}><Statistic title={tr('As per cash book')} value={money(system)} /></Col>
                <Col span={8}><Statistic title={tr('Difference')} value={money(diff)} styles={{ content: { color: Math.abs(diff) < 0.01 ? '#237804' : '#a8071a' } }} /></Col>
              </Row>
              {total > 0 ? (
                Math.abs(diff) < 0.01
                  ? <Alert style={{ marginTop: 8 }} type="success" showIcon title={tr('Cash matches the cash book.')} />
                  : <Alert style={{ marginTop: 8 }} type="warning" showIcon title={diff > 0 ? tr('Extra cash – some receipt may not be entered yet.') : tr('Cash is short – check unentered expenses or pending deposits.')} />
              ) : null}
            </Card>
          ) : null}
          <Card size="small" title={tr('Previous counts')}>
            <Table
              size="small"
              rowKey="id"
              dataSource={history}
              pagination={false}
              columns={[
                { title: tr('Date'), dataIndex: 'date', render: fmtDate, width: 100 },
                { title: tr('Counted'), dataIndex: 'total', align: 'right', render: (v) => <Money value={v} /> },
                seeBalance ? { title: tr('Difference'), dataIndex: 'difference', align: 'right', render: (v) => (Math.abs(v) < 0.01 ? <Tag color="green">{tr('OK')}</Tag> : <Typography.Text type="danger">{money(v)}</Typography.Text>) } : null,
                { title: tr('By'), dataIndex: 'createdByName' },
              ].filter(Boolean)}
              expandable={{ expandedRowRender: (r) => <span>{Object.entries(r.notes || {}).map(([d, n]) => `₹${d}×${n}`).join('  ·  ')}{r.coins ? `  ·  ${tr('Coins')} ${money(r.coins)}` : ''}{r.remarks ? ` — ${r.remarks}` : ''}</span> }}
            />
          </Card>
        </Col>
      </Row>
    </Guard>
  );
}

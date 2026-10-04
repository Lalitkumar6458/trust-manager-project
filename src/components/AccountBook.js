'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Table, DatePicker, Space, Row, Col, Statistic, Tag, Typography, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { where } from 'firebase/firestore';
import { COL, TXN_TYPES } from '@/lib/constants';
import { fmtDate, round2, sum } from '@/lib/format';
import { useLiveQuery } from '@/lib/hooks';
import { useAppData } from '@/contexts/AppDataContext';
import { Money } from './common';
import ExportButtons from './ExportButtons';
import { withRunningBalance, fyOpeningFor } from '@/services/ledger';
import { ledgerExportCols } from '@/lib/exportCols';
import { defaultRange } from '@/lib/usePeriodList';
import { useYearStats } from '@/lib/useYearStats';
import { accountOpeningAtMonth } from '@/services/stats';
import { useLang } from '@/i18n/LangContext';

export const sourceLink = (t) => {
  if (t.sourceType === 'donation') return `/donations/${t.sourceId}`;
  if (t.sourceType === 'expense') return `/expenses/${t.sourceId}`;
  return null;
};

/** Bank book / cash book of one account for the selected FY with running balance */
export default function AccountBook({ account, title }) {
  const { t: tr } = useLang();
  const app = useAppData();
  const fy = app.selectedFy;
  // default: last 2 months. Lines are loaded from the 1st of the start month; that month's
  // opening comes from the year summary → no need to download the whole year.
  const [range, setRange] = useState(() => { const r = defaultRange(fy); return r.from ? [r.from, r.to] : null; });
  useEffect(() => { const r = defaultRange(fy); setRange(r.from ? [r.from, r.to] : null); }, [fy?.id]);
  const { stats, loading: statsLoading } = useYearStats(fy);
  const useStats = !!(range && stats);
  // wait for the summary before querying – otherwise the whole year would be downloaded first
  const qFrom = useStats ? `${range[0].slice(0, 7)}-01` : null;
  const { data: raw, loading } = useLiveQuery(
    account && fy && !(range && statsLoading) ? COL.transactions : null,
    useStats
      ? [where('accountId', '==', account?.id || '-'), where('date', '>=', qFrom), where('date', '<=', range[1])]
      : [where('financialYearId', '==', fy?.id || '-'), where('accountId', '==', account?.id || '-')],
    [fy?.id, account?.id, qFrom || '', useStats ? range[1] : ''],
  );
  const data = useMemo(() => raw.filter((t) => t.financialYearId === fy?.id), [raw, fy?.id]);

  const { rows, opening, periodOpening, closing } = useMemo(() => {
    const op = fy && account ? fyOpeningFor(fy, account) : 0;
    const startOp = useStats ? accountOpeningAtMonth({ fy, account, stats, monthKey: qFrom.slice(0, 7) }) : op;
    const all = withRunningBalance(data, startOp);
    if (!range) return { rows: all, opening: op, periodOpening: op, closing: all.length ? all[all.length - 1].balance : op };
    const [from, to] = range;
    const before = all.filter((t) => t.date < from);
    const pOpen = before.length ? before[before.length - 1].balance : startOp;
    const inRange = all.filter((t) => t.date >= from && t.date <= to);
    return { rows: inRange, opening: op, periodOpening: pOpen, closing: inRange.length ? inRange[inRange.length - 1].balance : pOpen };
  }, [data, fy, account, range, stats, useStats, qFrom]);

  const totalIn = sum(rows, (t) => t.credit);
  const totalOut = sum(rows, (t) => t.debit);
  const exportRows = [{ date: range ? range[0] : fy?.startDate, description: tr('Opening balance'), balance: periodOpening }, ...rows.map((r) => ({ ...r, type: tr(TXN_TYPES[r.type] || r.type) }))];

  return (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title={range ? tr('Opening (period)') : tr('Opening FY {v0}', { v0: fy?.id })} value={periodOpening} precision={2} prefix="₹" /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Total in (credit)')} value={totalIn} precision={2} prefix="₹" styles={{ content: { color: '#237804' } }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Total out (debit)')} value={totalOut} precision={2} prefix="₹" styles={{ content: { color: '#a8071a' } }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Closing balance')} value={closing} precision={2} prefix="₹" /></Card></Col>
      </Row>
      <Card
        title={title}
        extra={(
          <Space wrap>
            <DatePicker.RangePicker
              format="DD-MM-YYYY"
              value={range ? [dayjs(range[0]), dayjs(range[1])] : null}
              onChange={(r) => setRange(r ? [r[0].format('YYYY-MM-DD'), r[1].format('YYYY-MM-DD')] : null)}
              presets={[
                { label: tr('This month'), value: [dayjs().startOf('month'), dayjs()] },
                { label: tr('Last 3 months'), value: [dayjs().subtract(2, 'month').startOf('month'), dayjs()] },
                ...(fy ? [{ label: tr('Full financial year'), value: [dayjs(fy.startDate), dayjs(fy.endDate)] }] : []),
              ]}
            />
            <ExportButtons
              title={`${title} – FY ${fy?.id}`}
              subtitle={range ? `${fmtDate(range[0])} to ${fmtDate(range[1])}` : `${fmtDate(fy?.startDate)} to ${fmtDate(fy?.endDate)}`}
              columns={ledgerExportCols}
              rows={exportRows}
              totals={{ description: tr('Total / Closing'), credit: totalIn, debit: totalOut, balance: closing }}
            />
          </Space>
        )}
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 900 }}
          pagination={{ defaultPageSize: 50, showSizeChanger: true }}
          rowClassName={(r) => (r.status === 'reversed' ? 'muted' : '')}
          columns={[
            { title: tr('Date'), dataIndex: 'date', render: fmtDate, width: 100 },
            { title: tr('Type'), dataIndex: 'type', width: 130, render: (t, r) => <Tag color={r.status === 'reversed' ? 'red' : t === 'reversal' ? 'volcano' : 'default'}>{tr(TXN_TYPES[t] || t)}</Tag> },
            { title: tr('Reference'), dataIndex: 'reference', width: 150, render: (v, r) => (sourceLink(r) ? <Link href={sourceLink(r)}>{v}</Link> : v) },
            { title: tr('Party'), dataIndex: 'partyName', ellipsis: true },
            { title: tr('Description'), dataIndex: 'description', ellipsis: true, render: (v, r) => <Tooltip title={[v, r.utr && tr('UTR {v0}', { v0: r.utr }), r.chequeNo && tr('Chq {v0}', { v0: r.chequeNo })].filter(Boolean).join(' · ')}>{v}</Tooltip> },
            { title: tr('Credit (In)'), dataIndex: 'credit', align: 'right', width: 120, render: (v) => (v ? <Money value={v} type="in" /> : '') },
            { title: tr('Debit (Out)'), dataIndex: 'debit', align: 'right', width: 120, render: (v) => (v ? <Money value={v} type="out" /> : '') },
            { title: tr('Balance'), dataIndex: 'balance', align: 'right', width: 130, render: (v) => <Money value={v} strong /> },
            { title: tr('Recon.'), dataIndex: 'reconciled', width: 70, align: 'center', render: (v) => (account?.type === 'bank' ? (v ? '✓' : '') : ''), responsive: ['lg'] },
          ]}
          summary={() => (
            <Table.Summary.Row className="table-summary">
              <Table.Summary.Cell index={0} colSpan={5}><Typography.Text strong>{tr('Opening')}{' '}{round2(periodOpening).toLocaleString('en-IN')} {tr('+ In − Out = Closing')}</Typography.Text></Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right"><Money value={totalIn} type="in" strong /></Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right"><Money value={totalOut} type="out" strong /></Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right"><Money value={closing} strong /></Table.Summary.Cell>
              <Table.Summary.Cell index={8} />
            </Table.Summary.Row>
          )}
        />
        {fy && account && fy.id === app.currentFy?.id && Math.abs(closing - (account.currentBalance || 0)) > 0.009 && !range ? (
          <Typography.Text type="warning">Note: account current balance (₹{account.currentBalance}) includes entries of other financial years.</Typography.Text>
        ) : null}
        <div className="muted" style={{ fontSize: 12 }}>{tr('Opening of FY: ₹')}{round2(opening).toLocaleString('en-IN')}</div>
      </Card>
    </>
  );
}

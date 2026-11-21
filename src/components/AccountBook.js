'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Table, DatePicker, Space, Row, Col, Statistic, Tag, Typography, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { where } from '@/lib/q';
import { COL, TXN_TYPES } from '@/lib/constants';
import { fmtDate, round2 } from '@/lib/format';
import { useAppData } from '@/contexts/AppDataContext';
import { Money } from './common';
import ExportButtons from './ExportButtons';
import ServerPager, { ServerError } from './ServerPager';
import { fyOpeningFor } from '@/services/ledger';
import { ledgerExportCols } from '@/lib/exportCols';
import { defaultRange } from '@/lib/usePeriodList';
import { useServerTable, useAsyncValue } from '@/lib/useServerTable';
import { useBookBalance, balanceBefore, bookOrder } from '@/lib/useBookBalance';
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
  // default: previous + current month. Only 100 lines per page are downloaded; opening / totals /
  // closing are server-side sums, so the book stays fast with any number of entries.
  const [range, setRange] = useState(() => { const r = defaultRange(fy); return r.from ? [r.from, r.to] : null; });
  useEffect(() => { const r = defaultRange(fy); setRange(r.from ? [r.from, r.to] : null); }, [fy?.id]);
  const cons = [where('financialYearId', '==', fy?.id || '-'), where('accountId', '==', account?.id || '-')];
  if (range) cons.push(where('date', '>=', range[0]), where('date', '<=', range[1]));
  const key = JSON.stringify([fy?.id, account?.id, range]);
  const table = useServerTable(COL.transactions, cons, { order: bookOrder('asc'), key, enabled: !!(fy && account) });
  const rows = useBookBalance(table, { fy, account, enabled: !!(fy && account), dir: 'asc' });
  const opening = fy && account ? fyOpeningFor(fy, account) : 0;
  const summary = useAsyncValue(async () => {
    if (!fy || !account) return null;
    const [pOpen, t] = await Promise.all([balanceBefore(fy, account, range?.[0]), table.sumOf(['credit', 'debit'])]);
    return { periodOpening: pOpen, totalIn: round2(t.credit || 0), totalOut: round2(t.debit || 0) };
  }, [key, table.rows], null);
  const periodOpening = summary?.periodOpening ?? opening;
  const totalIn = summary?.totalIn || 0;
  const totalOut = summary?.totalOut || 0;
  const closing = round2(periodOpening + totalIn - totalOut);
  // Export / Print: every line of the period with its running balance
  const getExportRows = async () => {
    const all = await table.fetchAll();
    let bal = periodOpening;
    const lines = all.map((r) => { bal = round2(bal + (r.credit || 0) - (r.debit || 0)); return { ...r, balance: bal, type: tr(TXN_TYPES[r.type] || r.type) }; });
    return [{ id: 'opening', date: range ? range[0] : fy?.startDate, description: tr('Opening balance'), balance: periodOpening }, ...lines];
  };

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
              rows={[]}
              getRows={getExportRows}
              count={table.total === null ? null : table.total + 1}
              totals={{ description: tr('Total / Closing'), credit: totalIn, debit: totalOut, balance: closing }}
            />
          </Space>
        )}
      >
        <ServerError table={table} />
        <Table
          rowKey="id"
          size="small"
          loading={table.loading}
          dataSource={rows}
          scroll={{ x: 900 }}
          pagination={false}
          footer={() => <ServerPager table={table} />}
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

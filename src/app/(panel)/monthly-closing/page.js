'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Table, Button, Tag, Space, Modal, Input, Alert, Typography } from 'antd';
import { LockOutlined, UnlockOutlined, FileSearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { where } from 'firebase/firestore';
import { COL } from '@/lib/constants';
import { fyMonths, fmtDateTime, round2 } from '@/lib/format';
import { useLiveQuery, useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Guard, Money, useReasonPrompt } from '@/components/common';
import { periodSummary } from '@/services/accounting';
import { closeMonth, reopenMonth } from '@/services/closing';
import { useYearStats } from '@/lib/useYearStats';
import { seriesFromStats } from '@/services/stats';
import { useLang } from '@/i18n/LangContext';

export default function MonthlyClosingPage() {
  const { t: tr, lang } = useLang();
  const { can, user } = useAuth();
  const app = useAppData();
  const fy = app.selectedFy;
  const [run, busy] = useAction();
  const [ask, reasonModal] = useReasonPrompt();
  const [notes, setNotes] = useState('');
  const [closing, setClosing] = useState(null);
  // month figures come from the year summary document (no download of every entry)
  const { stats, loading } = useYearStats(fy);

  const rows = useMemo(() => {
    if (!fy) return [];
    const ser = seriesFromStats({ fy, accounts: app.accounts, stats });
    return ser.months.map((x) => {
      const m = x.monthKey;
      const c = app.closings[m];
      const from = `${m}-01`;
      return {
        monthKey: m,
        label: dayjs(from).format('MMMM YYYY'),
        closed: c?.status === 'closed',
        c,
        opening: x.openingTotal,
        donation: x.donation,
        expense: x.expense,
        other: round2(x.otherIncome + x.adjustment),
        bank: x.closingBank,
        cash: x.closingCash,
        closingTotal: x.closingTotal,
        frozenTotal: c?.closingTotal,
        future: dayjs(from).isAfter(dayjs(), 'month'),
      };
    });
  }, [fy, app.closings, app.accounts, stats, lang]);

  const firstOpen = rows.find((r) => !r.closed);
  const lastClosed = [...rows].reverse().find((r) => r.closed);

  const doClose = async () => {
    const ok = await run(() => closeMonth({ monthKey: closing.monthKey, fy, accounts: app.accounts, user, notes }), `${closing.label} closed`);
    if (ok) { setClosing(null); setNotes(''); }
  };

  return (
    <Guard perm="closing.view">
      <PageHeader title={tr('Monthly Closing')} subtitle={tr('FY {v0} · Once a month is closed, normal users cannot add or change entries dated in that month.', { v0: fy?.id })} />
      {!fy ? <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tr('Create a financial year first (Financial Year menu).')} /> : null}
      {fy && fy.status !== 'open' ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tr('FY {v0} is {v1}.', { v0: fy.id, v1: tr(fy.status === 'finalized' ? 'Finalized' : 'Closed') })} /> : null}
      <Card>
        <Table
          rowKey="monthKey"
          loading={loading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 1100 }}
          columns={[
            { title: tr('Month'), dataIndex: 'label', render: (v) => <b>{v}</b>, width: 140, fixed: 'left' },
            { title: tr('Status'), width: 110, render: (_, r) => (r.closed ? <Tag icon={<LockOutlined />} color="orange">{tr('Closed')}</Tag> : r.future ? <Tag>{tr('Future')}</Tag> : <Tag color="blue">{tr('Open')}</Tag>) },
            { title: tr('Opening'), dataIndex: 'opening', align: 'right', render: (v) => <Money value={v} /> },
            { title: tr('Donation'), dataIndex: 'donation', align: 'right', render: (v) => <Money value={v} type="in" /> },
            { title: tr('Other / adj.'), dataIndex: 'other', align: 'right', render: (v) => <Money value={v} /> },
            { title: tr('Expense'), dataIndex: 'expense', align: 'right', render: (v) => <Money value={v} type="out" /> },
            { title: tr('Bank bal.'), dataIndex: 'bank', align: 'right', render: (v) => <Money value={v} /> },
            { title: tr('Cash bal.'), dataIndex: 'cash', align: 'right', render: (v) => <Money value={v} /> },
            {
              title: tr('Closing'), dataIndex: 'closingTotal', align: 'right',
              render: (v, r) => (
                <span>
                  <Money value={v} strong />
                  {r.closed && Math.abs((r.frozenTotal ?? v) - v) > 0.009 ? <div><Tag color="red">{tr('Frozen: ₹')}{r.frozenTotal}</Tag></div> : null}
                </span>
              ),
            },
            { title: tr('Closed by'), width: 150, render: (_, r) => (r.c?.status === 'closed' ? <span style={{ fontSize: 12 }}>{r.c.closedByName}<br />{fmtDateTime(r.c.closedAt)}</span> : r.c?.reopenedByName ? <span style={{ fontSize: 12 }} className="muted">{tr('Reopened by')}{' '}{r.c.reopenedByName}</span> : '') },
            {
              title: '', width: 200,
              render: (_, r) => (
                <Space>
                  <Link href={`/reports/monthly-financial?month=${r.monthKey}`} title={tr('Monthly report')}><Button size="small" icon={<FileSearchOutlined />} /></Link>
                  {!r.closed && !r.future && r.monthKey === firstOpen?.monthKey && can('closing.close') && fy?.status === 'open' ? (
                    <Button size="small" type="primary" icon={<LockOutlined />} onClick={() => setClosing(r)}>{tr('Close month')}</Button>
                  ) : null}
                  {r.closed && r.monthKey === lastClosed?.monthKey && can('closing.reopen') && fy?.status === 'open' ? (
                    <Button size="small" icon={<UnlockOutlined />} loading={busy} onClick={async () => { const reason = await ask(tr('Reopen {v0}?', { v0: r.label }), { okText: tr('Reopen') }); if (reason) run(() => reopenMonth({ monthKey: r.monthKey, fy, user, reason }), 'Month reopened'); }}>{tr('Reopen')}</Button>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
          {tr('Months are closed in sequence. Closing requires that no donation / expense dated in the month is still pending (draft, submitted, verified or approved-but-unpaid). Only the Super Admin can reopen a month (with reason – recorded in the audit trail).')}
        </Typography.Paragraph>
      </Card>
      <Modal open={!!closing} onCancel={() => setClosing(null)} title={tr('Close {v0}?', { v0: closing?.label })} onOk={doClose} okText={tr('Close month')} confirmLoading={busy}>
        {closing ? (
          <>
            <Table
              size="small"
              pagination={false}
              showHeader={false}
              rowKey="k"
              dataSource={[
                { k: tr('Opening balance'), v: closing.opening },
                { k: tr('Donation total'), v: closing.donation },
                { k: tr('Other income / adjustments'), v: closing.other },
                { k: tr('Expense total'), v: closing.expense },
                { k: tr('Bank balance'), v: closing.bank },
                { k: tr('Cash balance'), v: closing.cash },
                { k: tr('Closing balance'), v: closing.closingTotal },
              ]}
              columns={[{ dataIndex: 'k' }, { dataIndex: 'v', align: 'right', render: (v) => <Money value={v} /> }]}
            />
            <Input.TextArea style={{ marginTop: 12 }} rows={2} placeholder={tr('Notes (optional) – e.g. cash physically counted')} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </>
        ) : null}
      </Modal>
      {reasonModal}
    </Guard>
  );
}

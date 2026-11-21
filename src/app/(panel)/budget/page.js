'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, Table, InputNumber, Button, Progress, Tabs, Typography, Row, Col, Statistic, Alert, Space } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Guard, PageHeader, Money } from '@/components/common';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { useAction, useLiveDoc } from '@/lib/hooks';
import { useYearStats } from '@/lib/useYearStats';
import { rpc } from '@/lib/api';
import { COL } from '@/lib/constants';
import { money0, round2, fyRange, todayStr } from '@/lib/format';
import { useLang } from '@/i18n/LangContext';

function BudgetTable({ kind, cats, actualMap, values, setValues, editable, elapsed }) {
  const { t: tr, pick } = useLang();
  const rows = cats.map((c) => {
    const budget = Number(values[c.id]) || 0;
    const actual = round2(Number(actualMap?.[c.id]) || 0);
    return { id: c.id, name: pick(c.name, c.nameHi), budget, actual, pct: budget ? Math.round((actual / budget) * 100) : null, expected: round2(budget * elapsed) };
  });
  const tot = rows.reduce((s, r) => ({ budget: s.budget + r.budget, actual: s.actual + r.actual }), { budget: 0, actual: 0 });
  const isExp = kind === 'expense';
  return (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={rows}
      columns={[
        { title: tr('Head'), dataIndex: 'name' },
        {
          title: tr('Budget (year)'), dataIndex: 'budget', width: 170, align: 'right',
          render: (v, r) => (editable ? <InputNumber min={0} step={1000} value={values[r.id] ?? null} onChange={(x) => setValues({ ...values, [r.id]: x })} style={{ width: '100%' }} placeholder="0" /> : <Money value={v} />),
        },
        { title: tr('Actual'), dataIndex: 'actual', align: 'right', width: 130, render: (v) => <Money value={v} /> },
        { title: tr('Difference'), align: 'right', width: 130, render: (_, r) => (r.budget ? <Typography.Text type={(isExp ? r.actual > r.budget : r.actual < r.expected) ? 'danger' : 'success'}>{money0(round2(r.budget - r.actual))}</Typography.Text> : '—') },
        {
          title: isExp ? tr('Used') : tr('Achieved'), width: 200,
          render: (_, r) => (r.pct === null ? '—' : <Progress percent={Math.min(r.pct, 100)} format={() => `${r.pct}%`} size="small" status={isExp ? (r.pct > 100 ? 'exception' : r.pct > elapsed * 100 + 10 ? 'active' : 'normal') : (r.pct >= 100 ? 'success' : 'normal')} strokeColor={isExp && r.pct > 100 ? '#a8071a' : undefined} />),
        },
      ]}
      summary={() => (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0}><b>{tr('Total')}</b></Table.Summary.Cell>
          <Table.Summary.Cell index={1} align="right"><b><Money value={tot.budget} /></b></Table.Summary.Cell>
          <Table.Summary.Cell index={2} align="right"><b><Money value={tot.actual} /></b></Table.Summary.Cell>
          <Table.Summary.Cell index={3} align="right"><b>{tot.budget ? money0(round2(tot.budget - tot.actual)) : '—'}</b></Table.Summary.Cell>
          <Table.Summary.Cell index={4}>{tot.budget ? `${Math.round((tot.actual / tot.budget) * 100)}%` : ''}</Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  );
}

export default function BudgetPage() {
  const { t: tr } = useLang();
  const { can } = useAuth();
  const app = useAppData();
  const fy = app.selectedFy;
  const [run, busy] = useAction();
  const { stats } = useYearStats(fy);
  const { data: saved } = useLiveDoc(fy?.id ? COL.budgets : null, fy?.id || null);
  const [income, setIncome] = useState({});
  const [expense, setExpense] = useState({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) { setIncome(saved?.income || {}); setExpense(saved?.expense || {}); } }, [saved, dirty]);
  const editable = can('budget.manage') && fy?.status !== 'closed';
  const elapsed = useMemo(() => {
    if (!fy) return 0;
    const { start, end } = fyRange(fy.id);
    const t = todayStr();
    if (t <= start) return 0;
    if (t >= end) return 1;
    return dayjs(t).diff(start, 'day') / (dayjs(end).diff(start, 'day') + 1);
  }, [fy]);
  const save = () => run(async () => { await rpc('budget.save', fy.id, { income, expense }); setDirty(false); }, 'Budget saved');
  const totals = (m) => Object.values(m || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const actualIn = totals(stats?.cd);
  const actualOut = totals(stats?.ce);

  return (
    <Guard perm="budget.view">
      <PageHeader
        title={tr('Budget vs actual')}
        subtitle={tr('FY {v0} · {v1}% of the year passed', { v0: fy?.id || '', v1: Math.round(elapsed * 100) })}
        extra={[editable ? <Button key="s" type="primary" icon={<SaveOutlined />} loading={busy} disabled={!dirty} onClick={save}>{tr('Save budget')}</Button> : null]}
      />
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Income budget')} value={money0(totals(income))} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Donation received')} value={money0(actualIn)} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Expense budget')} value={money0(totals(expense))} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Spent')} value={money0(actualOut)} styles={{ content: { color: totals(expense) && actualOut > totals(expense) ? '#a8071a' : undefined } }} /></Card></Col>
      </Row>
      {!stats ? <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tr('Actual figures come from the year summary – open the Dashboard once if they show 0.')} /> : null}
      <Card size="small">
        <Tabs
          items={[
            { key: 'e', label: tr('Expense heads'), children: <BudgetTable kind="expense" cats={app.expenseCategories} actualMap={stats?.ce} values={expense} setValues={(v) => { setExpense(v); setDirty(true); }} editable={editable} elapsed={elapsed} /> },
            { key: 'i', label: tr('Donation heads'), children: <BudgetTable kind="income" cats={app.donationCategories} actualMap={stats?.cd} values={income} setValues={(v) => { setIncome(v); setDirty(true); }} editable={editable} elapsed={elapsed} /> },
          ]}
        />
        <Space style={{ marginTop: 8 }}><Typography.Text type="secondary" style={{ fontSize: 12 }}>{tr('Red = spent more than budget (or income behind schedule).')}</Typography.Text></Space>
      </Card>
    </Guard>
  );
}

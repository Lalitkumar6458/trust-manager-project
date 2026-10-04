'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Col, Row, Statistic, Table, Tag, Typography, List, Empty, Alert } from 'antd';
import {
  GiftOutlined, WalletOutlined, BankOutlined, DollarOutlined, FundOutlined, ClockCircleOutlined, TeamOutlined, FileDoneOutlined,
} from '@ant-design/icons';
import { where, orderBy, limit, getCountFromServer, getAggregateFromServer, query, collection, sum as fsSum } from 'firebase/firestore';
import dayjs from 'dayjs';
import { db } from '@/lib/firebase';
import { COL } from '@/lib/constants';
import { fmtDate, money0, sum } from '@/lib/format';
import { useLiveQuery } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Money, StatusTag, Guard } from '@/components/common';
import { DonationExpenseChart, MonthlyBar, CategoryBars, BalanceTrend, SERIES } from '@/components/Charts';
import { seriesFromStats } from '@/services/stats';
import { useYearStats } from '@/lib/useYearStats';
import { useLang } from '@/i18n/LangContext';

function Kpi({ title, value, icon, color, sub, href }) {
  const { t: tr, pick } = useLang();
  const body = (
    <Card className="stat-card" size="small" hoverable={!!href} style={{ height: '100%' }}>
      <Statistic title={<span>{icon} {title}</span>} value={value} styles={{ content: { color, fontSize: 22 } }} />
      {sub ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{sub}</Typography.Text> : null}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function DashboardPage() {
  const { t: tr, pick, lang } = useLang();
  const { can } = useAuth();
  const app = useAppData();
  const fy = app.selectedFy;
  const showMoney = can('accounts.view');
  // ONE summary document instead of every entry of the year (fast with thousands of entries)
  const { stats, loading: statsLoading, missing, canBuild } = useYearStats(fy);
  // only the open items and the last 8 donations are downloaded
  const { data: pendDons } = useLiveQuery(COL.donations, [where('status', 'in', ['submitted', 'verified']), limit(50)], []);
  const { data: pendExps } = useLiveQuery(COL.expenses, [where('status', 'in', ['submitted', 'approved']), limit(50)], []);
  const { data: recent } = useLiveQuery(fy ? COL.donations : null, [where('financialYearId', '==', fy?.id || '-'), orderBy('createdAt', 'desc'), limit(8)], [fy?.id]);
  const [agg, setAgg] = useState({});

  useEffect(() => {
    if (!fy) return;
    (async () => {
      const out = {};
      const tryIt = async (k, fn) => { try { out[k] = await fn(); } catch { /* index still building / no access */ } };
      await Promise.all([
        tryIt('donors', async () => (await getCountFromServer(collection(db, COL.donors))).data().count),
        tryIt('donAll', async () => (await getAggregateFromServer(query(collection(db, COL.donations), where('status', '==', 'approved')), { total: fsSum('amount') })).data().total || 0),
        tryIt('expAll', async () => (await getAggregateFromServer(query(collection(db, COL.expenses), where('status', '==', 'paid')), { total: fsSum('amount') })).data().total || 0),
        tryIt('fyCount', async () => (await getCountFromServer(query(collection(db, COL.donations), where('financialYearId', '==', fy.id)))).data().count),
        tryIt('fyVoid', async () => (await getCountFromServer(query(collection(db, COL.donations), where('financialYearId', '==', fy.id), where('status', '==', 'void')))).data().count),
      ]);
      setAgg(out);
    })();
  }, [fy, stats?.updatedAt?.seconds]);

  const s = useMemo(() => (fy ? seriesFromStats({ fy, accounts: app.accounts, stats }) : null), [fy, app.accounts, stats]);
  const series = useMemo(() => (s ? s.months.map((r) => ({ ...r, label: dayjs(`${r.monthKey}-01`).format('MMM YY') })) : []), [s, lang]);
  const summary = showMoney && s ? s : null;
  const catBars = (map, cats) => Object.entries(map || {})
    .map(([id, amount]) => { const c = cats.find((x) => x.id === id); return { key: c ? pick(c.name, c.nameHi) : id, amount: Number(amount) || 0 }; })
    .filter((x) => Math.abs(x.amount) > 0.001)
    .sort((a, b) => b.amount - a.amount);
  const donCats = useMemo(() => catBars(stats?.cd, app.donationCategories), [stats, app.donationCategories, pick]);
  const expCats = useMemo(() => catBars(stats?.ce, app.expenseCategories), [stats, app.expenseCategories, pick]);
  const bankBal = sum(app.bankAccounts.filter((a) => a.status !== 'inactive'), (a) => a.currentBalance);
  const cashBal = sum(app.cashAccounts.filter((a) => a.status !== 'inactive'), (a) => a.currentBalance);
  const pendingDon = pendDons;
  const pendingExp = pendExps;
  const plus = (list) => (list.length >= 50 ? '50+' : list.length);

  return (
    <Guard perm="dashboard.view">
      <PageHeader title={tr('Dashboard')} subtitle={tr('{v0} · Financial overview for FY {v1}', { v0: app.settings.name, v1: fy?.id || '' })} />
      {statsLoading && !stats ? <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tr('Preparing the year summary (one time only)…')} /> : null}
      {missing && !canBuild ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tr('The year summary is not prepared yet. It is created automatically when the Accountant / Super Admin opens the dashboard.')} /> : null}
      {!app.accounts.length ? <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tr('Start by adding your bank accounts (Bank Accounts menu) and checking categories in Settings.')} /> : null}
      <Row gutter={[12, 12]}>
        <Col xs={12} md={8} xl={6}><Kpi title={tr('Total donation received')} icon={<GiftOutlined />} value={money0(agg.donAll)} color={SERIES.donation} sub={tr('All years (approved)')} href="/donations" /></Col>
        <Col xs={12} md={8} xl={6}><Kpi title={tr('Total expense')} icon={<WalletOutlined />} value={money0(agg.expAll)} color={SERIES.expense} sub={tr('All years (paid)')} href="/expenses" /></Col>
        {showMoney ? (
          <>
            <Col xs={12} md={8} xl={6}><Kpi title={tr('Current bank balance')} icon={<BankOutlined />} value={money0(bankBal)} sub={tr('{v0} account(s)', { v0: app.bankAccounts.length })} href="/bank-accounts" /></Col>
            <Col xs={12} md={8} xl={6}><Kpi title={tr('Current cash balance')} icon={<DollarOutlined />} value={money0(cashBal)} href="/cash-book" /></Col>
            <Col xs={12} md={8} xl={6}><Kpi title={tr('Total available balance')} icon={<FundOutlined />} value={money0(bankBal + cashBal)} sub={tr('Bank + cash')} color="#237804" /></Col>
          </>
        ) : null}
        <Col xs={12} md={8} xl={6}><Kpi title={tr('FY {v0} donation', { v0: fy?.id })} icon={<GiftOutlined />} value={money0(s?.totals.donation)} sub={tr('{n} donations', { n: s?.donationCount ?? 0 })} /></Col>
        <Col xs={12} md={8} xl={6}><Kpi title={tr('FY {v0} expense', { v0: fy?.id })} icon={<WalletOutlined />} value={money0(s?.totals.expense)} sub={tr('{n} payments', { n: s?.expenseCount ?? 0 })} /></Col>
        <Col xs={12} md={8} xl={6}><Kpi title={tr('Pending verification / approval')} icon={<ClockCircleOutlined />} value={pendingDon.length + pendingExp.length} color={pendingDon.length + pendingExp.length ? '#d46b08' : undefined} sub={tr('{v0} donation · {v1} expense', { v0: plus(pendingDon), v1: plus(pendingExp) })} /></Col>
        <Col xs={12} md={8} xl={6}><Kpi title={tr('Number of donors')} icon={<TeamOutlined />} value={agg.donors ?? '—'} href="/donors" /></Col>
        <Col xs={12} md={8} xl={6}><Kpi title={tr('Number of donations')} icon={<FileDoneOutlined />} value={agg.fyCount !== undefined ? agg.fyCount - (agg.fyVoid || 0) : '—'} sub={tr('FY {v0} (all statuses)', { v0: fy?.id })} /></Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} xl={16}>
          <Card title={tr('Donation vs expense – monthly')} size="small"><DonationExpenseChart data={series} /></Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title={tr('Pending actions')} size="small" styles={{ body: { maxHeight: 300, overflow: 'auto' } }}>
            {pendingDon.length + pendingExp.length ? (
              <List
                size="small"
                dataSource={[...pendingDon.map((d) => ({ ...d, kind: 'D' })), ...pendingExp.map((e) => ({ ...e, kind: 'E' }))]}
                renderItem={(r) => (
                  <List.Item>
                    <Link href={r.kind === 'D' ? `/donations/${r.id}` : `/expenses/${r.id}`}>
                      <Tag color={r.kind === 'D' ? 'blue' : 'orange'}>{r.kind === 'D' ? tr('Donation') : tr('Expense')}</Tag>
                      {r.receiptNo || r.voucherNo} – {r.donor?.name || r.payee?.name}
                    </Link>
                    <span><Money value={r.amount} /> <StatusTag status={r.status} /></span>
                  </List.Item>
                )}
              />
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tr('Nothing pending')} />}
          </Card>
        </Col>
        <Col xs={24} md={12}><Card title={tr('Monthly donation')} size="small"><MonthlyBar data={series} dataKey="donation" name={tr('Donation')} color={SERIES.donation} /></Card></Col>
        <Col xs={24} md={12}><Card title={tr('Monthly expense')} size="small"><MonthlyBar data={series} dataKey="expense" name={tr('Expense')} color={SERIES.expense} /></Card></Col>
        <Col xs={24} md={12}><Card title={tr('Category-wise donation')} size="small">{donCats.length ? <CategoryBars data={donCats} color={SERIES.donation} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}</Card></Col>
        <Col xs={24} md={12}><Card title={tr('Category-wise expense')} size="small">{expCats.length ? <CategoryBars data={expCats} color={SERIES.expense} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}</Card></Col>
        {showMoney ? (
          <>
            <Col xs={24} md={12}><Card title={tr('Bank balance trend (month end)')} size="small"><BalanceTrend data={series} series={[{ key: 'bankBalance', name: tr('Bank'), color: SERIES.donation }]} /></Card></Col>
            <Col xs={24} md={12}><Card title={tr('Cash balance trend (month end)')} size="small"><BalanceTrend data={series} series={[{ key: 'cashBalance', name: tr('Cash'), color: SERIES.cash }]} /></Card></Col>
          </>
        ) : null}
        {summary ? (
          <Col xs={24} md={12}>
            <Card title={tr('Available balance – FY {v0}', { v0: fy?.id })} size="small">
              <Table
                size="small"
                pagination={false}
                rowKey="k"
                showHeader={false}
                dataSource={[
                  { k: tr('Opening balance'), v: summary.openingTotal },
                  { k: tr('+ Donations'), v: summary.totals.donation },
                  { k: tr('+ Other income (interest etc.)'), v: summary.totals.otherIncome },
                  { k: tr('− Expenses'), v: summary.totals.expense },
                  { k: tr('− Bank charges'), v: summary.totals.bankCharges },
                  { k: tr('± Adjustments'), v: summary.totals.adjustment },
                  { k: tr('= Available balance'), v: summary.closingTotal, b: true },
                ]}
                columns={[{ dataIndex: 'k', render: (v, r) => (r.b ? <b>{v}</b> : v) }, { dataIndex: 'v', align: 'right', render: (v, r) => <Money value={v} strong={r.b} /> }]}
              />
            </Card>
          </Col>
        ) : null}
        <Col xs={24} md={summary ? 12 : 24}>
          <Card title={tr('Recent donations')} size="small" extra={<Link href="/donations">{tr('View all')}</Link>}>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={recent}
              columns={[
                { title: tr('Date'), dataIndex: 'date', render: fmtDate, width: 95 },
                { title: tr('Donor'), render: (_, r) => <Link href={`/donations/${r.id}`}>{r.donor?.name}</Link> },
                { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> },
                { title: tr('Status'), dataIndex: 'status', render: (s) => <StatusTag status={s} /> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Guard>
  );
}

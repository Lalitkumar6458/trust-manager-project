'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Card, Table, Result, Spin, Select, DatePicker, Space, Row, Col, Statistic, Alert, Button, InputNumber, Typography,
} from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { where, orderBy, limit, Timestamp } from 'firebase/firestore';
import { COL, PAYMENT_MODES, STATUS_META, DOC_TYPES, PAYEE_TYPES } from '@/lib/constants';
import { fmtDate, fyRange, round2 } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Guard, Money } from '@/components/common';
import ExportButtons from '@/components/ExportButtons';
import PartySelect from '@/components/PartySelect';
import { applyFilters } from '@/components/FilterBar';
import { fetchAll } from '@/services/db';
import { reportByKey } from '@/reports/definitions';
import { useLang } from '@/i18n/LangContext';

/** ledger-based statements also need prior-year items voided / paid inside this year */
async function crossYear(coll, fields, start, end, base) {
  const extra = await Promise.all(fields.map((f) => fetchAll(coll, where(f, '>=', start), where(f, '<=', end))));
  const seen = new Set(base.map((x) => x.id));
  return [...base, ...extra.flat().filter((x) => !seen.has(x.id) && seen.add(x.id))];
}

async function loadData(report, fyId, filters) {
  const out = {};
  const fyWhere = report.allYears ? [] : [where('financialYearId', '==', fyId)];
  const { start, end } = fyRange(fyId);
  const cross = report.rawStatus && !report.allYears;
  const jobs = report.needs.map(async (n) => {
    if (n === 'donations') {
      out.donations = await fetchAll(COL.donations, ...fyWhere);
      if (cross) out.donations = await crossYear(COL.donations, ['voidDate'], start, end, out.donations);
    }
    if (n === 'expenses') {
      out.expenses = await fetchAll(COL.expenses, ...fyWhere);
      if (cross) out.expenses = await crossYear(COL.expenses, ['voidDate', 'paidDate'], start, end, out.expenses);
    }
    if (n === 'txns') out.txns = await fetchAll(COL.transactions, where('financialYearId', '==', fyId));
    if (n === 'donors') out.donors = await fetchAll(COL.donors);
    if (n === 'payees') out.payees = await fetchAll(COL.beneficiaries);
    if (n === 'documents') out.documents = await fetchAll(COL.documents, where('financialYearId', '==', fyId));
    if (n === 'statements') out.statements = await fetchAll(COL.bankStatements, where('financialYearId', '==', fyId));
    if (n === 'auditLogs') {
      const from = Timestamp.fromDate(dayjs(filters.from).startOf('day').toDate());
      const to = Timestamp.fromDate(dayjs(filters.to).endOf('day').toDate());
      out.auditLogs = await fetchAll(COL.auditLogs, where('at', '>=', from), where('at', '<=', to), orderBy('at', 'desc'), limit(5000));
    }
  });
  await Promise.all(jobs);
  return out;
}

const toAntCols = (cols, tr) => cols.map((c) => ({
  title: tr(c.title),
  key: c.key,
  align: c.money ? 'right' : undefined,
  ellipsis: (c.width || 1) >= 2,
  render: (_, r) => {
    const v = c.value ? c.value(r) : r[c.key];
    if (c.money) return v === null || v === undefined || v === '' ? '' : <Money value={v} />;
    return v;
  },
}));

export default function ReportViewer() {
  const { t: tr, pick } = useLang();
  const { key } = useParams();
  const report = reportByKey(key);
  const { user } = useAuth();
  const app = useAppData();
  const fy = app.selectedFy;
  const [filters, setFilters] = useState({});
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  // reset filters when FY or report changes
  useEffect(() => {
    if (!fy) return;
    const today = dayjs().format('YYYY-MM-DD');
    setFilters({
      from: fy.startDate,
      to: fy.endDate < today ? fy.endDate : (fy.startDate > today ? fy.endDate : today),
      status: 'final',
      // ?month=YYYY-MM (e.g. from Monthly Closing) wins over "this month"
      month: (() => {
        const q = new URLSearchParams(window.location.search).get('month');
        if (q && /^\d{4}-\d{2}$/.test(q) && q >= fy.startDate.slice(0, 7) && q <= fy.endDate.slice(0, 7)) return q;
        return dayjs(today).isBefore(fy.startDate) || dayjs(today).isAfter(fy.endDate) ? fy.startDate.slice(0, 7) : today.slice(0, 7);
      })(),
    });
    // only when the YEAR (not any field of the FY doc) or the report changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fy?.id, key]);

  useEffect(() => {
    if (!report || !fy || !filters.from) return;
    let alive = true;
    setLoading(true);
    setError(null);
    loadData(report, fy.id, filters)
      .then((d) => { if (alive) setRaw(d); })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // audit logs depend on the date range; others only on FY
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.key, fy?.id, tick, !!filters.from, report?.needs.includes('auditLogs') ? `${filters.from}${filters.to}` : '']);

  const result = useMemo(() => {
    if (!raw || !report) return null;
    const statusOk = (s, kind) => {
      if (report.rawStatus) return true;
      const st = filters.status || 'final';
      if (st === 'final') return kind === 'd' ? s === 'approved' : s === 'paid';
      if (st === 'nonvoid') return s !== 'void';
      return s === st;
    };
    const useDates = report.filters.includes('dates');
    const f = { ...filters, from: useDates ? filters.from : null, to: useDates ? filters.to : null, status: undefined };
    const data = { ...raw };
    if (raw.donations) {
      data.donations = applyFilters(raw.donations.filter((d) => statusOk(d.status, 'd')), report.rawStatus ? {} : f, { categoryField: 'categoryIds' })
        .filter((d) => !filters.donorId || d.donorId === filters.donorId)
        // category / fund filter: keep only the matching lines of a multi-line donation (amount follows)
        .map((d) => {
          if (report.rawStatus || (!filters.categoryId && !filters.fundId)) return d;
          const lines = (d.lines || []).filter((l) => (!filters.categoryId || l.categoryId === filters.categoryId) && (!filters.fundId || l.fundId === filters.fundId));
          return lines.length === (d.lines || []).length ? d : { ...d, lines, amount: round2(lines.reduce((s, l) => s + l.amount, 0)) };
        })
        .sort((a, b) => a.date.localeCompare(b.date) || (a.receiptNo || '').localeCompare(b.receiptNo || ''));
    }
    if (raw.expenses) {
      data.expenses = applyFilters(raw.expenses.filter((e) => statusOk(e.status, 'e')), report.rawStatus ? {} : f)
        .filter((e) => !filters.payeeId || e.payeeId === filters.payeeId)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.voucherNo || '').localeCompare(b.voucherNo || ''));
    }
    const ctx = {
      fy, accounts: app.accounts, funds: app.funds, settings: app.settings, filters, t: tr, pick,
      from: useDates ? filters.from : null, to: useDates ? filters.to : null, fundName: app.fundName,
    };
    try {
      return report.build(data, ctx);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      return { error: e.message };
    }
  }, [raw, report, filters, fy, app.accounts, app.funds, app.settings, app.fundName, tr, pick]);

  if (!report) return <Result status="404" title={tr('Report not found')} />;
  const set = (k, v) => setFilters((p) => ({ ...p, [k]: v }));
  const has = (x) => report.filters.includes(x);
  const isDon = report.needs.includes('donations');
  const title = result?.title || `${tr(report.title)} – FY ${fy?.id}`;
  const subtitle = has('dates') ? `${fmtDate(filters.from)} to ${fmtDate(filters.to)}` : (report.allYears ? tr('All financial years') : `${fmtDate(fy?.startDate)} to ${fmtDate(fy?.endDate)}`);

  return (
    <Guard perm="reports.view">
      <PageHeader
        title={title}
        subtitle={subtitle}
        extra={[
          <Link key="b" href="/reports"><Button icon={<ArrowLeftOutlined />}>{tr('All reports')}</Button></Link>,
          <Button key="r" icon={<ReloadOutlined />} onClick={() => setTick((t) => t + 1)} />,
          result?.sections ? <ExportButtons key="x" title={title} subtitle={subtitle} sections={result.sections} landscape={result.landscape !== false} /> : null,
        ]}
      />
      <Card size="small" style={{ marginBottom: 12 }} className="no-print">
        <Space wrap>
          {has('dates') ? (
            <DatePicker.RangePicker
              format="DD-MM-YYYY"
              allowClear={false}
              value={filters.from ? [dayjs(filters.from), dayjs(filters.to)] : null}
              onChange={(r) => setFilters((p) => ({ ...p, from: r[0].format('YYYY-MM-DD'), to: r[1].format('YYYY-MM-DD') }))}
              presets={[
                { label: tr('Full FY'), value: [dayjs(fy?.startDate), dayjs(fy?.endDate)] },
                { label: tr('This month'), value: [dayjs().startOf('month'), dayjs().endOf('month')] },
                { label: tr('Q1 (Apr–Jun)'), value: [dayjs(fy?.startDate), dayjs(fy?.startDate).add(2, 'month').endOf('month')] },
                { label: tr('Q2 (Jul–Sep)'), value: [dayjs(fy?.startDate).add(3, 'month'), dayjs(fy?.startDate).add(5, 'month').endOf('month')] },
                { label: tr('Q3 (Oct–Dec)'), value: [dayjs(fy?.startDate).add(6, 'month'), dayjs(fy?.startDate).add(8, 'month').endOf('month')] },
                { label: tr('Q4 (Jan–Mar)'), value: [dayjs(fy?.startDate).add(9, 'month'), dayjs(fy?.endDate)] },
              ]}
            />
          ) : null}
          {has('month') ? (
            <DatePicker picker="month" format="MMM YYYY" allowClear={false} value={filters.month ? dayjs(`${filters.month}-01`) : null} onChange={(d) => set('month', d.format('YYYY-MM'))}
              disabledDate={(d) => d.isBefore(dayjs(fy?.startDate), 'month') || d.isAfter(dayjs(fy?.endDate), 'month')}
            />
          ) : null}
          {has('status') ? (
            <Select style={{ width: 210 }} value={filters.status} onChange={(v) => set('status', v)}
              options={[
                { value: 'final', label: tr(isDon ? tr('Approved only') : tr('Paid only')) },
                { value: 'nonvoid', label: tr('All except void') },
                ...(isDon ? ['draft', 'submitted', 'verified', 'void'] : ['draft', 'submitted', 'approved', 'void']).map((s) => ({ value: s, label: tr(STATUS_META[s].label) })),
              ]}
            />
          ) : null}
          {has('donationCategory') ? <Select allowClear placeholder={tr('Category')} style={{ width: 190 }} value={filters.categoryId} onChange={(v) => set('categoryId', v)} options={app.donationCategories.map((c) => ({ value: c.id, label: pick(c.name, c.nameHi) }))} /> : null}
          {has('expenseCategory') ? <Select allowClear placeholder={tr('Category')} style={{ width: 190 }} value={filters.categoryId} onChange={(v) => set('categoryId', v)} options={app.expenseCategories.map((c) => ({ value: c.id, label: pick(c.name, c.nameHi) }))} /> : null}
          {has('donor') ? <div style={{ width: 230 }}><PartySelect kind="donor" value={filters.donorId} onChange={(v) => set('donorId', v)} placeholder={tr('Donor (all)')} /></div> : null}
          {has('payee') ? <div style={{ width: 230 }}><PartySelect kind="payee" value={filters.payeeId} onChange={(v) => set('payeeId', v)} placeholder={tr('Payee (all)')} /></div> : null}
          {has('mode') ? <Select allowClear placeholder={tr('Payment mode')} style={{ width: 150 }} value={filters.mode} onChange={(v) => set('mode', v)} options={PAYMENT_MODES.map((m) => ({ value: m, label: tr(m) }))} /> : null}
          {has('account') ? <Select allowClear placeholder={tr('Bank / cash account')} style={{ width: 200 }} value={filters.accountId} onChange={(v) => set('accountId', v)} options={app.accounts.map((a) => ({ value: a.id, label: a.name }))} /> : null}
          {has('fund') ? <Select allowClear placeholder={tr('Project / fund')} style={{ width: 180 }} value={filters.fundId} onChange={(v) => set('fundId', v)} options={app.funds.map((x) => ({ value: x.id, label: x.name }))} /> : null}
          {has('payeeType') ? <Select allowClear placeholder={tr('Payee type')} style={{ width: 170 }} value={filters.payeeType} onChange={(v) => set('payeeType', v)} options={PAYEE_TYPES.map((o) => ({ ...o, label: tr(o.label) }))} /> : null}
          {has('docType') ? <Select allowClear placeholder={tr('Document type')} style={{ width: 190 }} value={filters.docType} onChange={(v) => set('docType', v)} options={DOC_TYPES.map((d) => ({ value: d, label: tr(d) }))} /> : null}
          {has('amount') ? (
            <Space.Compact>
              <InputNumber placeholder={tr('Min ₹')} min={0} style={{ width: 100 }} value={filters.min} onChange={(v) => set('min', v)} />
              <InputNumber placeholder={tr('Max ₹')} min={0} style={{ width: 100 }} value={filters.max} onChange={(v) => set('max', v)} />
            </Space.Compact>
          ) : null}
        </Space>
      </Card>

      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} /> : null}
      {result?.error ? <Alert type="error" showIcon title={result.error} style={{ marginBottom: 12 }} /> : null}
      {!fy ? <Result status="info" title={tr('Create a financial year first (Financial Year menu).')} /> : null}
      {fy && (loading || (!result && !error)) ? <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div> : null}
      {!fy || loading || !result ? null : (
        <>
          {result.cards ? (
            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
              {result.cards.map((c) => <Col xs={12} md={6} key={c.title}><Card size="small"><Statistic title={tr(c.title)} value={c.value} precision={2} prefix="₹" /></Card></Col>)}
            </Row>
          ) : null}
          {(result.sections || []).map((s, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <Card key={i} title={tr(s.title)} size="small" style={{ marginBottom: 12 }}>
              <Table
                size="small"
                rowKey={(_, idx) => idx}
                dataSource={s.rows}
                columns={toAntCols(s.columns, tr)}
                scroll={{ x: Math.max(600, s.columns.length * 120) }}
                pagination={s.rows.length > 100 ? { defaultPageSize: 100, showSizeChanger: true } : false}
                summary={s.totals ? () => (
                  <Table.Summary fixed>
                    <Table.Summary.Row className="table-summary">
                      {s.columns.map((c, ci) => (
                        <Table.Summary.Cell key={c.key} index={ci} align={c.money ? 'right' : undefined}>
                          {c.money && typeof s.totals[c.key] === 'number' ? <Money value={s.totals[c.key]} strong /> : <b>{tr(s.totals[c.key] ?? '')}</b>}
                        </Table.Summary.Cell>
                      ))}
                    </Table.Summary.Row>
                  </Table.Summary>
                ) : undefined}
              />
            </Card>
          ))}
          {result.note ? <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>{tr('Note:')}{' '}{tr(result.note)}</Typography.Paragraph> : null}
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>{tr('Generated for')}{' '}{user?.name} · {dayjs().format('DD-MM-YYYY hh:mm A')}</Typography.Paragraph>
        </>
      )}
    </Guard>
  );
}

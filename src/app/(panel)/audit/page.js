'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Card, Row, Col, Statistic, Steps, Button, Form, Input, Space, Table, InputNumber, Alert, List, Tag, DatePicker, Result,
} from 'antd';
import { PlusOutlined, DeleteOutlined, FileSearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { where } from 'firebase/firestore';
import { COL, AUDIT_STATUS, STATUS_META } from '@/lib/constants';
import { round2, sum } from '@/lib/format';
import { useLiveQuery, useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Guard, Money, StatusTag, useReasonPrompt } from '@/components/common';
import DocumentsPanel from '@/components/DocumentsPanel';
import { periodSummary } from '@/services/accounting';
import { updateAudit, saveFyFields } from '@/services/closing';
import { getCountFromServer, query, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useYearStats } from '@/lib/useYearStats';
import { seriesFromStats } from '@/services/stats';
import { useLang } from '@/i18n/LangContext';

const REGISTERS = [
  ['donation-register', 'Donation Register'], ['expense-register', 'Expense Register'], ['payment-register', 'Payment Register'],
  ['donor-register', 'Donor List / Register'], ['beneficiary-register', 'Beneficiary Register'], ['bank-book', 'Bank Ledger'],
  ['cash-book', 'Cash Book'], ['receipt-payment', 'Receipt & Payment'], ['income-expenditure', 'Income & Expenditure'],
  ['fy-summary', 'FY Summary'], ['corpus-donation', 'Corpus Donations'], ['bank-reconciliation', 'Bank Reconciliation'],
  ['documents-register', 'Supporting Documents'], ['audit-trail', 'Audit Trail'],
];

function ItemsEditor({ title, value = [], onSave, disabled }) {
  const { t: tr } = useLang();
  const [rows, setRows] = useState(value);
  // reset only when the SAVED value really changes (a new [] on every render must not wipe unsaved rows)
  const saved = JSON.stringify(value);
  useEffect(() => setRows(JSON.parse(saved)), [saved]);
  const changed = JSON.stringify(rows) !== JSON.stringify(value);
  return (
    <Card size="small" title={title} extra={!disabled ? <Space><Button size="small" icon={<PlusOutlined />} onClick={() => setRows([...rows, { name: '', amount: 0 }])}>{tr('Add')}</Button><Button size="small" type="primary" disabled={!changed} onClick={() => onSave(rows.filter((r) => r.name))}>{tr('Save')}</Button></Space> : null}>
      <Table
        size="small"
        rowKey={(_, i) => i}
        pagination={false}
        dataSource={rows}
        columns={[
          { title: tr('Particulars'), render: (_, r, i) => (disabled ? r.name : <Input value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={tr('e.g. Building, FD, Furniture / Payable')} />) },
          { title: tr('Amount (₹)'), width: 160, align: 'right', render: (_, r, i) => (disabled ? <Money value={r.amount} /> : <InputNumber value={r.amount} style={{ width: '100%' }} precision={2} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: v || 0 } : x)))} />) },
          ...(!disabled ? [{ width: 40, render: (_, __, i) => <Button size="small" danger icon={<DeleteOutlined />} onClick={() => setRows(rows.filter((_, j) => j !== i))} /> }] : []),
        ]}
        summary={() => <Table.Summary.Row className="table-summary"><Table.Summary.Cell index={0}>{tr('Total')}</Table.Summary.Cell><Table.Summary.Cell index={1} align="right"><Money value={sum(rows, (r) => r.amount)} /></Table.Summary.Cell>{!disabled ? <Table.Summary.Cell index={2} /> : null}</Table.Summary.Row>}
      />
    </Card>
  );
}

export default function AuditPage() {
  const { t: tr } = useLang();
  const { can, user } = useAuth();
  const app = useAppData();
  const fy = app.selectedFy;
  const [run, busy] = useAction();
  const [ask, reasonModal] = useReasonPrompt();
  const [form] = Form.useForm();
  // year totals from the summary document; donor count from a server-side count
  const { stats } = useYearStats(fy);
  const s = useMemo(() => (fy ? seriesFromStats({ fy, accounts: app.accounts, stats }) : null), [fy, app.accounts, stats]);
  const [donorCount, setDonorCount] = useState('—');
  useEffect(() => {
    if (!fy) return;
    getCountFromServer(query(collection(db, COL.donors), where(`fyTotals.${fy.id.replace('-', '_')}`, '>', 0)))
      .then((r) => setDonorCount(r.data().count)).catch(() => setDonorCount('—'));
  }, [fy?.id, stats?.updatedAt?.seconds]);
  const audit = fy?.audit || { status: 'draft' };
  const editable = can('audit.manage') && fy?.status !== 'finalized';

  useEffect(() => {
    if (fy) form.setFieldsValue({ ...audit, auditDate: audit.auditDate ? dayjs(audit.auditDate) : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fy?.id, fy?.audit]);

  if (!fy) return <Guard perm="audit.view"><Result status="info" title={tr('Create a financial year first (Financial Year menu).')} /></Guard>;
  const idx = Math.max(0, AUDIT_STATUS.indexOf(audit.status || 'draft'));
  const next = AUDIT_STATUS[idx + 1];
  const canMove = next && (next === 'finalized' ? can('audit.finalize') : can('audit.manage'));

  const move = async (to) => {
    const reason = await ask(tr('Change audit status to “{v0}”?', { v0: tr(STATUS_META[to].label) }), {
      okText: tr('Confirm'), danger: to === 'finalized', label: tr('Remarks'),
      placeholder: to === 'finalized' ? tr('Finalizing permanently locks this financial year.') : tr('Remarks for the audit trail'),
    });
    if (reason) run(() => updateAudit({ fy, patch: { status: to, [`${to}At`]: new Date().toISOString(), [`${to}By`]: user.name }, user, reason }), 'Audit status updated');
  };

  const saveDetails = async () => {
    const v = await form.validateFields();
    const patch = { ...v, auditDate: v.auditDate ? v.auditDate.format('YYYY-MM-DD') : null };
    Object.keys(patch).forEach((k) => { if (patch[k] === undefined) patch[k] = null; });
    run(() => updateAudit({ fy, patch, user }), 'Saved');
  };

  return (
    <Guard perm="audit.view">
      <PageHeader title={tr('Annual Audit – FY {v0}', { v0: fy.id })} subtitle={<span>{tr('Year status')} <StatusTag status={fy.status} /> · {tr('Audit status')} <StatusTag status={audit.status} /></span>} />
      {fy.status === 'open' ? <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tr('The year is still open. Close it from Financial Year once all months are closed; the audit can be finalized only after closing.')} /> : null}
      {fy.status === 'finalized' ? <Alert type="error" showIcon style={{ marginBottom: 12 }} title={tr('Finalized – this year is permanently locked.')} /> : null}

      <Card style={{ marginBottom: 12 }}>
        <Steps current={idx} items={AUDIT_STATUS.map((a) => ({ title: tr(STATUS_META[a].label) }))} style={{ marginBottom: 12 }} />
        {canMove ? (
          <Button type="primary" danger={next === 'finalized'} loading={busy} disabled={next === 'finalized' && fy.status !== 'closed'} onClick={() => move(next)}>
            {tr('Move to “{v0}”', { v0: tr(STATUS_META[next].label) })}
          </Button>
        ) : null}
        {idx > 0 && idx < 3 && can('audit.manage') ? <Button style={{ marginLeft: 8 }} onClick={() => move(AUDIT_STATUS[idx - 1])}>{tr('Send back')}</Button> : null}
      </Card>

      {s ? (
        <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Total donation')} value={s.totals.donation} precision={2} prefix="₹" /></Card></Col>
          <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Total expense')} value={round2(s.totals.expense + s.totals.bankCharges)} precision={2} prefix="₹" /></Card></Col>
          <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Bank balance (year end)')} value={s.closingBank} precision={2} prefix="₹" /></Card></Col>
          <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Cash balance (year end)')} value={s.closingCash} precision={2} prefix="₹" /></Card></Col>
          <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Assets')} value={sum(fy.assets || [], (a) => a.amount)} precision={2} prefix="₹" /></Card></Col>
          <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Liabilities')} value={sum(fy.liabilities || [], (a) => a.amount)} precision={2} prefix="₹" /></Card></Col>
          <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Donors (this FY)')} value={donorCount} /></Card></Col>
          <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Other income')} value={s.totals.otherIncome} precision={2} prefix="₹" /></Card></Col>
        </Row>
      ) : null}

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <Card size="small" title={tr('Auditor details & notes')} extra={editable ? <Button size="small" type="primary" onClick={saveDetails} loading={busy}>{tr('Save')}</Button> : null}>
            <Form form={form} layout="vertical" disabled={!editable}>
              <Row gutter={12}>
                <Col xs={24} md={12}><Form.Item name="auditorName" label={tr('Auditor name')}><Input /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name="firmName" label={tr('CA firm')}><Input /></Form.Item></Col>
                <Col xs={12} md={8}><Form.Item name="membershipNo" label={tr('Membership no.')}><Input /></Form.Item></Col>
                <Col xs={12} md={8}><Form.Item name="udin" label={tr('UDIN')}><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name="auditDate" label={tr('Audit report date')}><DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} /></Form.Item></Col>
              </Row>
              <Form.Item name="notes" label={tr('Audit notes / observations')}><Input.TextArea rows={5} /></Form.Item>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title={tr('Registers & reports for audit')}>
            <List
              grid={{ gutter: 8, xs: 1, sm: 2 }}
              dataSource={REGISTERS}
              renderItem={([k, t]) => <List.Item style={{ marginBottom: 6 }}><Link href={`/reports/${k}`}><FileSearchOutlined /> {tr(t)}</Link></List.Item>}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}><ItemsEditor title={tr('Assets')} value={fy.assets || []} disabled={!editable} onSave={(rows) => run(() => saveFyFields({ fy, patch: { assets: rows }, user }), 'Assets saved')} /></Col>
        <Col xs={24} lg={12}><ItemsEditor title={tr('Liabilities')} value={fy.liabilities || []} disabled={!editable} onSave={(rows) => run(() => saveFyFields({ fy, patch: { liabilities: rows }, user }), 'Liabilities saved')} /></Col>
        <Col xs={24}>
          <Card size="small" title={<span>{tr('Audit documents')} <Tag>{tr('FY')}{' '}{fy.id}</Tag></span>}>
            <DocumentsPanel linkedType="audit" linkedId={`fy_${fy.id}`} linkedRef={`FY ${fy.id}`} financialYearId={fy.id} defaultDocType="Audit Document" />
          </Card>
        </Col>
      </Row>
      {reasonModal}
    </Guard>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Card, Descriptions, Table, Button, Tabs, Result, Spin, Alert, Popconfirm, Modal, Form, Select, Input, DatePicker,
} from 'antd';
import dayjs from 'dayjs';
import { PrinterOutlined, EditOutlined, CheckOutlined, StopOutlined, SendOutlined, DollarOutlined, DownloadOutlined } from '@ant-design/icons';
import { COL, PAYMENT_MODES, isCashMode, payeeTypeLabel } from '@/lib/constants';
import { fmtDate, fmtDateTime, money, todayStr } from '@/lib/format';
import { amountInWordsEn, amountInWordsHi } from '@/lib/amountInWords';
import { useLiveDoc, useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, StatusTag, Money, Guard, WorkflowTimeline, useReasonPrompt } from '@/components/common';
import DocumentsPanel from '@/components/DocumentsPanel';
import AuditHistory from '@/components/AuditHistory';
import { submitExpense, approveExpense, payExpense, voidExpense } from '@/services/expenses';
import { isPeriodLocked } from '@/services/periodLock';
import { paymentVoucherPdf } from '@/pdf/generate';
import { useLang } from '@/i18n/LangContext';

function PayModal({ open, onClose, expense }) {
  const { t: tr, pick } = useLang();
  const { user } = useAuth();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const mode = Form.useWatch('paymentMode', form);
  const payDate = Form.useWatch('date', form);
  const accounts = app.activeAccounts.filter((a) => (isCashMode(mode) ? a.type === 'cash' : a.type === 'bank'));
  const submit = async () => {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    const ok = await run(() => payExpense(expense.id, { ...v, date: v.date.format('YYYY-MM-DD') }, user), 'Marked as paid – ledger updated');
    if (ok) onClose();
  };
  return (
    <Modal open={open} onCancel={onClose} onOk={submit} confirmLoading={busy} title={tr('Mark {v0} as paid', { v0: expense.voucherNo })} okText={tr('Mark paid')} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ date: dayjs(todayStr() < expense.date ? expense.date : todayStr()), paymentMode: expense.paymentMode || 'Bank Transfer', accountId: expense.accountId, utr: expense.utr, chequeNo: expense.chequeNo, cashRef: expense.cashRef }}>
        <Form.Item name="date" label={tr('Payment date')} rules={[{ required: true }]} extra={tr('The cash / bank book is debited on this date.')}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isBefore(dayjs(expense.date), 'day') || d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        <Form.Item name="paymentMode" label={tr('Payment mode')} rules={[{ required: true }]}><Select options={PAYMENT_MODES.map((m) => ({ value: m, label: tr(m) }))} /></Form.Item>
        <Form.Item name="accountId" label={tr('Paid from')} rules={[{ required: true }]}>
          <Select options={accounts.map((a) => ({ value: a.id, label: tr('{v0} (bal. {v1})', { v0: a.name, v1: money(a.currentBalance) }) }))} />
        </Form.Item>
        {isCashMode(mode) ? <Form.Item name="cashRef" label={tr('Cash reference')}><Input /></Form.Item>
          : ['Cheque', 'Demand Draft'].includes(mode) ? <Form.Item name="chequeNo" label={mode === 'Cheque' ? tr('Cheque no.') : tr('DD no.')} rules={[{ required: true }]}><Input /></Form.Item>
            : <Form.Item name="utr" label={tr('UTR / Transaction ID')} rules={[{ required: true }]}><Input /></Form.Item>}
        <Form.Item name="note" label={tr('Note')}><Input /></Form.Item>
        <Alert type="info" showIcon title={tr('₹{v0} will be debited on {v1}', { v0: expense.amount, v1: fmtDate(payDate ? payDate.format('YYYY-MM-DD') : expense.date) })} />
      </Form>
    </Modal>
  );
}

export default function ExpenseDetailPage() {
  const { t: tr, pick } = useLang();
  const { id } = useParams();
  const router = useRouter();
  const { user, can } = useAuth();
  const app = useAppData();
  const { data: e, loading } = useLiveDoc(COL.expenses, id);
  const [run, busy] = useAction();
  const [ask, reasonModal] = useReasonPrompt();
  const [payOpen, setPayOpen] = useState(false);

  if (loading) return <Spin />;
  if (!e) return <Result status="404" title={tr('Expense not found')} />;

  const locked = isPeriodLocked({ dateStr: e.date, user, fys: app.fys, closings: app.closings });
  const fyFinalized = app.fys.find((f) => f.id === e.financialYearId)?.status === 'finalized';
  const canEdit = !e.posted && !['paid', 'void'].includes(e.status) && !locked && can('expenses.create') && (can('expenses.approve') || e.createdBy === user.uid);

  const doVoid = async () => {
    const reason = await ask(tr('Void expense {v0}?', { v0: e.voucherNo || '' }), { okText: tr('Void expense') });
    if (reason) run(() => voidExpense(e.id, reason, user), e.posted ? tr('Voided – reversal entry posted') : tr('Voided'));
  };

  const actions = [];
  if (e.status === 'draft' && can('expenses.create') && (e.createdBy === user.uid || can('expenses.approve'))) actions.push(<Button key="s" type="primary" icon={<SendOutlined />} loading={busy} disabled={locked} onClick={() => run(() => submitExpense(e.id, user, app.settings), 'Submitted for approval')}>{tr('Submit')}</Button>);
  if (e.status === 'submitted' && can('expenses.approve')) {
    actions.push(
      <Popconfirm key="a" title={tr('Approve this expense?')} onConfirm={() => run(() => approveExpense(e.id, user), 'Approved')}>
        <Button type="primary" icon={<CheckOutlined />} loading={busy} disabled={locked}>{tr('Approve')}</Button>
      </Popconfirm>,
    );
  }
  if (e.status === 'approved' && can('expenses.pay')) actions.push(<Button key="p" type="primary" icon={<DollarOutlined />} disabled={fyFinalized} onClick={() => setPayOpen(true)}>{tr('Mark paid')}</Button>);
  if (canEdit) actions.push(<Button key="e" icon={<EditOutlined />} onClick={() => router.push(`/expenses/${e.id}/edit`)}>{tr('Edit')}</Button>);
  if (e.voucherNo) {
    actions.push(<Button key="v" icon={<PrinterOutlined />} loading={busy} onClick={() => run(() => paymentVoucherPdf({ expense: e, settings: app.settings }))}>{tr('Voucher')}</Button>);
    actions.push(<Button key="vd" icon={<DownloadOutlined />} onClick={() => run(() => paymentVoucherPdf({ expense: e, settings: app.settings, download: true }))} />);
  }
  if (e.status !== 'void' && can('finance.void')) actions.push(<Button key="x" danger icon={<StopOutlined />} disabled={fyFinalized} title={fyFinalized ? tr('Finalized year – use an adjustment entry') : undefined} onClick={doVoid}>{tr('Void')}</Button>);

  return (
    <Guard perm="expenses.view">
      <PageHeader title={<span>{tr('Expense')}{' '}{e.voucherNo || tr('(draft)')} <StatusTag status={e.status} /></span>} subtitle={`${e.payee?.name} · ${fmtDate(e.date)} · FY ${e.financialYearId}`} extra={actions} />
      {locked && e.status !== 'void' ? <Alert type="warning" showIcon title={tr('This period is locked (month / FY closed). Changes are restricted.')} style={{ marginBottom: 12 }} /> : null}
      {e.status === 'void' ? <Alert type="error" showIcon title={tr('Voided by {v0}: {v1}', { v0: e.voidedByName, v1: e.voidReason })} description={e.reversalTxnId ? tr('A reversal entry was posted in the ledger.') : null} style={{ marginBottom: 12 }} /> : null}
      <Card style={{ marginBottom: 16 }}>
        <Descriptions bordered size="small" column={{ xs: 1, md: 2, lg: 3 }}>
          <Descriptions.Item label={tr('Voucher no.')}>{e.voucherNo || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Date')}>{fmtDate(e.date)}</Descriptions.Item>
          <Descriptions.Item label={tr('Financial year')}>{e.financialYearId}</Descriptions.Item>
          <Descriptions.Item label={tr('Paid to')}><Link href={`/beneficiaries/${e.payeeId}`}>{e.payee?.name}</Link> ({tr(payeeTypeLabel(e.payee?.type))})</Descriptions.Item>
          <Descriptions.Item label={tr('Mobile')}>{e.payee?.mobile || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('PAN / GST')}>{[e.payee?.pan, e.payee?.gstin].filter(Boolean).join(' / ') || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Category')}>{pick(e.categoryName, e.categoryNameHi)}{e.isCapital ? ` (${tr('Capital')})` : ''}</Descriptions.Item>
          <Descriptions.Item label={tr('Purpose')} span={2}>{e.purpose || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Amount')}><Money value={e.amount} strong /></Descriptions.Item>
          <Descriptions.Item label={tr('In words')} span={2}>{amountInWordsHi(e.amount)}<br /><span className="muted">{amountInWordsEn(e.amount)}</span></Descriptions.Item>
          <Descriptions.Item label={tr('Payment mode')}>{e.paymentMode || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Account')}>{e.accountName || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('UTR / Cheque / Cash ref')}>{e.utr || e.chequeNo || e.cashRef || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Fund / Project')}>{e.fundName || e.projectName || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Bill / Invoice')}>{e.billNo ? `${e.billNo}${e.billDate ? ` dt. ${fmtDate(e.billDate)}` : ''}` : '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Approved by')}>{e.approvedByName || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Created')}>{e.createdByName} · {fmtDateTime(e.createdAt)}</Descriptions.Item>
          <Descriptions.Item label={tr('Paid by')}>{e.paidByName ? `${e.paidByName} · ${fmtDateTime(e.paidAt)}` : '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Payment date')}>{e.paidDate ? fmtDate(e.paidDate) : (e.status === 'paid' ? fmtDate(e.date) : '—')}</Descriptions.Item>
          <Descriptions.Item label={tr('Ledger')}>{e.posted ? <Link href={`/transactions?highlight=${e.ledgerTxnId}`}>{tr('Posted ✓')}</Link> : tr('Not posted')}</Descriptions.Item>
          <Descriptions.Item label={tr('Remarks')} span={3}>{e.remarks || '—'}</Descriptions.Item>
        </Descriptions>
        <Table
          style={{ marginTop: 16 }}
          size="small"
          rowKey={(r, i) => i}
          pagination={false}
          dataSource={e.lines}
          columns={[
            { title: tr('S.No.'), render: (_, __, i) => i + 1, width: 60 },
            { title: tr('Particulars'), dataIndex: 'particulars' },
            { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> },
          ]}
        />
      </Card>
      <Card>
        <Tabs
          items={[
            { key: 'wf', label: tr('Workflow'), children: <WorkflowTimeline workflow={e.workflow} /> },
            { key: 'docs', label: tr('Bills & documents'), children: <DocumentsPanel linkedType="expense" linkedId={e.id} linkedRef={e.voucherNo} financialYearId={e.financialYearId} defaultDocType="Bill" /> },
            { key: 'audit', label: tr('Audit trail'), children: <AuditHistory docId={e.id} /> },
          ]}
        />
      </Card>
      {payOpen ? <PayModal open={payOpen} onClose={() => setPayOpen(false)} expense={e} /> : null}
      {reasonModal}
    </Guard>
  );
}

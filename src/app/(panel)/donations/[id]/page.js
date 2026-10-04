'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Card, Descriptions, Table, Button, Space, Tabs, Result, Spin, Alert, Popconfirm, Dropdown } from 'antd';
import {
  PrinterOutlined, DownloadOutlined, EditOutlined, CheckOutlined, StopOutlined, SendOutlined, SafetyOutlined, WhatsAppOutlined, DownOutlined, ExceptionOutlined,
} from '@ant-design/icons';
import { COL } from '@/lib/constants';
import { fmtDate, fmtDateTime, maskId } from '@/lib/format';
import { amountInWordsEn, amountInWordsHi } from '@/lib/amountInWords';
import { useLiveDoc, useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, StatusTag, Money, Guard, WorkflowTimeline, useReasonPrompt } from '@/components/common';
import DocumentsPanel from '@/components/DocumentsPanel';
import AuditHistory from '@/components/AuditHistory';
import { submitDonation, verifyDonation, approveDonation, voidDonation, markReceiptPrinted } from '@/services/donations';
import { isPeriodLocked } from '@/services/periodLock';
import { donationReceiptPdf } from '@/pdf/generate';
import { useLang } from '@/i18n/LangContext';

export default function DonationDetailPage() {
  const { t: tr } = useLang();
  const { id } = useParams();
  const router = useRouter();
  const { user, can } = useAuth();
  const app = useAppData();
  const { data: d, loading } = useLiveDoc(COL.donations, id);
  const [run, busy] = useAction();
  const [ask, reasonModal] = useReasonPrompt();

  if (loading) return <Spin />;
  if (!d) return <Result status="404" title={tr('Donation not found')} />;

  const locked = isPeriodLocked({ dateStr: d.date, user, fys: app.fys, closings: app.closings });
  const isOwn = d.createdBy === user.uid;
  const canEdit = !d.posted && !['approved', 'void'].includes(d.status) && !locked && can('donations.create') && (can('donations.verify') || isOwn);
  const fyFinalized = app.fys.find((f) => f.id === d.financialYearId)?.status === 'finalized';
  // every print is counted; the 2nd and later prints say "DUPLICATE"
  const pdf = (download, copyLabel) => run(async () => {
    let n = 1;
    try { n = await markReceiptPrinted(d.id, user); } catch { /* print anyway */ }
    await donationReceiptPdf({ donation: d, settings: app.settings, categories: app.donationCategories, download, copyLabel, duplicate: n > 1 && !copyLabel });
  });

  const doVoid = async () => {
    const reason = await ask(tr('Void donation {v0}?', { v0: d.receiptNo || '' }), { okText: tr('Void donation') });
    if (reason) run(() => voidDonation(d.id, reason, user), d.posted ? tr('Voided – reversal entry posted') : tr('Voided'));
  };
  const doBounce = async () => {
    const reason = await ask(tr('Cheque bounced – reverse donation {v0}?', { v0: d.receiptNo || '' }), { okText: tr('Mark bounced'), label: tr('Bank return reason / memo no.') });
    if (reason) run(() => voidDonation(d.id, reason, user, { bounced: true }), tr('Marked bounced – reversal entry posted. Record bank charges (if any) in Transactions.'));
  };
  const waText = encodeURIComponent(`${app.settings?.name || ''}\n${tr('Donation receipt')} ${d.receiptNo || ''}\n${tr('Date')}: ${fmtDate(d.date)}\n${tr('Amount')}: ₹${d.amount}\n${tr('Thank you for your donation.')}`);
  const waPhone = String(d.donor?.mobile || '').replace(/\D/g, '').slice(-10);

  const actions = [];
  if (d.status === 'draft' && can('donations.create') && (isOwn || can('donations.verify'))) actions.push(<Button key="s" type="primary" icon={<SendOutlined />} loading={busy} disabled={locked} onClick={() => run(() => submitDonation(d.id, user, app.settings), 'Submitted – receipt number issued')}>{tr('Submit')}</Button>);
  if (d.status === 'submitted' && can('donations.verify')) actions.push(<Button key="v" type="primary" icon={<SafetyOutlined />} loading={busy} disabled={locked} onClick={() => run(() => verifyDonation(d.id, user), 'Verified')}>{tr('Verify')}</Button>);
  if (d.status === 'verified' && can('donations.approve')) {
    actions.push(
      <Popconfirm key="a" title={tr('Approve & post to ledger?')} description={tr('₹{v0} will be credited to {v1}.', { v0: d.amount, v1: d.accountName })} onConfirm={() => run(() => approveDonation(d.id, user), 'Approved & posted')}>
        <Button type="primary" icon={<CheckOutlined />} loading={busy} disabled={locked}>{tr('Approve')}</Button>
      </Popconfirm>,
    );
  }
  if (canEdit) actions.push(<Button key="e" icon={<EditOutlined />} onClick={() => router.push(`/donations/${d.id}/edit`)}>{tr('Edit')}</Button>);
  if (d.receiptNo) {
    actions.push(
      <Space.Compact key="p">
        <Button icon={<PrinterOutlined />} loading={busy} onClick={() => pdf(false)}>{tr('Receipt')}</Button>
        <Dropdown
          menu={{
            items: [
              { key: 'dl', icon: <DownloadOutlined />, label: tr('Download PDF'), onClick: () => pdf(true) },
              { key: 'dc', label: tr('Donor copy'), onClick: () => pdf(false, 'दाता प्रति') },
              { key: 'oc', label: tr('Office copy'), onClick: () => pdf(false, 'कार्यालय प्रति') },
            ],
          }}
        >
          <Button icon={<DownOutlined />} />
        </Dropdown>
      </Space.Compact>,
    );
  }
  if (d.receiptNo && waPhone.length === 10 && d.status !== 'void') {
    actions.push(<Button key="w" icon={<WhatsAppOutlined />} href={`https://wa.me/91${waPhone}?text=${waText}`} target="_blank" rel="noopener noreferrer">{tr('WhatsApp')}</Button>);
  }
  if (d.posted && d.status === 'approved' && d.paymentMode === 'Cheque' && can('finance.void') && !fyFinalized) {
    actions.push(<Button key="b" danger icon={<ExceptionOutlined />} onClick={doBounce}>{tr('Cheque bounced')}</Button>);
  }
  if (d.status !== 'void' && can('finance.void')) actions.push(<Button key="x" danger icon={<StopOutlined />} disabled={fyFinalized} title={fyFinalized ? tr('Finalized year – use an adjustment entry') : undefined} onClick={doVoid}>{tr('Void')}</Button>);

  return (
    <Guard perm="donations.view">
      <PageHeader
        title={<span>{tr('Donation')}{' '}{d.receiptNo || tr('(draft)')} <StatusTag status={d.status} /></span>}
        subtitle={`${d.donor?.name} · ${fmtDate(d.date)} · FY ${d.financialYearId}`}
        extra={actions}
      />
      {locked && d.status !== 'void' ? <Alert type="warning" showIcon title={tr('This period is locked (month closed / FY closed). Changes are restricted.')} style={{ marginBottom: 12 }} /> : null}
      {d.status === 'void' ? <Alert type="error" showIcon title={tr('Voided by {v0}: {v1}', { v0: d.voidedByName, v1: d.voidReason })} description={d.reversalTxnId ? tr('A reversal entry was posted in the ledger. The original entry is kept for audit.') : null} style={{ marginBottom: 12 }} /> : null}

      <Card style={{ marginBottom: 16 }}>
        <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2, lg: 3 }}>
          <Descriptions.Item label={tr('Receipt no.')}>{d.receiptNo || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Date')}>{fmtDate(d.date)}</Descriptions.Item>
          <Descriptions.Item label={tr('Financial year')}>{d.financialYearId}</Descriptions.Item>
          <Descriptions.Item label={tr('Donor')}><Link href={`/donors/${d.donorId}`}>{d.donor?.name}</Link> ({tr(d.donor?.donorType || '')}) {d.donor?.donorCode}</Descriptions.Item>
          <Descriptions.Item label={tr('Organization')}>{d.donor?.organizationName || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Mobile / Email')}>{[d.donor?.mobile, d.donor?.email].filter(Boolean).join(' / ') || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('PAN')}>{d.donor?.pan || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Address')} span={2}>{d.donor?.address || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Amount')}><Money value={d.amount} strong /></Descriptions.Item>
          <Descriptions.Item label={tr('In words')} span={2}>{amountInWordsHi(d.amount)}<br /><span className="muted">{amountInWordsEn(d.amount)}</span></Descriptions.Item>
          <Descriptions.Item label={tr('Purpose')}>{d.purpose || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Payment mode')}>{d.paymentMode}</Descriptions.Item>
          <Descriptions.Item label={tr('Account')}>{d.accountName}</Descriptions.Item>
          <Descriptions.Item label={tr('UTR / Txn ID')}>{d.utr || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Cheque')}>{d.chequeNo ? `${d.chequeNo} ${d.chequeDate ? `dt. ${fmtDate(d.chequeDate)}` : ''}` : '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Donor bank / txn date')}>{[d.bankName, d.txnDate && fmtDate(d.txnDate)].filter(Boolean).join(' · ') || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Donor ref. no.')}>{d.donorRefNo || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Remarks')} span={2}>{d.remarks || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Created')}>{d.createdByName} · {fmtDateTime(d.createdAt)}</Descriptions.Item>
          <Descriptions.Item label={tr('Updated')}>{d.updatedByName} · {fmtDateTime(d.updatedAt)}</Descriptions.Item>
          <Descriptions.Item label={tr('Ledger')}>{d.posted ? <Link href={`/transactions?highlight=${d.ledgerTxnId}`}>{tr('Posted ✓')}</Link> : tr('Not posted')}</Descriptions.Item>
          {d.donor?.idNumber ? <Descriptions.Item label={tr('ID')}>{d.donor.idType}: {maskId(d.donor.idNumber)}</Descriptions.Item> : null}
        </Descriptions>
        <Table
          style={{ marginTop: 16 }}
          size="small"
          rowKey={(r, i) => i}
          pagination={false}
          dataSource={d.lines}
          columns={[
            { title: '#', render: (_, __, i) => i + 1, width: 50 },
            { title: tr('Category'), render: (_, l) => `${l.categoryName}${l.categoryNameHi ? ` – ${l.categoryNameHi}` : ''}${l.isCorpus ? ` (${tr('Corpus')})` : ''}` },
            { title: tr('Fund / Project'), render: (_, l) => app.fundName(l.fundId) || tr('General') },
            { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> },
          ]}
        />
      </Card>

      <Card>
        <Tabs
          items={[
            { key: 'wf', label: tr('Workflow'), children: <WorkflowTimeline workflow={d.workflow} /> },
            { key: 'docs', label: tr('Documents'), children: <DocumentsPanel linkedType="donation" linkedId={d.id} linkedRef={d.receiptNo} financialYearId={d.financialYearId} defaultDocType="Donation Receipt" /> },
            { key: 'audit', label: tr('Audit trail'), children: <AuditHistory docId={d.id} /> },
          ]}
        />
      </Card>
      {reasonModal}
    </Guard>
  );
}

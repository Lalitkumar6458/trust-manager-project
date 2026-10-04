'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, Descriptions, Table, Button, Tabs, Result, Spin, Row, Col, Statistic, Tag } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { where } from 'firebase/firestore';
import { COL, PAYEE_TYPES } from '@/lib/constants';
import { fmtDate, sum } from '@/lib/format';
import { useLiveDoc, useLiveQuery } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader, StatusTag, Money, Guard, Masked } from '@/components/common';
import DocumentsPanel from '@/components/DocumentsPanel';
import AuditHistory from '@/components/AuditHistory';
import ExportButtons from '@/components/ExportButtons';
import { PayeeModal } from '@/components/PartyForms';
import { groupSum } from '@/services/accounting';
import { expenseExportCols } from '@/lib/exportCols';
import { useLang } from '@/i18n/LangContext';

export default function BeneficiaryDetailPage() {
  const { t: tr, pick } = useLang();
  const { id } = useParams();
  const { can } = useAuth();
  const { data: p, loading } = useLiveDoc(COL.beneficiaries, id);
  const { data: expenses } = useLiveQuery(COL.expenses, [where('payeeId', '==', id)], [id]);
  const [open, setOpen] = useState(false);
  const all = useMemo(() => [...expenses].sort((a, b) => b.date.localeCompare(a.date)), [expenses]);
  const paid = all.filter((e) => e.status === 'paid');
  const byFy = useMemo(() => groupSum(paid, (e) => e.financialYearId), [paid]);
  const byCat = useMemo(() => groupSum(paid, (e) => pick(e.categoryName, e.categoryNameHi)), [paid]);

  if (loading) return <Spin />;
  if (!p) return <Result status="404" title={tr('Not found')} />;

  return (
    <Guard perm="beneficiaries.view">
      <PageHeader
        title={<span>{p.name} <Tag>{p.code}</Tag></span>}
        subtitle={tr(PAYEE_TYPES.find((x) => x.value === p.type)?.label)}
        extra={[
          can('beneficiaries.edit') ? <Button key="e" icon={<EditOutlined />} onClick={() => setOpen(true)}>{tr('Edit')}</Button> : null,
          <ExportButtons key="x" title={tr('Payment history – {v0}', { v0: p.name })} columns={expenseExportCols} rows={all} totals={{ payee: 'Total paid', amount: sum(paid, (e) => e.amount) }} />,
        ]}
      />
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={8}><Card><Statistic title={tr('Total amount received')} value={sum(paid, (e) => e.amount)} prefix="₹" precision={2} /></Card></Col>
        <Col xs={12} md={8}><Card><Statistic title={tr('Number of payments')} value={paid.length} /></Card></Col>
        <Col xs={24} md={8}><Card><Statistic title={tr('Last payment')} value={fmtDate(paid[0]?.date) || '—'} /></Card></Col>
      </Row>
      <Card style={{ marginBottom: 12 }}>
        <Descriptions size="small" bordered column={{ xs: 1, md: 2, lg: 3 }}>
          <Descriptions.Item label={tr('Mobile')}>{p.mobile || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Email')}>{p.email || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('PAN')}>{p.pan || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('GSTIN')}>{p.gstin || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Bank A/c')}><Masked value={p.bankAccountNo} show={can('expenses.pay')} /> {!p.bankAccountNo ? '—' : ''}</Descriptions.Item>
          <Descriptions.Item label={tr('IFSC / Bank')}>{[p.ifsc, p.bankName].filter(Boolean).join(' · ') || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Address')} span={3}>{p.address || '—'}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card>
        <Tabs
          items={[
            {
              key: 'h', label: tr('Payment history ({v0})', { v0: all.length }),
              children: (
                <Table
                  rowKey="id" size="small" dataSource={all} scroll={{ x: 700 }} pagination={{ pageSize: 20, hideOnSinglePage: true }}
                  columns={[
                    { title: tr('Date'), dataIndex: 'date', render: fmtDate, width: 105 },
                    { title: tr('Voucher'), dataIndex: 'voucherNo', render: (v, r) => <Link href={`/expenses/${r.id}`}>{v || tr('Draft')}</Link> },
                    { title: tr('Purpose'), render: (_, r) => r.purpose || pick(r.categoryName, r.categoryNameHi) },
                    { title: tr('Category'), dataIndex: 'categoryName', render: (v, r) => pick(v, r.categoryNameHi) },
                    { title: tr('Mode'), dataIndex: 'paymentMode' },
                    { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> },
                    { title: tr('Status'), dataIndex: 'status', render: (s) => <StatusTag status={s} /> },
                  ]}
                />
              ),
            },
            { key: 'fy', label: tr('FY-wise'), children: <Table rowKey="key" size="small" pagination={false} dataSource={byFy} columns={[{ title: tr('FY'), dataIndex: 'key' }, { title: tr('Payments'), dataIndex: 'count' }, { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> }]} /> },
            { key: 'cat', label: tr('Purpose-wise'), children: <Table rowKey="key" size="small" pagination={false} dataSource={byCat} columns={[{ title: tr('Category'), dataIndex: 'key' }, { title: tr('Payments'), dataIndex: 'count' }, { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> }]} /> },
            { key: 'docs', label: tr('Documents'), children: <DocumentsPanel linkedType="beneficiary" linkedId={p.id} linkedRef={p.name} defaultDocType="Beneficiary Document" /> },
            { key: 'audit', label: tr('Audit trail'), children: <AuditHistory docId={p.id} /> },
          ]}
        />
      </Card>
      <PayeeModal open={open} onClose={() => setOpen(false)} payee={p} />
    </Guard>
  );
}

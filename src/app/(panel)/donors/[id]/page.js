'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Card, Descriptions, Table, Button, Tabs, Result, Spin, Row, Col, Statistic, Tag } from 'antd';
import { EditOutlined, PlusOutlined, PrinterOutlined } from '@ant-design/icons';
import { where } from 'firebase/firestore';
import { COL } from '@/lib/constants';
import { fmtDate, maskId, sum } from '@/lib/format';
import { useLiveDoc, useLiveQuery, useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, StatusTag, Money, Guard } from '@/components/common';
import DocumentsPanel from '@/components/DocumentsPanel';
import AuditHistory from '@/components/AuditHistory';
import ExportButtons from '@/components/ExportButtons';
import { DonorModal } from '@/components/PartyForms';
import { groupSum, donationLines } from '@/services/accounting';
import { donationReceiptPdf } from '@/pdf/generate';
import { donationExportCols } from '@/lib/exportCols';
import { useLang } from '@/i18n/LangContext';

export default function DonorDetailPage() {
  const { t: tr, pick } = useLang();
  const { id } = useParams();
  const router = useRouter();
  const { can } = useAuth();
  const app = useAppData();
  const { data: donor, loading } = useLiveDoc(COL.donors, id);
  const { data: donations } = useLiveQuery(COL.donations, [where('donorId', '==', id)], [id]);
  const [open, setOpen] = useState(false);
  const [run] = useAction();

  const valid = useMemo(() => donations.filter((d) => d.status === 'approved').sort((a, b) => b.date.localeCompare(a.date)), [donations]);
  const all = useMemo(() => [...donations].sort((a, b) => b.date.localeCompare(a.date)), [donations]);
  const byFy = useMemo(() => groupSum(valid, (d) => d.financialYearId).sort((a, b) => b.key.localeCompare(a.key)), [valid]);
  const byCat = useMemo(() => groupSum(donationLines(valid), (l) => pick(l.lineCategory, l.lineCategoryHi), (l) => l.lineAmount), [valid, pick]);

  if (loading) return <Spin />;
  if (!donor) return <Result status="404" title={tr('Donor not found')} />;

  return (
    <Guard perm="donors.view">
      <PageHeader
        title={<span>{donor.name} <Tag>{donor.donorCode}</Tag></span>}
        subtitle={`${tr(donor.donorType || '')}${donor.organizationName ? ` · ${donor.organizationName}` : ''}`}
        extra={[
          can('donors.edit') ? <Button key="e" icon={<EditOutlined />} onClick={() => setOpen(true)}>{tr('Edit')}</Button> : null,
          can('donations.create') ? <Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => router.push(`/donations/new?donor=${donor.id}`)}>{tr('New donation')}</Button> : null,
          <ExportButtons key="x" title={tr('Donor history – {v0}', { v0: donor.name })} columns={donationExportCols} rows={all} totals={{ donor: tr('Total (approved)'), amount: sum(valid, (d) => d.amount) }} />,
        ]}
      />
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><Card><Statistic title={tr('Total donation')} value={sum(valid, (d) => d.amount)} prefix="₹" precision={2} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={tr('No. of donations')} value={valid.length} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={tr('First donation')} value={fmtDate(valid[valid.length - 1]?.date) || '—'} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={tr('Last donation')} value={fmtDate(valid[0]?.date) || '—'} /></Card></Col>
      </Row>
      <Card style={{ marginBottom: 12 }}>
        <Descriptions size="small" bordered column={{ xs: 1, md: 2, lg: 3 }}>
          <Descriptions.Item label={tr('Mobile')}>{donor.mobile || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Email')}>{donor.email || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('PAN')}>{donor.pan || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Address')} span={2}>{donor.address || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('ID')}>{donor.idNumber ? `${donor.idType}: ${maskId(donor.idNumber)}` : '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Categories')} span={3}>{byCat.map((c) => <Tag key={c.key}>{c.key}</Tag>)}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card>
        <Tabs
          items={[
            {
              key: 'h', label: tr('Donation history ({n})', { n: all.length }),
              children: (
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={all}
                  scroll={{ x: 700 }}
                  pagination={{ pageSize: 20, hideOnSinglePage: true }}
                  columns={[
                    { title: tr('Date'), dataIndex: 'date', render: fmtDate, width: 105 },
                    { title: tr('Receipt'), dataIndex: 'receiptNo', render: (v, r) => <Link href={`/donations/${r.id}`}>{v || tr('Draft')}</Link> },
                    { title: tr('Category'), render: (_, r) => r.lines.map((l) => pick(l.categoryName, l.categoryNameHi)).join(', ') },
                    { title: tr('Mode'), dataIndex: 'paymentMode' },
                    { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> },
                    { title: tr('Status'), dataIndex: 'status', render: (s) => <StatusTag status={s} /> },
                    { title: '', width: 50, render: (_, r) => (r.receiptNo ? <Button size="small" icon={<PrinterOutlined />} onClick={() => run(() => donationReceiptPdf({ donation: r, settings: app.settings, categories: app.donationCategories }))} /> : null) },
                  ]}
                />
              ),
            },
            {
              key: 'fy', label: tr('Financial year-wise'),
              children: <Table rowKey="key" size="small" pagination={false} dataSource={byFy} columns={[{ title: tr('FY'), dataIndex: 'key' }, { title: tr('Donations'), dataIndex: 'count' }, { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> }]} />,
            },
            {
              key: 'cat', label: tr('Category-wise'),
              children: <Table rowKey="key" size="small" pagination={false} dataSource={byCat} columns={[{ title: tr('Category'), dataIndex: 'key' }, { title: tr('Entries'), dataIndex: 'count' }, { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> }]} />,
            },
            { key: 'docs', label: tr('Documents'), children: <DocumentsPanel linkedType="donor" linkedId={donor.id} linkedRef={donor.name} defaultDocType="ID Proof" /> },
            { key: 'audit', label: tr('Audit trail'), children: <AuditHistory docId={donor.id} /> },
          ]}
        />
      </Card>
      <DonorModal open={open} onClose={() => setOpen(false)} donor={donor} />
    </Guard>
  );
}

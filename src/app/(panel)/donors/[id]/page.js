'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Card, Descriptions, Table, Button, Tabs, Result, Spin, Row, Col, Statistic, Tag, Dropdown } from 'antd';
import { EditOutlined, PlusOutlined, PrinterOutlined, FileTextOutlined } from '@ant-design/icons';
import { where } from '@/lib/q';
import { COL } from '@/lib/constants';
import { fmtDate, maskId, sum } from '@/lib/format';
import { useLiveDoc, useAction } from '@/lib/hooks';
import { fetchAll } from '@/services/db';
import { useServerTable, useAsyncValue } from '@/lib/useServerTable';
import ServerPager, { ServerError } from '@/components/ServerPager';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, StatusTag, Money, Guard } from '@/components/common';
import DocumentsPanel from '@/components/DocumentsPanel';
import AuditHistory from '@/components/AuditHistory';
import ExportButtons from '@/components/ExportButtons';
import { DonorModal } from '@/components/PartyForms';
import { groupSum, donationLines } from '@/services/accounting';
import { donationReceiptPdf, donorStatementPdf } from '@/pdf/generate';
import { donationExportCols } from '@/lib/exportCols';
import { useLang } from '@/i18n/LangContext';

export default function DonorDetailPage() {
  const { t: tr, pick } = useLang();
  const { id } = useParams();
  const router = useRouter();
  const { can, user } = useAuth();
  const app = useAppData();
  const { data: donor, loading } = useLiveDoc(COL.donors, id);
  // donation history: 100 per page from the server (newest first)
  const table = useServerTable(COL.donations, [where('donorId', '==', id || '-')], { order: ['date', 'desc'], key: id });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('h');
  const [run] = useAction();

  // totals are kept on the donor record (updated with every approval / void)
  const byFy = Object.entries(donor?.fyTotals || {}).map(([k, amount]) => ({ key: k.replace('_', '-'), amount })).filter((r) => r.amount).sort((a, b) => b.key.localeCompare(a.key));
  // category-wise summary is loaded only when that tab is opened
  const byCat = useAsyncValue(async () => {
    if (tab !== 'cat') return null;
    const valid = await fetchAll(COL.donations, where('donorId', '==', id), where('status', '==', 'approved'));
    return groupSum(donationLines(valid), (l) => pick(l.lineCategory, l.lineCategoryHi), (l) => l.lineAmount);
  }, [tab, id, table.rows], null);

  // yearly statement (80G / income-tax) – FYs in which this donor gave, newest first
  const statementFys = [...new Set([app.selectedFyId, ...byFy.map((r) => r.key)].filter(Boolean))].sort().reverse();
  const statement = (fyId) => run(async () => {
    const list = await fetchAll(COL.donations, where('donorId', '==', id), where('financialYearId', '==', fyId), where('status', '==', 'approved'));
    await donorStatementPdf({ donor, donations: list, settings: app.settings, fyId, generatedBy: user?.name });
  });

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
          <Dropdown key="st" menu={{ items: statementFys.map((fy) => ({ key: fy, label: `FY ${fy}`, onClick: () => statement(fy) })) }}>
            <Button icon={<FileTextOutlined />}>{tr('Yearly statement')}</Button>
          </Dropdown>,
          <ExportButtons key="x" title={tr('Donor history – {v0}', { v0: donor.name })} columns={donationExportCols} rows={table.rows} getRows={table.fetchAll} count={table.total} totalsFor={(rs) => ({ donor: tr('Total (approved)'), amount: sum(rs.filter((d) => d.status === 'approved'), (d) => d.amount) })} />,
        ]}
      />
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><Card><Statistic title={tr('Total donation')} value={donor.totalAmount || 0} prefix="₹" precision={2} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={tr('No. of donations')} value={donor.donationCount || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={tr('First donation')} value={fmtDate(donor.firstDonationDate) || '—'} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={tr('Last donation')} value={fmtDate(donor.lastDonationDate) || '—'} /></Card></Col>
      </Row>
      <Card style={{ marginBottom: 12 }}>
        <Descriptions size="small" bordered column={{ xs: 1, md: 2, lg: 3 }}>
          <Descriptions.Item label={tr('Mobile')}>{donor.mobile || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Email')}>{donor.email || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('PAN')}>{donor.pan || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('Address')} span={2}>{donor.address || '—'}</Descriptions.Item>
          <Descriptions.Item label={tr('ID')}>{donor.idNumber ? `${donor.idType}: ${maskId(donor.idNumber)}` : '—'}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'h', label: tr('Donation history ({n})', { n: table.total ?? '…' }),
              children: (
                <Table
                  rowKey="id"
                  size="small"
                  loading={table.loading}
                  dataSource={table.rows}
                  scroll={{ x: 700 }}
                  pagination={false}
                  title={table.error ? () => <ServerError table={table} /> : undefined}
                  footer={() => <ServerPager table={table} />}
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
              children: <Table rowKey="key" size="small" pagination={false} dataSource={byFy} columns={[{ title: tr('FY'), dataIndex: 'key' }, { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> }]} />,
            },
            {
              key: 'cat', label: tr('Category-wise'),
              children: <Table rowKey="key" size="small" pagination={false} loading={byCat === null} dataSource={byCat || []} columns={[{ title: tr('Category'), dataIndex: 'key' }, { title: tr('Entries'), dataIndex: 'count' }, { title: tr('Amount'), dataIndex: 'amount', align: 'right', render: (v) => <Money value={v} /> }]} />,
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

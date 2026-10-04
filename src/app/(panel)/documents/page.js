'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Table, Select, Input, Space, Tag, Switch } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { where } from 'firebase/firestore';
import { COL, DOC_TYPES } from '@/lib/constants';
import { fmtDateTime } from '@/lib/format';
import { useLiveQuery, useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Guard, useReasonPrompt } from '@/components/common';
import { UploadDocumentModal } from '@/components/DocumentsPanel';
import { archiveDocument } from '@/services/documents';
import { useLang } from '@/i18n/LangContext';

const linkFor = (d) => ({
  donation: `/donations/${d.linkedId}`, expense: `/expenses/${d.linkedId}`, donor: `/donors/${d.linkedId}`, beneficiary: `/beneficiaries/${d.linkedId}`, audit: '/audit',
}[d.linkedType]);

export default function DocumentsPage() {
  const { t: tr } = useLang();
  const { can, user } = useAuth();
  const app = useAppData();
  const [type, setType] = useState();
  const [text, setText] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [run] = useAction();
  const [ask, reasonModal] = useReasonPrompt();
  const { data, loading } = useLiveQuery(COL.documents, [where('financialYearId', '==', app.selectedFyId || '-')], [app.selectedFyId]);

  const rows = useMemo(() => data
    .filter((d) => showArchived || d.status !== 'archived')
    .filter((d) => !type || d.docType === type)
    .filter((d) => !text || [d.name, d.linkedRef, d.notes].filter(Boolean).some((x) => x.toLowerCase().includes(text.toLowerCase())))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)), [data, type, text, showArchived]);

  return (
    <Guard perm="documents.view">
      <PageHeader
        title={tr('Documents')}
        subtitle={tr('Supporting documents for FY {v0} – stored securely in Firebase Storage', { v0: app.selectedFyId })}
        extra={can('documents.upload') ? [<Button key="u" type="primary" icon={<UploadOutlined />} onClick={() => setOpen(true)}>{tr('Upload')}</Button>] : []}
      />
      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search allowClear placeholder={tr('File name / reference')} value={text} onChange={(e) => setText(e.target.value)} style={{ width: 240 }} />
          <Select allowClear placeholder={tr('Document type')} value={type} onChange={setType} style={{ width: 200 }} options={DOC_TYPES.map((d) => ({ value: d, label: tr(d) }))} />
          <span>{tr('Show archived')} <Switch size="small" checked={showArchived} onChange={setShowArchived} /></span>
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 800 }}
          columns={[
            { title: tr('File'), dataIndex: 'name', render: (v, d) => <a href={d.url} target="_blank" rel="noreferrer">{v}</a> },
            { title: tr('Type'), dataIndex: 'docType', render: (t) => <Tag>{tr(t || 'Other')}</Tag>, width: 170 },
            { title: tr('Linked to'), render: (_, d) => (linkFor(d) ? <Link href={linkFor(d)}>{d.linkedType} {d.linkedRef}</Link> : d.linkedType) },
            { title: tr('Notes'), dataIndex: 'notes', ellipsis: true, responsive: ['lg'] },
            { title: tr('Size'), dataIndex: 'size', render: (s) => `${Math.round((s || 0) / 1024)} KB`, width: 90, responsive: ['md'] },
            { title: tr('Uploaded'), render: (_, d) => <span style={{ fontSize: 12 }}>{d.createdByName}<br />{fmtDateTime(d.createdAt)}</span>, width: 170 },
            { title: '', width: 90, render: (_, d) => (d.status === 'archived' ? <Tag>{tr('Archived')}</Tag> : can('documents.archive') ? <a onClick={async () => { const r = await ask(tr('Archive {v0}?', { v0: d.name }), { okText: tr('Archive') }); if (r) run(() => archiveDocument(d, r, user), 'Archived'); }}>{tr('Archive')}</a> : null) },
          ]}
        />
      </Card>
      <UploadDocumentModal open={open} onClose={() => setOpen(false)} defaults={{ linkedType: 'general', financialYearId: app.selectedFyId }} />
      {reasonModal}
    </Guard>
  );
}

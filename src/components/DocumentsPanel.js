'use client';

import { useState } from 'react';
import { Button, List, Modal, Form, Select, Input, Upload, Progress, Tag, Typography, Space, Empty } from 'antd';
import { UploadOutlined, PaperClipOutlined, InboxOutlined } from '@ant-design/icons';
import { where } from 'firebase/firestore';
import { COL, DOC_TYPES } from '@/lib/constants';
import { fmtDateTime } from '@/lib/format';
import { useLiveQuery, useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { uploadDocument, archiveDocument } from '@/services/documents';
import { useReasonPrompt } from './common';
import { useLang } from '@/i18n/LangContext';

export function UploadDocumentModal({ open, onClose, defaults = {} }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [run, busy] = useAction();

  const submit = async () => {
    const v = await form.validateFields();
    if (!file) return;
    const ok = await run(() => uploadDocument(file, { ...defaults, ...v }, user, setProgress), 'Document uploaded');
    if (ok) {
      setFile(null);
      setProgress(0);
      form.resetFields();
      onClose();
    }
  };

  return (
    <Modal open={open} title={tr('Upload supporting document')} onCancel={onClose} onOk={submit} okText={tr('Upload')} confirmLoading={busy} okButtonProps={{ disabled: !file }} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ docType: defaults.docType || 'Other' }}>
        <Form.Item name="docType" label={tr('Document type')} rules={[{ required: true }]}>
          <Select options={DOC_TYPES.map((d) => ({ value: d, label: tr(d) }))} showSearch />
        </Form.Item>
        <Form.Item name="notes" label={tr('Notes')}><Input.TextArea rows={2} /></Form.Item>
        <Upload.Dragger
          maxCount={1}
          beforeUpload={(f) => { setFile(f); return false; }}
          onRemove={() => setFile(null)}
          fileList={file ? [{ uid: '1', name: file.name, status: 'done' }] : []}
          accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,.doc,.docx"
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p>{tr('Click or drop a file (PDF / image / Excel / Word, max 15 MB)')}</p>
        </Upload.Dragger>
        {busy ? <Progress percent={progress} size="small" /> : null}
      </Form>
    </Modal>
  );
}

/** Documents attached to one record (donation, expense, donor, beneficiary …) */
export default function DocumentsPanel({ linkedType, linkedId, linkedRef, financialYearId, defaultDocType }) {
  const { t: tr } = useLang();
  const { can, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [ask, reasonModal] = useReasonPrompt();
  const [run] = useAction();
  const { data, loading } = useLiveQuery(linkedId ? COL.documents : null, [where('linkedId', '==', linkedId || '-')], [linkedId]);
  const docs = data.filter((d) => d.status !== 'archived').sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  const archive = async (d) => {
    const reason = await ask(tr('Archive “{v0}”?', { v0: d.name }), { okText: tr('Archive') });
    if (reason) run(() => archiveDocument(d, reason, user), 'Archived');
  };

  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        {can('documents.upload') ? <Button icon={<UploadOutlined />} onClick={() => setOpen(true)}>{tr('Upload document')}</Button> : null}
      </Space>
      {docs.length ? (
        <List
          size="small"
          loading={loading}
          dataSource={docs}
          renderItem={(d) => (
            <List.Item
              actions={[
                <a key="o" href={d.url} target="_blank" rel="noreferrer">{tr('Open')}</a>,
                can('documents.archive') ? <a key="a" onClick={() => archive(d)}>{tr('Archive')}</a> : null,
              ].filter(Boolean)}
            >
              <List.Item.Meta
                avatar={<PaperClipOutlined />}
                title={<span>{d.name} <Tag>{tr(d.docType || 'Other')}</Tag></span>}
                description={<Typography.Text type="secondary" style={{ fontSize: 12 }}>{d.createdByName} · {fmtDateTime(d.createdAt)}{d.notes ? ` · ${d.notes}` : ''}</Typography.Text>}
              />
            </List.Item>
          )}
        />
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tr('No documents')} />}
      <UploadDocumentModal
        open={open}
        onClose={() => setOpen(false)}
        defaults={{ linkedType, linkedId, linkedRef, financialYearId, docType: defaultDocType }}
      />
      {reasonModal}
    </div>
  );
}

'use client';

import { useState } from 'react';
import {
  Alert, Button, Card, Modal, Progress, Space, Typography, Upload, List, Statistic, Row, Col,
} from 'antd';
import { CloudDownloadOutlined, UploadOutlined, FileExcelOutlined } from '@ant-design/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useAction } from '@/lib/hooks';
import { exportAllData, parseDonorRows, importDonors } from '@/services/backup';
import { parseStatementFile } from '@/services/reconciliation';
import { openBlob } from '@/pdf/generate';
import { useLang } from '@/i18n/LangContext';

/** Settings → Backup: one-click full export of every collection (Super Admin) */
export function BackupCard() {
  const { t: tr } = useLang();
  const { user, role } = useAuth();
  const [run, busy] = useAction();
  const [pct, setPct] = useState(null);
  const [step, setStep] = useState('');
  if (role !== 'superAdmin') return <Alert type="info" showIcon title={tr('Only the Super Admin can download a full backup.')} />;
  return (
    <Card size="small" title={tr('Full data backup')}>
      <Typography.Paragraph>
        {tr('Downloads every record (donations, expenses, ledger, donors, beneficiaries, accounts, financial years, audit logs …) into one Excel file – one sheet per collection. Take a backup at least every month and after every year-end closing, and keep it in a safe place: it contains donor PAN and mobile numbers.')}
      </Typography.Paragraph>
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Button
          type="primary"
          icon={<CloudDownloadOutlined />}
          loading={busy}
          onClick={() => run(() => exportAllData(user, (p, s) => { setPct(p); setStep(s); }), 'Backup downloaded')}
        >
          {tr('Download full backup (Excel)')}
        </Button>
        {pct !== null && pct < 100 ? <Progress percent={pct} size="small" status="active" format={() => step} /> : null}
        <Alert
          type="info"
          showIcon
          title={tr('Also turn on automatic daily backups in the Firebase console (Firestore → Disaster recovery → Backups) – see README.')}
        />
      </Space>
    </Card>
  );
}

const TEMPLATE = 'Name,Organization,Type,Mobile,Email,PAN,Address,Notes\nRamesh Patel,,Individual,9876543210,ramesh@example.com,ABCPP1234K,"12, Shyam Society, Ahmedabad",\n';

/** Donors → Import: CSV / Excel upload with validation and duplicate check (Super Admin) */
export function DonorImportButton() {
  const { t: tr } = useLang();
  const { user, role } = useAuth();
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [pct, setPct] = useState(null);
  const [result, setResult] = useState(null);
  const [run, busy] = useAction();
  if (role !== 'superAdmin') return null;

  const reset = () => { setParsed(null); setPct(null); setResult(null); };
  const onFile = async (file) => {
    reset();
    await run(async () => setParsed(parseDonorRows(await parseStatementFile(file))));
    return false;
  };
  const doImport = () => run(async () => {
    const r = await importDonors(parsed.donors, user, setPct);
    setResult(r);
  }, 'Import finished');

  return (
    <>
      <Button icon={<UploadOutlined />} onClick={() => { reset(); setOpen(true); }}>{tr('Import')}</Button>
      <Modal open={open} onCancel={() => setOpen(false)} footer={null} title={tr('Import donors (CSV / Excel)')} width={640} destroyOnHidden>
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {tr('Columns: Name (required), Organization, Type, Mobile, Email, PAN, Address, Notes. Donors whose mobile or PAN already exists are skipped. Donor IDs are issued automatically.')}
          </Typography.Paragraph>
          <Space wrap>
            <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={onFile}>
              <Button icon={<UploadOutlined />} loading={busy && !parsed}>{tr('Choose file')}</Button>
            </Upload>
            <Button icon={<FileExcelOutlined />} onClick={() => openBlob(new Blob([TEMPLATE], { type: 'text/csv' }), 'donor-import-template.csv', true)}>{tr('Download template')}</Button>
          </Space>
          {parsed ? (
            <>
              <Row gutter={12}>
                <Col span={12}><Statistic title={tr('Ready to import')} value={parsed.donors.length} /></Col>
                <Col span={12}><Statistic title={tr('Rows with errors')} value={parsed.errors.length} styles={{ content: { color: parsed.errors.length ? '#cf1322' : undefined } }} /></Col>
              </Row>
              {parsed.errors.length ? (
                <List size="small" bordered dataSource={parsed.errors.slice(0, 50)} renderItem={(e) => <List.Item style={{ color: '#cf1322' }}>{e}</List.Item>} style={{ maxHeight: 200, overflow: 'auto' }} />
              ) : null}
              {!result ? (
                <Button type="primary" disabled={!parsed.donors.length} loading={busy} onClick={doImport}>{tr('Import {n} donor(s)', { n: parsed.donors.length })}</Button>
              ) : null}
              {pct !== null && !result ? <Progress percent={pct} size="small" /> : null}
              {result ? <Alert type="success" showIcon title={tr('{v0} donor(s) created, {v1} skipped (already exist).', { v0: result.created, v1: result.skipped })} /> : null}
            </>
          ) : null}
        </Space>
      </Modal>
    </>
  );
}

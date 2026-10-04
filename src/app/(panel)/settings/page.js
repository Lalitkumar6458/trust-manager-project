'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card, Tabs, Form, Input, Button, Row, Col, InputNumber, Select, Table, Switch, Modal, Upload, Image, Space, Typography, Alert,
} from 'antd';
import { PlusOutlined, EditOutlined, UploadOutlined, EyeOutlined } from '@ant-design/icons';
import { COL } from '@/lib/constants';
import { todayStr, fyIdOf } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Guard } from '@/components/common';
import { saveSettings, saveMaster } from '@/services/masters';
import { uploadSettingsImage } from '@/services/documents';
import { donationReceiptPdf, paymentVoucherPdf } from '@/pdf/generate';
import { BackupCard } from '@/components/DataTools';
import { useLang } from '@/i18n/LangContext';

/** Upload saves the setting immediately (no need to press "Save settings") */
function ImageField({ value, onChange, keyName, field, label }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const [run, busy] = useAction();
  const setAndSave = (url) => run(async () => {
    await saveSettings({ [field]: url }, user);
    onChange(url);
  }, url ? 'Image saved' : 'Image removed');
  return (
    <Space orientation="vertical" size={4}>
      <span>{label}</span>
      {value ? <Image src={value} height={64} alt={label} /> : <div className="muted" style={{ height: 64, display: 'grid', placeItems: 'center', border: '1px dashed #ddd', width: 90 }}>{tr('none')}</div>}
      <Space>
        <Upload showUploadList={false} accept="image/png,image/jpeg,image/webp" beforeUpload={(f) => { run(async () => { const url = await uploadSettingsImage(f, keyName); await saveSettings({ [field]: url }, user); onChange(url); }, 'Image saved'); return false; }}>
          <Button size="small" icon={<UploadOutlined />} loading={busy}>{tr('Upload')}</Button>
        </Upload>
        {value ? <Button size="small" danger loading={busy} onClick={() => setAndSave('')}>{tr('Remove')}</Button> : null}
      </Space>
    </Space>
  );
}

function TrustProfile() {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  // live updates must not overwrite what the user is typing
  useEffect(() => {
    if (!form.isFieldsTouched()) form.setFieldsValue({ ...app.settings, invocationText: (app.settings.invocationLines || []).join('\n') });
  }, [app.settings, form]);
  const save = async () => {
    const v = await form.validateFields();
    const { invocationText, ...rest } = v;
    run(() => saveSettings({ ...rest, pan: (rest.pan || '').toUpperCase(), invocationLines: (invocationText || '').split('\n').map((x) => x.trim()).filter(Boolean) }, user), 'Settings saved');
  };
  const sample = (download) => {
    const s = { ...app.settings, ...form.getFieldsValue(), invocationLines: (form.getFieldValue('invocationText') || '').split('\n').filter(Boolean) };
    const cats = app.donationCategories.filter((c) => c.showOnReceipt);
    const date = todayStr();
    run(() => donationReceiptPdf({
      settings: s, categories: app.donationCategories, download,
      donation: {
        receiptNo: `${s.receiptPrefix}/${fyIdOf(date)}/00001`, date, financialYearId: fyIdOf(date), status: 'approved', amount: 5100, paymentMode: 'UPI', utr: '123456789012', purpose: 'Sample',
        donor: { name: 'नमूना दाता (Sample Donor)', address: 'अहमदाबाद', mobile: '9999999999' },
        lines: cats[0] ? [{ categoryId: cats[0].id, categoryName: cats[0].name, categoryNameHi: cats[0].nameHi, amount: 5100 }] : [],
      },
    }));
  };
  const sampleVoucher = () => {
    const s = { ...app.settings, ...form.getFieldsValue() };
    const date = todayStr();
    run(() => paymentVoucherPdf({
      settings: s,
      expense: { voucherNo: `${s.voucherPrefix}/${fyIdOf(date)}/00001`, date, financialYearId: fyIdOf(date), status: 'paid', amount: 2500, paymentMode: 'Cash', categoryName: 'Office Expense', categoryNameHi: 'कार्यालय खर्च', payee: { name: 'नमूना (Sample)' }, lines: [{ particulars: 'स्टेशनरी', amount: 2500 }] },
    }));
  };
  return (
    <Form form={form} layout="vertical">
      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card size="small" title={tr('Trust details')} style={{ marginBottom: 12 }}>
            <Form.Item name="name" label={tr('Trust name (Hindi – printed on receipts)')} rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="nameEn" label={tr('Trust name (English)')}><Input /></Form.Item>
            <Form.Item name="address" label={tr('Address')}><Input.TextArea rows={2} /></Form.Item>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="phones" label={tr('Contact numbers')}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="email" label={tr('Email')}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="website" label={tr('Website')}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="pan" label={tr('Trust PAN')}><Input style={{ textTransform: 'uppercase' }} /></Form.Item></Col>
              <Col span={12}><Form.Item name="registrationNo" label={tr('Registration no.')}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="registrationDate" label={tr('Registration date')}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="section12A" label={tr('12A / 12AB registration no.')}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="section80G" label={tr('80G registration no.')}><Input /></Form.Item></Col>
            </Row>
            <Form.Item name="taxDetails" label={tr('Other tax / registration details (CSR, FCRA…)')}><Input.TextArea rows={2} /></Form.Item>
          </Card>
          <Card size="small" title={tr('Office bearers')}>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="president" label={tr('President / Managing trustee')}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="secretary" label={tr('Secretary')}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="treasurer" label={tr('Treasurer')}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="auditor" label={tr('Auditor')}><Input /></Form.Item></Col>
              <Col span={24}><Form.Item name="authorizedSignatory" label={tr('Authorized signatory (printed under signature)')}><Input /></Form.Item></Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title={tr('Receipt & voucher')} style={{ marginBottom: 12 }} extra={<Space><Button size="small" icon={<EyeOutlined />} onClick={() => sample(false)}>{tr('Sample receipt')}</Button><Button size="small" icon={<EyeOutlined />} onClick={sampleVoucher}>{tr('Sample voucher')}</Button></Space>}>
            <Form.Item name="invocationText" label={tr('Top invocation lines (one per line)')}><Input.TextArea rows={2} placeholder="॥ श्री गणेशाय नमः ॥" /></Form.Item>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="receiptPrefix" label={tr('Receipt no. prefix')} rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="voucherPrefix" label={tr('Voucher no. prefix')} rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="receiptTitle" label={tr('Receipt title')}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="voucherTitle" label={tr('Voucher title')}><Input /></Form.Item></Col>
            </Row>
            <Form.Item name="receiptIntro" label={tr('Receipt intro line')}><Input /></Form.Item>
            <Form.Item name="receiptNote" label={tr('Statutory note on receipt (e.g. 80G text)')}><Input.TextArea rows={2} /></Form.Item>
            <Form.Item name="receiptBeforeApproval" label={tr('Receipt print before approval')}>
              <Select options={[{ value: 'provisional', label: tr('Allowed with “PROVISIONAL” watermark') }, { value: 'allow', label: tr('Allowed without watermark') }]} />
            </Form.Item>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{tr('Receipt numbers:')}{' '}{app.settings.receiptPrefix}/{app.selectedFyId || fyIdOf(todayStr())}/00001 – {tr('restart every financial year, issued atomically (no duplicates).')}</Typography.Text>
          </Card>
          <Card size="small" title={tr('Logo & images (receipt, voucher, reports)')} style={{ marginBottom: 12 }}>
            <Space wrap size={24}>
              <Form.Item name="logoUrl" noStyle><ImageField keyName="logo" field="logoUrl" label={tr('Logo')} /></Form.Item>
              <Form.Item name="leftImageUrl" noStyle><ImageField keyName="left" field="leftImageUrl" label={tr('Left image')} /></Form.Item>
              <Form.Item name="rightImageUrl" noStyle><ImageField keyName="right" field="rightImageUrl" label={tr('Right image')} /></Form.Item>
              <Form.Item name="signatureUrl" noStyle><ImageField keyName="signature" field="signatureUrl" label={tr('Signature')} /></Form.Item>
              <Form.Item name="stampUrl" noStyle><ImageField keyName="stamp" field="stampUrl" label={tr('Stamp')} /></Form.Item>
            </Space>
            <Alert
              style={{ marginTop: 12 }}
              type="info"
              showIcon
              title={tr('Images are saved as soon as they are uploaded. Logo prints on reports, and on receipts / vouchers when no left image is set. Signature & stamp: PNG with transparent background looks best.')}
            />
          </Card>
          <Card size="small" title={tr('Limits & alerts')}>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="largeExpenseThreshold" label={tr('Large expense alert (₹)')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
              <Col span={12}><Form.Item name="cashLimitWarning" label={tr('Cash donation warning above (₹)')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
              <Col span={12}><Form.Item name="idleMinutes" label={tr('Auto sign-out after idle minutes (0 = never)')} initialValue={30}><InputNumber min={0} max={720} style={{ width: '100%' }} /></Form.Item></Col>
            </Row>
          </Card>
        </Col>
      </Row>
      <Button type="primary" size="large" onClick={save} loading={busy} style={{ marginTop: 12 }}>{tr('Save settings')}</Button>
    </Form>
  );
}

function CategoryTab({ kind }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const app = useAppData();
  const coll = kind === 'donation' ? COL.donationCategories : COL.expenseCategories;
  const rows = kind === 'donation' ? app.donationCategories : app.expenseCategories;
  const [edit, setEdit] = useState(null);
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const open = (r) => {
    setEdit(r || {});
    form.resetFields(); // never carry values over from the previously edited category
    form.setFieldsValue(r ? { isCorpus: false, isCapital: false, showOnReceipt: false, ...r } : { active: true, order: rows.length + 1 });
  };
  const save = async () => {
    const v = await form.validateFields();
    if (await run(() => saveMaster(coll, edit.id, { ...v, defaultFundId: v.defaultFundId || null }, user), 'Saved')) setEdit(null);
  };
  return (
    <>
      <Space style={{ marginBottom: 12 }}><Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>{tr('Add category')}</Button></Space>
      <Table
        rowKey="id"
        size="small"
        dataSource={rows}
        pagination={false}
        scroll={{ x: 700 }}
        columns={[
          { title: '#', dataIndex: 'order', width: 50 },
          { title: tr('Name'), dataIndex: 'name' },
          { title: tr('Hindi name (receipt)'), dataIndex: 'nameHi' },
          ...(kind === 'donation' ? [
            { title: tr('On receipt'), dataIndex: 'showOnReceipt', render: (v) => (v ? '✓' : ''), width: 90 },
            { title: tr('Corpus'), dataIndex: 'isCorpus', render: (v) => (v ? '✓' : ''), width: 80 },
            { title: tr('Default fund'), dataIndex: 'defaultFundId', render: (v) => app.fundName(v) },
          ] : [{ title: tr('Capital (asset)'), dataIndex: 'isCapital', render: (v) => (v ? '✓' : ''), width: 110 }]),
          { title: tr('Active'), dataIndex: 'active', render: (v) => (v === false ? tr('Disabled') : '✓'), width: 80 },
          { title: '', width: 50, render: (_, r) => <Button size="small" icon={<EditOutlined />} onClick={() => open(r)} /> },
        ]}
      />
      <Modal open={!!edit} onCancel={() => setEdit(null)} onOk={save} confirmLoading={busy} title={edit?.id ? tr('Edit category') : tr('Add category')} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={tr('Name (English)')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="nameHi" label={tr('Name (Hindi – printed on receipt / voucher)')}><Input /></Form.Item>
          <Form.Item name="order" label={tr('Display order')}><InputNumber min={1} /></Form.Item>
          {kind === 'donation' ? (
            <>
              <Form.Item name="showOnReceipt" label={tr('Always print as a checkbox row on the receipt')} valuePropName="checked"><Switch /></Form.Item>
              <Form.Item name="isCorpus" label={tr('Corpus donation (capital – not income)')} valuePropName="checked"><Switch /></Form.Item>
              <Form.Item name="defaultFundId" label={tr('Default fund / project')}><Select allowClear options={app.funds.map((f) => ({ value: f.id, label: f.name }))} /></Form.Item>
            </>
          ) : (
            <Form.Item name="isCapital" label={tr('Capital expenditure (asset purchase)')} valuePropName="checked"><Switch /></Form.Item>
          )}
          <Form.Item name="active" label={tr('Active (disable instead of delete)')} valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default function SettingsPage() {
  const { t: tr } = useLang();
  return (
    <Guard perm="settings.manage">
      <PageHeader title={tr('Settings')} subtitle={tr('Trust master settings, receipt format and categories')} extra={[<Link key="b" href="/bank-accounts"><Button>{tr('Bank accounts')}</Button></Link>, <Link key="f" href="/funds"><Button>{tr('Funds / projects')}</Button></Link>, <Link key="y" href="/financial-years"><Button>{tr('Financial years')}</Button></Link>]} />
      <Card>
        <Tabs
          items={[
            { key: 't', label: tr('Trust profile & receipt'), children: <TrustProfile /> },
            { key: 'd', label: tr('Donation categories'), children: <CategoryTab kind="donation" /> },
            { key: 'e', label: tr('Expense categories'), children: <CategoryTab kind="expense" /> },
            { key: 'b', label: tr('Backup'), children: <BackupCard /> },
          ]}
        />
      </Card>
    </Guard>
  );
}

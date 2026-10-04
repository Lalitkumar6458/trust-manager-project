'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Form, Input, Select, DatePicker, InputNumber, Button, Card, Row, Col, Radio, Alert, Space, Divider, Typography,
} from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { DONOR_TYPES, PAYMENT_MODES, ID_TYPES, isCashMode } from '@/lib/constants';
import { money, sum, PAN_REGEX, MOBILE_REGEX, todayStr } from '@/lib/format';
import { amountInWordsEn, amountInWordsHi } from '@/lib/amountInWords';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { createDonation, updateDonation } from '@/services/donations';
import PartySelect from './PartySelect';
import { useLang } from '@/i18n/LangContext';

export default function DonationForm({ donation }) {
  const { t: tr, lang } = useLang();
  const router = useRouter();
  const { user, can } = useAuth();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const editing = !!donation;
  const [donorMode, setDonorMode] = useState(editing ? 'existing' : 'existing');

  const lines = Form.useWatch('lines', form) || [];
  const mode = Form.useWatch('paymentMode', form);
  const total = sum(lines, (l) => l?.amount || 0);
  const accounts = useMemo(
    () => app.activeAccounts.filter((a) => (mode ? (isCashMode(mode) ? a.type === 'cash' : a.type === 'bank') : true)),
    [app.activeAccounts, mode],
  );

  useEffect(() => {
    if (donation) {
      form.setFieldsValue({
        ...donation,
        date: dayjs(donation.date),
        chequeDate: donation.chequeDate ? dayjs(donation.chequeDate) : null,
        txnDate: donation.txnDate ? dayjs(donation.txnDate) : null,
        lines: donation.lines.map((l) => ({ categoryId: l.categoryId, amount: l.amount, fundId: l.fundId, description: l.description })),
      });
    }
  }, [donation, form]);

  // /donations/new?donor=<id> (from the donor page) → donor preselected
  useEffect(() => {
    if (donation) return;
    const d = new URLSearchParams(window.location.search).get('donor');
    if (d) form.setFieldValue('donorId', d);
  }, [donation, form]);

  // pick the only matching account automatically
  useEffect(() => {
    const cur = form.getFieldValue('accountId');
    if (accounts.length === 1 && cur !== accounts[0].id) form.setFieldValue('accountId', accounts[0].id);
    else if (cur && !accounts.some((a) => a.id === cur)) form.setFieldValue('accountId', undefined);
  }, [accounts, form]);

  const onCategory = (idx, catId) => {
    const c = app.donationCategories.find((x) => x.id === catId);
    if (c?.defaultFundId) form.setFieldValue(['lines', idx, 'fundId'], c.defaultFundId);
  };

  const save = async (action) => {
    let v;
    try { v = await form.validateFields(); } catch (e) { if (e?.errorFields?.[0]) form.scrollToField(e.errorFields[0].name); return; }
    const input = {
      ...v,
      date: v.date.format('YYYY-MM-DD'),
      chequeDate: v.chequeDate ? v.chequeDate.format('YYYY-MM-DD') : null,
      txnDate: v.txnDate ? v.txnDate.format('YYYY-MM-DD') : null,
      donorId: donorMode === 'existing' ? v.donorId : null,
      newDonor: donorMode === 'new' ? { ...v.newDonor, pan: (v.newDonor?.pan || '').toUpperCase() } : null,
    };
    const ctx = {
      user, categories: app.donationCategories, accounts: app.accounts, settings: app.settings,
      submit: action !== 'draft', approveNow: action === 'approve',
    };
    if (editing) {
      const ok = await run(() => updateDonation(donation.id, input, ctx), 'Donation updated');
      if (ok) router.push(`/donations/${donation.id}`);
    } else {
      let savedId = null;
      const id = await run(async () => {
        try { return await createDonation(input, ctx); } catch (e) { savedId = e.createdId || null; throw e; }
      }, action === 'approve' ? tr('Donation saved & approved') : action === 'draft' ? tr('Draft saved') : tr('Donation submitted for verification'));
      if (id) router.push(`/donations/${id}`);
      else if (savedId) router.push(`/donations/${savedId}`); // saved, a later step failed – open it, never re-submit
    }
  };

  const cashWarn = isCashMode(mode) && total > Number(app.settings.cashLimitWarning || 2000);

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ date: dayjs(todayStr()), paymentMode: 'Cash', lines: [{}], newDonor: { donorType: 'Individual' } }}
      scrollToFirstError
    >
      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Card title={tr('Donor (दाता)')} size="small" style={{ marginBottom: 16 }}>
            {!editing ? (
              <Radio.Group value={donorMode} onChange={(e) => setDonorMode(e.target.value)} style={{ marginBottom: 12 }} optionType="button" buttonStyle="solid"
                options={[{ value: 'existing', label: tr('Existing donor') }, { value: 'new', label: tr('New donor') }]}
              />
            ) : null}
            {donorMode === 'existing' ? (
              <Form.Item name="donorId" label={tr('Donor')} rules={[{ required: true, message: tr('Select donor or choose “New donor”') }]}>
                <PartySelect kind="donor" />
              </Form.Item>
            ) : (
              <Row gutter={12}>
                <Col xs={24} md={12}><Form.Item name={['newDonor', 'name']} label={tr('Name (श्री)')} rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['newDonor', 'donorType']} label={tr('Donor type')}><Select options={DONOR_TYPES.map((d) => ({ value: d, label: tr(d) }))} /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['newDonor', 'organizationName']} label={tr('Organization name')}><Input /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['newDonor', 'mobile']} label={tr('Mobile')} rules={[{ pattern: MOBILE_REGEX, message: tr('10 digit mobile') }]}><Input maxLength={10} /></Form.Item></Col>
                <Col xs={24}><Form.Item name={['newDonor', 'address']} label={tr('Address (पता)')}><Input.TextArea rows={2} /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['newDonor', 'email']} label={tr('Email')} rules={[{ type: 'email' }]}><Input /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['newDonor', 'pan']} label={tr('PAN')} rules={[{ validator: (_, v) => (!v || PAN_REGEX.test(v.toUpperCase()) ? Promise.resolve() : Promise.reject(new Error('Invalid PAN / अमान्य PAN'))) }]}><Input style={{ textTransform: 'uppercase' }} maxLength={10} /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['newDonor', 'idType']} label={tr('Other ID (optional)')}><Select allowClear options={ID_TYPES.map((d) => ({ value: d, label: tr(d) }))} /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['newDonor', 'idNumber']} label={tr('ID number')} extra={tr('Store Aadhaar only where legally required. Shown masked.')}><Input /></Form.Item></Col>
              </Row>
            )}
          </Card>

          <Card title={tr('Donation details (विगत)')} size="small" style={{ marginBottom: 16 }}>
            <Form.List name="lines">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name }) => (
                    <Row gutter={8} key={key} align="top">
                      <Col xs={24} md={9}>
                        <Form.Item name={[name, 'categoryId']} rules={[{ required: true, message: tr('Category') }]} label={name === 0 ? tr('Category') : null}>
                          <Select showSearch={{ optionFilterProp: 'label' }} placeholder={tr('Category')} onChange={(v) => onCategory(name, v)}
                            options={app.activeDonationCategories.map((c) => ({ value: c.id, label: `${c.name}${c.nameHi ? ` – ${c.nameHi}` : ''}` }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={6}>
                        <Form.Item name={[name, 'amount']} rules={[{ required: true, message: tr('Amount') }]} label={name === 0 ? tr('Amount (₹)') : null}>
                          <InputNumber min={0.01} step={100} style={{ width: '100%' }} precision={2} />
                        </Form.Item>
                      </Col>
                      <Col xs={10} md={7}>
                        <Form.Item name={[name, 'fundId']} label={name === 0 ? tr('Fund / Project') : null}>
                          <Select allowClear placeholder={tr('General')} options={app.activeFunds.map((f) => ({ value: f.id, label: f.name }))} />
                        </Form.Item>
                      </Col>
                      <Col xs={2} md={2} style={{ paddingTop: name === 0 ? 34 : 6 }}>
                        {fields.length > 1 ? <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#a8071a' }} /> : null}
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})}>{tr('Add another category')}</Button>
                </>
              )}
            </Form.List>
            <Divider style={{ margin: '12px 0' }} />
            <Typography.Title level={4} style={{ margin: 0 }}>{tr('Total:')}{' '}{money(total)}</Typography.Title>
            <Typography.Text type="secondary">{total ? (lang === 'hi' ? amountInWordsHi(total) : amountInWordsEn(total)) : ''}</Typography.Text>
            <Form.Item name="purpose" label={tr('Purpose / उद्देश्य')} style={{ marginTop: 12 }}><Input placeholder={tr('e.g. Annual Gau Seva, Marriage of …')} /></Form.Item>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title={tr('Receipt & payment')} size="small" style={{ marginBottom: 16 }}>
            <Form.Item name="date" label={tr('Donation date')} rules={[{ required: true }]}>
              <DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
            </Form.Item>
            <Form.Item name="paymentMode" label={tr('Payment mode')} rules={[{ required: true }]}>
              <Select options={PAYMENT_MODES.map((m) => ({ value: m, label: tr(m) }))} />
            </Form.Item>
            <Form.Item name="accountId" label={isCashMode(mode) ? tr('Cash account') : tr('Received in bank account')} rules={[{ required: true }]}>
              <Select options={accounts.map((a) => ({ value: a.id, label: a.name }))} placeholder={tr('Select account')} />
            </Form.Item>
            {!isCashMode(mode) ? (
              <>
                {mode === 'Cheque' || mode === 'Demand Draft' ? (
                  <Row gutter={8}>
                    <Col span={12}><Form.Item name="chequeNo" label={tr('Cheque / DD no.')} rules={[{ required: true }]}><Input /></Form.Item></Col>
                    <Col span={12}><Form.Item name="chequeDate" label={tr('Cheque date')}><DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} /></Form.Item></Col>
                  </Row>
                ) : (
                  <Form.Item name="utr" label={tr('Transaction ID / UTR')} rules={[{ required: true, message: tr('UTR / transaction id is required for online payments') }]}><Input /></Form.Item>
                )}
                <Form.Item name="bankName" label={tr('Donor\'s bank name')}><Input /></Form.Item>
                <Form.Item name="txnDate" label={tr('Transaction date')}><DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} /></Form.Item>
              </>
            ) : null}
            <Form.Item name="donorRefNo" label={tr('Donor reference no.')}><Input /></Form.Item>
            <Form.Item name="remarks" label={tr('Remarks')}><Input.TextArea rows={2} /></Form.Item>
            {cashWarn ? <Alert type="warning" showIcon title={`Cash donation above ₹${app.settings.cashLimitWarning || 2000}`} description={tr('Cash donations above this limit are not eligible for 80G deduction. Prefer bank / UPI and record donor PAN.')} style={{ marginBottom: 12 }} /> : null}
            {editing && donation.status !== 'draft' ? (
              <Form.Item name="reason" label={tr('Reason for change (audit trail)')} rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
            ) : null}
          </Card>
          <Card size="small">
            <Space wrap>
              {editing ? (
                <Button type="primary" loading={busy} onClick={() => save('update')}>{tr('Save changes')}</Button>
              ) : (
                <>
                  <Button loading={busy} onClick={() => save('draft')}>{tr('Save draft')}</Button>
                  <Button type="primary" loading={busy} onClick={() => save('submit')}>{tr('Save & submit')}</Button>
                  {can('donations.verify') && can('donations.approve') ? <Button type="primary" ghost loading={busy} onClick={() => save('approve')}>{tr('Save, verify & approve')}</Button> : null}
                </>
              )}
              <Button onClick={() => router.back()}>{tr('Cancel')}</Button>
            </Space>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {tr('Receipt number is issued on submit. Ledger & balance update on approval (Draft → Submitted → Verified → Approved).')}
            </div>
          </Card>
        </Col>
      </Row>
    </Form>
  );
}

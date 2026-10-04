'use client';

import { Modal, Form, Input, Select, InputNumber, DatePicker, Row, Col } from 'antd';
import dayjs from 'dayjs';
import { COL, ACCOUNT_TYPES } from '@/lib/constants';
import { IFSC_REGEX } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { createAccount, changeOpeningBalance, saveMaster } from '@/services/masters';
import { fyOpeningFor } from '@/services/ledger';
import { useLang } from '@/i18n/LangContext';

export function AccountModal({ open, onClose, type = 'bank', account }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const submit = async () => {
    const v = await form.validateFields();
    let ok;
    if (account) {
      const { openingBalance, openingDate, ...rest } = v;
      ok = await run(() => saveMaster(COL.accounts, account.id, rest, user), 'Account updated');
    } else {
      ok = await run(() => createAccount({ ...v, type, openingDate: v.openingDate.format('YYYY-MM-DD'), ifsc: (v.ifsc || '').toUpperCase() }, user), 'Account created');
    }
    if (ok) onClose();
  };
  return (
    <Modal open={open} onCancel={onClose} onOk={submit} confirmLoading={busy} title={account ? tr('Edit {v0}', { v0: account.name }) : type === 'bank' ? tr('Add bank account') : tr('Add cash account')} width={640} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={account || { accountType: 'Savings', openingBalance: 0, openingDate: dayjs(app.currentFy?.startDate) }}
      >
        <Form.Item name="name" label={tr('Display name')} rules={[{ required: true }]} extra={tr('e.g. HDFC Bank – Trust Account')}><Input /></Form.Item>
        {type === 'bank' ? (
          <Row gutter={12}>
            <Col xs={24} md={12}><Form.Item name="bankName" label={tr('Bank name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="branch" label={tr('Branch')}><Input /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="accountName" label={tr('Account holder name')}><Input /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="accountNumber" label={tr('Account number')} rules={[{ required: true }]} extra={tr('Masked everywhere in the UI')}><Input /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="ifsc" label={tr('IFSC')} rules={[{ validator: (_, val) => (!val || IFSC_REGEX.test(String(val).toUpperCase()) ? Promise.resolve() : Promise.reject(new Error('Invalid IFSC / अमान्य IFSC'))) }]}><Input style={{ textTransform: 'uppercase' }} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="accountType" label={tr('Account type')}><Select options={ACCOUNT_TYPES.map((a) => ({ value: a, label: tr(a) }))} /></Form.Item></Col>
          </Row>
        ) : (
          <Form.Item name="custodian" label={tr('Cash custodian (person responsible)')}><Input /></Form.Item>
        )}
        {!account ? (
          <Row gutter={12}>
            <Col xs={24} md={12}><Form.Item name="openingBalance" label={tr('Opening balance (₹)')} rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} precision={2} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="openingDate" label={tr('Opening balance as on')} rules={[{ required: true }]} extra={tr('Usually 1st April of the FY')}><DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
        ) : null}
        <Form.Item name="notes" label={tr('Notes')}><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}

export function OpeningModal({ account, onClose }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const fy = app.selectedFy;
  const submit = async () => {
    const v = await form.validateFields();
    const ok = await run(() => changeOpeningBalance(account.id, fy.id, v.amount, v.reason, user), 'Opening balance updated');
    if (ok) onClose();
  };
  return (
    <Modal open={!!account} onCancel={onClose} onOk={submit} confirmLoading={busy} title={tr('Opening balance – {v0} (FY {v1})', { v0: account?.name, v1: fy?.id })} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ amount: account ? fyOpeningFor(fy, account) : 0 }}>
        <Form.Item name="amount" label={tr('Opening balance (₹)')} rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} precision={2} /></Form.Item>
        <Form.Item name="reason" label={tr('Reason (audit trail)')} rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}

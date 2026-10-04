'use client';

import { useEffect } from 'react';
import { Modal, Form, Input, Select, Row, Col } from 'antd';
import { DONOR_TYPES, ID_TYPES, PAYEE_TYPES } from '@/lib/constants';
import { PAN_REGEX, MOBILE_REGEX, IFSC_REGEX, GST_REGEX } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { saveDonor, saveBeneficiary } from '@/services/masters';
import { useLang } from '@/i18n/LangContext';

const panRule = { validator: (_, v) => (!v || PAN_REGEX.test(String(v).toUpperCase()) ? Promise.resolve() : Promise.reject(new Error('Invalid PAN / अमान्य PAN'))) };
const ifscRule = { validator: (_, v) => (!v || IFSC_REGEX.test(String(v).toUpperCase()) ? Promise.resolve() : Promise.reject(new Error('Invalid IFSC / अमान्य IFSC'))) };
const gstRule = { validator: (_, v) => (!v || GST_REGEX.test(String(v).toUpperCase()) ? Promise.resolve() : Promise.reject(new Error('Invalid GSTIN / अमान्य GSTIN'))) };
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? '']));

const DONOR_FIELDS = ['name', 'organizationName', 'donorType', 'mobile', 'email', 'address', 'pan', 'idType', 'idNumber', 'notes'];
const PAYEE_FIELDS = ['name', 'type', 'mobile', 'email', 'address', 'pan', 'gstin', 'bankAccountNo', 'ifsc', 'bankName', 'notes'];

export function DonorModal({ open, onClose, donor, onSaved }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  useEffect(() => {
    if (open) form.setFieldsValue(donor ? pick(donor, DONOR_FIELDS) : { donorType: 'Individual' });
  }, [open, donor, form]);
  const submit = async () => {
    const v = await form.validateFields();
    const id = await run(() => saveDonor(donor?.id, v, user), donor ? tr('Donor updated') : tr('Donor added'));
    if (id) {
      onSaved?.(id);
      onClose();
    }
  };
  return (
    <Modal open={open} onCancel={onClose} onOk={submit} confirmLoading={busy} title={donor ? tr('Edit donor {v0}', { v0: donor.donorCode || '' }) : tr('New donor')} width={720} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col xs={24} md={12}><Form.Item name="name" label={tr('Name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="donorType" label={tr('Donor type')}><Select options={DONOR_TYPES.map((d) => ({ value: d, label: tr(d) }))} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="organizationName" label={tr('Organization name')}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="mobile" label={tr('Mobile')} rules={[{ pattern: MOBILE_REGEX, message: tr('10 digit mobile') }]}><Input maxLength={10} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="email" label={tr('Email')} rules={[{ type: 'email' }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="pan" label={tr('PAN')} rules={[panRule]}><Input style={{ textTransform: 'uppercase' }} maxLength={10} /></Form.Item></Col>
          <Col xs={24}><Form.Item name="address" label={tr('Address')}><Input.TextArea rows={2} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="idType" label={tr('Other ID type')}><Select allowClear options={ID_TYPES.map((d) => ({ value: d, label: tr(d) }))} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="idNumber" label={tr('ID number')} extra={tr('Collect Aadhaar only where legally appropriate.')}><Input /></Form.Item></Col>
          <Col xs={24}><Form.Item name="notes" label={tr('Notes')}><Input.TextArea rows={2} /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}

export function PayeeModal({ open, onClose, payee, defaultType = 'beneficiary', onSaved }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  useEffect(() => {
    if (open) form.setFieldsValue(payee ? pick(payee, PAYEE_FIELDS) : { type: defaultType });
  }, [open, payee, form, defaultType]);
  const submit = async () => {
    const v = await form.validateFields();
    const id = await run(() => saveBeneficiary(payee?.id, v, user), payee ? tr('Updated') : tr('Added'));
    if (id) {
      onSaved?.(id);
      onClose();
    }
  };
  return (
    <Modal open={open} onCancel={onClose} onOk={submit} confirmLoading={busy} title={payee ? tr('Edit {v0}', { v0: payee.name }) : tr('New beneficiary / vendor')} width={720} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col xs={24} md={12}><Form.Item name="name" label={tr('Name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="type" label={tr('Type')}><Select options={PAYEE_TYPES.map((o) => ({ ...o, label: tr(o.label) }))} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="mobile" label={tr('Mobile')} rules={[{ pattern: MOBILE_REGEX, message: tr('10 digit mobile') }]}><Input maxLength={10} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="email" label={tr('Email')} rules={[{ type: 'email' }]}><Input /></Form.Item></Col>
          <Col xs={24}><Form.Item name="address" label={tr('Address')}><Input.TextArea rows={2} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="pan" label={tr('PAN')} rules={[panRule]}><Input style={{ textTransform: 'uppercase' }} maxLength={10} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="gstin" label={tr('GSTIN')} rules={[gstRule]}><Input style={{ textTransform: 'uppercase' }} maxLength={15} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="bankAccountNo" label={tr('Bank A/c no.')} extra={tr('Shown masked')}><Input /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="ifsc" label={tr('IFSC')} rules={[ifscRule]}><Input style={{ textTransform: 'uppercase' }} maxLength={11} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="bankName" label={tr('Bank name')}><Input /></Form.Item></Col>
          <Col xs={24}><Form.Item name="notes" label={tr('Notes')}><Input.TextArea rows={2} /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}

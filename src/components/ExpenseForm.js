'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Form, Input, Select, DatePicker, InputNumber, Button, Card, Row, Col, Radio, Alert, Space, Divider, Typography,
} from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { PAYMENT_MODES, PAYEE_TYPES, isCashMode } from '@/lib/constants';
import { money, sum, PAN_REGEX, MOBILE_REGEX, IFSC_REGEX, todayStr } from '@/lib/format';
import { amountInWordsEn, amountInWordsHi } from '@/lib/amountInWords';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { createExpense, updateExpense } from '@/services/expenses';
import PartySelect from './PartySelect';
import { useLang } from '@/i18n/LangContext';

export default function ExpenseForm({ expense }) {
  const { t: tr, lang } = useLang();
  const router = useRouter();
  const { user, can } = useAuth();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const editing = !!expense;
  const [payeeMode, setPayeeMode] = useState('existing');

  const lines = Form.useWatch('lines', form) || [];
  const mode = Form.useWatch('paymentMode', form);
  const accountId = Form.useWatch('accountId', form);
  const total = sum(lines, (l) => l?.amount || 0);
  const accounts = useMemo(
    () => app.activeAccounts.filter((a) => (mode ? (isCashMode(mode) ? a.type === 'cash' : a.type === 'bank') : true)),
    [app.activeAccounts, mode],
  );
  const acc = app.accounts.find((a) => a.id === accountId);
  const fund = app.funds.find((f) => f.id === Form.useWatch('fundId', form));

  useEffect(() => {
    if (expense) {
      form.setFieldsValue({
        ...expense,
        date: dayjs(expense.date),
        chequeDate: expense.chequeDate ? dayjs(expense.chequeDate) : null,
        billDate: expense.billDate ? dayjs(expense.billDate) : null,
      });
    }
  }, [expense, form]);

  useEffect(() => {
    const cur = form.getFieldValue('accountId');
    if (accounts.length === 1 && cur !== accounts[0].id) form.setFieldValue('accountId', accounts[0].id);
    else if (cur && !accounts.some((a) => a.id === cur)) form.setFieldValue('accountId', undefined);
  }, [accounts, form]);

  const save = async (action) => {
    let v;
    try { v = await form.validateFields(); } catch (e) { if (e?.errorFields?.[0]) form.scrollToField(e.errorFields[0].name); return; }
    const input = {
      ...v,
      date: v.date.format('YYYY-MM-DD'),
      chequeDate: v.chequeDate ? v.chequeDate.format('YYYY-MM-DD') : null,
      billDate: v.billDate ? v.billDate.format('YYYY-MM-DD') : null,
      payeeId: payeeMode === 'existing' ? v.payeeId : null,
      newPayee: payeeMode === 'new' ? v.newPayee : null,
    };
    const ctx = {
      user, categories: app.expenseCategories, accounts: app.accounts, funds: app.funds, settings: app.settings,
      submit: action !== 'draft', approveNow: action === 'approve' || action === 'pay', payNow: action === 'pay',
    };
    if (editing) {
      const ok = await run(() => updateExpense(expense.id, input, ctx), 'Expense updated');
      if (ok) router.push(`/expenses/${expense.id}`);
    } else {
      let savedId = null;
      const id = await run(async () => {
        try { return await createExpense(input, ctx); } catch (e) { savedId = e.createdId || null; throw e; }
      }, action === 'pay' ? tr('Expense saved, approved & paid') : action === 'draft' ? tr('Draft saved') : tr('Submitted for approval'));
      if (id) router.push(`/expenses/${id}`);
      else if (savedId) router.push(`/expenses/${savedId}`); // saved, a later step failed – open it, never re-submit
    }
  };

  const fundBalance = fund ? (fund.received || 0) - (fund.spent || 0) : null;

  return (
    <Form form={form} layout="vertical" initialValues={{ date: dayjs(todayStr()), paymentMode: 'Bank Transfer', lines: [{}], newPayee: { type: 'beneficiary' } }} scrollToFirstError>
      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Card title={tr('Paid to (श्री / नाम)')} size="small" style={{ marginBottom: 16 }}>
            {!editing ? (
              <Radio.Group value={payeeMode} onChange={(e) => setPayeeMode(e.target.value)} style={{ marginBottom: 12 }} optionType="button" buttonStyle="solid"
                options={[{ value: 'existing', label: tr('Existing beneficiary / vendor') }, { value: 'new', label: tr('New') }]}
              />
            ) : null}
            {payeeMode === 'existing' ? (
              <Form.Item name="payeeId" label={tr('Beneficiary / vendor')} rules={[{ required: true, message: tr('Select payee or choose “New”') }]}>
                <PartySelect kind="payee" />
              </Form.Item>
            ) : (
              <Row gutter={12}>
                <Col xs={24} md={12}><Form.Item name={['newPayee', 'name']} label={tr('Name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['newPayee', 'type']} label={tr('Type')}><Select options={PAYEE_TYPES.map((o) => ({ ...o, label: tr(o.label) }))} /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['newPayee', 'mobile']} label={tr('Mobile')} rules={[{ pattern: MOBILE_REGEX, message: tr('10 digit mobile') }]}><Input maxLength={10} /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['newPayee', 'pan']} label={tr('PAN')} rules={[{ validator: (_, v) => (!v || PAN_REGEX.test(v.toUpperCase()) ? Promise.resolve() : Promise.reject(new Error('Invalid PAN / अमान्य PAN'))) }]}><Input style={{ textTransform: 'uppercase' }} maxLength={10} /></Form.Item></Col>
                <Col xs={24}><Form.Item name={['newPayee', 'address']} label={tr('Address')}><Input.TextArea rows={2} /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={['newPayee', 'gstin']} label={tr('GSTIN')}><Input style={{ textTransform: 'uppercase' }} /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={['newPayee', 'bankAccountNo']} label={tr('Bank A/c no.')}><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item name={['newPayee', 'ifsc']} label={tr('IFSC')} rules={[{ validator: (_, v) => (!v || IFSC_REGEX.test(v.toUpperCase()) ? Promise.resolve() : Promise.reject(new Error('Invalid IFSC / अमान्य IFSC'))) }]}><Input style={{ textTransform: 'uppercase' }} /></Form.Item></Col>
              </Row>
            )}
          </Card>

          <Card title={tr('Particulars (विवरण / विगत)')} size="small" style={{ marginBottom: 16 }}>
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Form.Item name="categoryId" label={tr('Expense category')} rules={[{ required: true }]}>
                  <Select showSearch={{ optionFilterProp: 'label' }} options={app.activeExpenseCategories.map((c) => ({ value: c.id, label: `${c.name}${c.nameHi ? ` – ${c.nameHi}` : ''}` }))} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="fundId" label={tr('Fund / Project (optional)')} extra={fund ? tr('Available in fund: {v0}', { v0: money(fundBalance) }) : null}>
                  <Select allowClear options={app.activeFunds.map((f) => ({ value: f.id, label: f.name }))} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="purpose" label={tr('Purpose')}><Input placeholder={tr('e.g. Medical assistance for operation of …')} /></Form.Item>
            <Form.List name="lines">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name }) => (
                    <Row gutter={8} key={key}>
                      <Col xs={24} md={15}>
                        <Form.Item name={[name, 'particulars']} label={name === 0 ? tr('Particulars') : null} rules={[{ required: true, whitespace: true, message: tr('Particulars') }]}>
                          <Input placeholder={`Line ${name + 1}`} />
                        </Form.Item>
                      </Col>
                      <Col xs={20} md={7}>
                        <Form.Item name={[name, 'amount']} label={name === 0 ? tr('Amount (₹)') : null} rules={[{ required: true, message: tr('Amount') }]}>
                          <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={4} md={2} style={{ paddingTop: name === 0 ? 34 : 6 }}>
                        {fields.length > 1 ? <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#a8071a' }} /> : null}
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})}>{tr('Add line')}</Button>
                </>
              )}
            </Form.List>
            <Divider style={{ margin: '12px 0' }} />
            <Typography.Title level={4} style={{ margin: 0 }}>{tr('Total:')}{' '}{money(total)}</Typography.Title>
            <Typography.Text type="secondary">{total ? (lang === 'hi' ? amountInWordsHi(total) : amountInWordsEn(total)) : ''}</Typography.Text>
            {fund && total > fundBalance ? <Alert style={{ marginTop: 8 }} type="warning" showIcon title={tr('Amount exceeds the available balance of the selected fund')} /> : null}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title={tr('Voucher & payment')} size="small" style={{ marginBottom: 16 }}>
            <Form.Item name="date" label={tr('Expense / payment date')} rules={[{ required: true }]}>
              <DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
            </Form.Item>
            <Form.Item name="paymentMode" label={tr('Payment mode')} rules={[{ required: true }]}>
              <Select options={PAYMENT_MODES.map((m) => ({ value: m, label: tr(m) }))} />
            </Form.Item>
            <Form.Item name="accountId" label={isCashMode(mode) ? tr('Paid from cash account') : tr('Paid from bank account')} rules={[{ required: true }]} extra={acc && can('accounts.view') ? tr('Current balance: {v0}', { v0: money(acc.currentBalance) }) : null}>
              <Select options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
            </Form.Item>
            {isCashMode(mode) ? (
              <Form.Item name="cashRef" label={tr('Cash reference / receipt no.')}><Input /></Form.Item>
            ) : mode === 'Cheque' || mode === 'Demand Draft' ? (
              <Row gutter={8}>
                <Col span={12}><Form.Item name="chequeNo" label={tr('Cheque no.')}><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="chequeDate" label={tr('Cheque date')}><DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} /></Form.Item></Col>
              </Row>
            ) : (
              <Form.Item name="utr" label={tr('UTR / Transaction ID')} extra={tr('Can be filled when marking as paid')}><Input /></Form.Item>
            )}
            <Row gutter={8}>
              <Col span={12}><Form.Item name="billNo" label={tr('Bill / Invoice no.')}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="billDate" label={tr('Bill date')}><DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} /></Form.Item></Col>
            </Row>
            <Form.Item name="projectName" label={tr('Project / Program')}><Input placeholder={tr('Defaults to fund name')} /></Form.Item>
            <Form.Item name="remarks" label={tr('Remarks')}><Input.TextArea rows={2} /></Form.Item>
            {total >= Number(app.settings.largeExpenseThreshold || Infinity) ? <Alert type="info" showIcon title={`Large expense (≥ ₹${app.settings.largeExpenseThreshold}) – admins will be notified.`} style={{ marginBottom: 12 }} /> : null}
            {editing && expense.status !== 'draft' ? (
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
                  <Button type="primary" loading={busy} onClick={() => save('submit')}>{tr('Save & submit for approval')}</Button>
                  {can('expenses.approve') && can('expenses.pay') ? <Button type="primary" ghost loading={busy} onClick={() => save('pay')}>{tr('Save, approve & mark paid')}</Button> : null}
                </>
              )}
              <Button onClick={() => router.back()}>{tr('Cancel')}</Button>
            </Space>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{tr('Workflow: Draft → Submitted → Approved → Paid. Ledger & balance update when marked Paid.')}</div>
          </Card>
        </Col>
      </Row>
    </Form>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import {
  Card, Table, Button, Tabs, Modal, Form, Input, InputNumber, Select, Row, Col, Tag, Space, DatePicker, Typography, Statistic, Alert,
} from 'antd';
import { PlusOutlined, EditOutlined, CalculatorOutlined, DollarOutlined, PrinterOutlined } from '@ant-design/icons';
import { Guard, PageHeader, Money } from '@/components/common';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { useAction, useLiveQuery } from '@/lib/hooks';
import { rpc } from '@/lib/api';
import { where, orderBy, limit } from '@/lib/q';
import { COL } from '@/lib/constants';
import { fmtDate, money, round2 } from '@/lib/format';
import { payslipPdf } from '@/pdf/generate';
import { useLang } from '@/i18n/LangContext';

function StaffModal({ staff, onClose }) {
  const { t: tr } = useLang();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const ok = async () => { const v = await form.validateFields(); if (await run(() => rpc('payroll.saveStaff', staff?.id || null, v), 'Saved')) onClose(); };
  return (
    <Modal open onCancel={onClose} onOk={ok} confirmLoading={busy} width={680} title={staff?.id ? `${tr('Edit staff')} ${staff.code || ''}` : tr('New staff')} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ status: 'active', ...staff }}>
        <Row gutter={12}>
          <Col xs={24} md={12}><Form.Item name="name" label={tr('Name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="designation" label={tr('Designation (pujari, guard, cook …)')}><Input /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="mobile" label={tr('Mobile')} rules={[{ pattern: /^[6-9]\d{9}$/, message: tr('10 digit mobile') }]}><Input maxLength={10} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="joinDate" label={tr('Joining date')}><Input type="date" /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="salary" label={tr('Monthly salary (₹)')} rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="bankAccount" label={tr('Bank account no.')}><Input /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="ifsc" label="IFSC"><Input style={{ textTransform: 'uppercase' }} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="pan" label="PAN"><Input style={{ textTransform: 'uppercase' }} maxLength={10} /></Form.Item></Col>
          <Col xs={24}><Form.Item name="address" label={tr('Address')}><Input /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="status" label={tr('Status')}><Select options={[{ value: 'active', label: tr('active') }, { value: 'left', label: tr('Left') }]} /></Form.Item></Col>
          <Col xs={24} md={16}><Form.Item name="notes" label={tr('Notes')}><Input /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}

function PayModal({ ids, total, onClose }) {
  const { t: tr, pick } = useLang();
  const app = useAppData();
  const [form] = Form.useForm();
  const [run, busy] = useAction();
  const salaryCat = app.expenseCategories.find((c) => /salary|वेतन/i.test(`${c.name} ${c.nameHi || ''}`));
  const ok = async () => {
    const v = await form.validateFields();
    const r = await run(() => rpc('payroll.pay', ids, { ...v, date: v.date.format('YYYY-MM-DD') }), 'Salary paid');
    if (r) onClose();
  };
  return (
    <Modal open onCancel={onClose} onOk={ok} confirmLoading={busy} title={`${tr('Pay salary')} – ${ids.length} · ${money(total)}`} destroyOnHidden>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tr('One expense voucher per person is created, approved and paid – the cash / bank book updates automatically.')} />
      <Form form={form} layout="vertical" initialValues={{ date: dayjs(), categoryId: salaryCat?.id }}>
        <Form.Item name="categoryId" label={tr('Expense category')} rules={[{ required: true }]}><Select options={app.activeExpenseCategories ? app.activeExpenseCategories.map((c) => ({ value: c.id, label: pick(c.name, c.nameHi) })) : app.expenseCategories.map((c) => ({ value: c.id, label: pick(c.name, c.nameHi) }))} /></Form.Item>
        <Form.Item name="accountId" label={tr('Paid from')} rules={[{ required: true }]}><Select options={app.activeAccounts.map((a) => ({ value: a.id, label: a.name }))} /></Form.Item>
        <Form.Item name="date" label={tr('Payment date')}><DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item>
        <Form.Item name="utr" label={tr('UTR / cheque (optional)')}><Input /></Form.Item>
      </Form>
    </Modal>
  );
}

export default function PayrollPage() {
  const { t: tr } = useLang();
  const { can } = useAuth();
  const app = useAppData();
  const [run, busy] = useAction();
  const [staffEdit, setStaffEdit] = useState(null);
  const [month, setMonth] = useState(dayjs().subtract(dayjs().date() < 15 ? 1 : 0, 'month').startOf('month'));
  const [rows, setRows] = useState({});
  const [sel, setSel] = useState([]);
  const [payOpen, setPayOpen] = useState(false);
  const mk = month.format('YYYY-MM');
  const { data: staff } = useLiveQuery(COL.staff, [orderBy('name', 'asc')], []);
  const { data: slips, loading } = useLiveQuery(COL.payslips, [where('month', '==', mk), limit(500)], [mk]);
  const manage = can('payroll.manage');
  const active = staff.filter((s) => s.status !== 'left');
  const dim = month.daysInMonth();
  useEffect(() => {
    const r = {};
    active.forEach((s) => {
      const p = slips.find((x) => x.staffId === s.id);
      r[s.id] = { daysWorked: p?.daysWorked ?? dim, advance: p?.advance || 0, otherDeduction: p?.otherDeduction || 0, bonus: p?.bonus || 0, note: p?.note || '' };
    });
    setRows(r);
    setSel([]);
  }, [mk, staff.length, slips.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const setRow = (id, k, v) => setRows({ ...rows, [id]: { ...rows[id], [k]: v } });
  const calc = (s) => {
    const r = rows[s.id] || {};
    const gross = round2((s.salary * (r.daysWorked ?? dim)) / dim);
    return { gross, net: round2(gross + (Number(r.bonus) || 0) - (Number(r.advance) || 0) - (Number(r.otherDeduction) || 0)) };
  };
  const generate = () => run(() => rpc('payroll.generate', mk, active.filter((s) => !slips.some((p) => p.staffId === s.id && p.status === 'paid')).map((s) => ({ staffId: s.id, ...rows[s.id] }))), 'Salary sheet saved');
  const unpaidSel = sel.filter((id) => slips.find((p) => p.id === id && p.status !== 'paid'));
  const selTotal = slips.filter((p) => unpaidSel.includes(p.id)).reduce((s, p) => s + p.net, 0);
  const staffMap = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);
  const paidTotal = slips.filter((p) => p.status === 'paid').reduce((s, p) => s + p.net, 0);

  return (
    <Guard perm="payroll.view">
      <PageHeader title={tr('Staff & salary')} subtitle={tr('Monthly salary sheet, payslips and payment through expense vouchers.')} extra={[manage ? <Button key="n" icon={<PlusOutlined />} onClick={() => setStaffEdit({})}>{tr('New staff')}</Button> : null]} />
      <Card size="small">
        <Tabs
          items={[
            {
              key: 'sheet', label: tr('Monthly salary'),
              children: (
                <>
                  <Space wrap style={{ marginBottom: 8 }}>
                    <DatePicker picker="month" value={month} onChange={(v) => v && setMonth(v.startOf('month'))} allowClear={false} format="MMM YYYY" />
                    {manage ? <Button icon={<CalculatorOutlined />} loading={busy} disabled={!active.length} onClick={generate}>{tr('Save salary sheet')}</Button> : null}
                    {manage && can('expenses.pay') ? <Button type="primary" icon={<DollarOutlined />} disabled={!unpaidSel.length} onClick={() => setPayOpen(true)}>{tr('Pay selected')} {unpaidSel.length ? `(${unpaidSel.length})` : ''}</Button> : null}
                    <Button icon={<PrinterOutlined />} disabled={!slips.length} onClick={() => payslipPdf({ slips: slips.filter((p) => !sel.length || sel.includes(p.id)), settings: app.settings, staffMap })}>{tr('Payslips PDF')}</Button>
                  </Space>
                  <Row gutter={12} style={{ marginBottom: 8 }}>
                    <Col xs={12} md={6}><Statistic title={tr('Staff')} value={active.length} /></Col>
                    <Col xs={12} md={6}><Statistic title={tr('Paid this month')} value={money(paidTotal)} /></Col>
                  </Row>
                  <Table
                    size="small"
                    rowKey="id"
                    loading={loading}
                    dataSource={active}
                    pagination={false}
                    scroll={{ x: 1000 }}
                    rowSelection={{ selectedRowKeys: sel.map((id) => id.split('_')[1]), onChange: (keys) => setSel(keys.map((k) => `${mk}_${k}`)), getCheckboxProps: (s) => ({ disabled: !slips.some((p) => p.staffId === s.id && p.status !== 'paid') }) }}
                    columns={[
                      { title: tr('Name'), render: (_, s) => <span><b>{s.name}</b><br /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{s.designation}</Typography.Text></span> },
                      { title: tr('Monthly salary (₹)'), dataIndex: 'salary', align: 'right', render: (v) => <Money value={v} /> },
                      { title: `${tr('Days worked')} / ${dim}`, width: 110, render: (_, s) => <InputNumber size="small" min={0} max={dim} value={rows[s.id]?.daysWorked} disabled={!manage} onChange={(v) => setRow(s.id, 'daysWorked', v)} /> },
                      { title: tr('Bonus'), width: 100, render: (_, s) => <InputNumber size="small" min={0} value={rows[s.id]?.bonus} disabled={!manage} onChange={(v) => setRow(s.id, 'bonus', v)} /> },
                      { title: tr('Advance'), width: 100, render: (_, s) => <InputNumber size="small" min={0} value={rows[s.id]?.advance} disabled={!manage} onChange={(v) => setRow(s.id, 'advance', v)} /> },
                      { title: tr('Other deduction'), width: 110, render: (_, s) => <InputNumber size="small" min={0} value={rows[s.id]?.otherDeduction} disabled={!manage} onChange={(v) => setRow(s.id, 'otherDeduction', v)} /> },
                      { title: tr('Net'), align: 'right', render: (_, s) => <b>{money(calc(s).net)}</b> },
                      {
                        title: tr('Status'),
                        render: (_, s) => {
                          const p = slips.find((x) => x.staffId === s.id);
                          if (!p) return <Tag>{tr('Not saved')}</Tag>;
                          return p.status === 'paid' ? <Link href={`/expenses/${p.expenseId}`}><Tag color="green">{tr('Paid')} {p.voucherNo}</Tag></Link> : <Tag color="orange">{tr('Saved – not paid')}</Tag>;
                        },
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'staff', label: `${tr('Staff')} (${staff.length})`,
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={staff}
                  pagination={false}
                  columns={[
                    { title: tr('Code'), dataIndex: 'code', width: 80 },
                    { title: tr('Name'), dataIndex: 'name' },
                    { title: tr('Designation'), dataIndex: 'designation' },
                    { title: tr('Mobile'), dataIndex: 'mobile' },
                    { title: tr('Joining date'), dataIndex: 'joinDate', render: fmtDate },
                    { title: tr('Monthly salary (₹)'), dataIndex: 'salary', align: 'right', render: (v) => (v !== undefined ? <Money value={v} /> : '—') },
                    { title: tr('Status'), dataIndex: 'status', render: (s) => (s === 'left' ? <Tag>{tr('Left')}</Tag> : <Tag color="green">{tr('active')}</Tag>) },
                    { title: '', render: (_, s) => (manage ? <Button size="small" icon={<EditOutlined />} onClick={() => setStaffEdit(s)} /> : null) },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>
      {staffEdit ? <StaffModal staff={staffEdit.id ? staffEdit : null} onClose={() => setStaffEdit(null)} /> : null}
      {payOpen ? <PayModal ids={unpaidSel} total={selTotal} onClose={() => { setPayOpen(false); setSel([]); }} /> : null}
    </Guard>
  );
}

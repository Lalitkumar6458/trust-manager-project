'use client';

import { useState } from 'react';
import { Card, Row, Col, Button, Typography, Tag, Modal, Form, Input, InputNumber, Switch, Space, Alert } from 'antd';
import { PlusOutlined, EditOutlined, CheckOutlined } from '@ant-design/icons';
import { crpc, useControl, useRun } from '@/components/control/ControlShell';
import { inr, FeaturePicker } from '@/components/control/bits';
import { featureLabel, CORE_INCLUDES, FEATURES } from '@/lib/features';

function PlanModal({ plan, onClose }) {
  const [form] = Form.useForm();
  const [run, busy] = useRun();
  const ok = async () => {
    const v = await form.validateFields();
    if (await run(() => crpc('plans.save', plan?.id || null, v), 'Plan saved')) onClose(true);
  };
  return (
    <Modal open width={700} title={plan?.id ? `Edit plan – ${plan.name}` : 'New plan'} onCancel={() => onClose(false)} onOk={ok} confirmLoading={busy} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={plan?.id ? {
          name: plan.name, description: plan.description, priceMonth: plan.price_month, priceYear: plan.price_year, features: plan.features, maxUsers: plan.max_users, sort: plan.sort, active: plan.active,
        } : { active: true, features: [], sort: 10 }}
      >
        <Row gutter={12}>
          <Col xs={24} md={12}><Form.Item name="name" label="Plan name" rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="priceYear" label="Price / year (₹)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="priceMonth" label="Price / month (₹)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={24}><Form.Item name="description" label="Short description (sanstha sees this)"><Input /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="maxUsers" label="Max active users" extra="Empty = unlimited"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={6} md={8}><Form.Item name="sort" label="Order"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={6} md={8}><Form.Item name="active" label="Offered" valuePropName="checked"><Switch /></Form.Item></Col>
          <Col xs={24}><Form.Item name="features" label="Add-on features in this plan"><FeaturePicker /></Form.Item></Col>
        </Row>
        <Alert type="info" showIcon message="Changing a plan changes it for every sanstha on this plan (except their own add / remove)." />
      </Form>
    </Modal>
  );
}

export default function PlansPage() {
  const [plans, loading, reload] = useControl('plans.list');
  const [edit, setEdit] = useState(null);
  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>Plans & pricing</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEdit({})}>New plan</Button>
      </Space>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Every plan always includes the core: ${CORE_INCLUDES.en}.`} />
      <Row gutter={[12, 12]}>
        {(plans || []).map((p) => (
          <Col xs={24} md={12} xl={8} key={p.id}>
            <Card
              loading={loading}
              title={<span>{p.name} {!p.active ? <Tag>not offered</Tag> : null}</span>}
              extra={<Button size="small" icon={<EditOutlined />} onClick={() => setEdit(p)}>Edit</Button>}
            >
              <Typography.Title level={3} style={{ margin: 0 }}>{inr(p.price_year)}<Typography.Text type="secondary" style={{ fontSize: 14 }}> / year</Typography.Text></Typography.Title>
              <Typography.Text type="secondary">{p.price_month ? `or ${inr(p.price_month)} / month · ` : ''}{p.max_users ? `${p.max_users} users` : 'Unlimited users'} · {p.tenants} sansthaen</Typography.Text>
              <Typography.Paragraph style={{ marginTop: 8 }}>{p.description}</Typography.Paragraph>
              <div>
                {FEATURES.map((f) => (
                  <div key={f.key} style={{ color: p.features.includes(f.key) ? undefined : '#bbb', fontSize: 13 }}>
                    {p.features.includes(f.key) ? <CheckOutlined style={{ color: '#237804' }} /> : <span style={{ display: 'inline-block', width: 14 }}>–</span>} {featureLabel(f.key)}
                  </div>
                ))}
              </div>
            </Card>
          </Col>
        ))}
      </Row>
      {edit ? <PlanModal plan={edit} onClose={(c) => { setEdit(null); if (c) reload(); }} /> : null}
    </div>
  );
}

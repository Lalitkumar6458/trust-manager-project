'use client';

import { useEffect, useState } from 'react';
import { Card, Checkbox, Button, Typography, Alert, Space } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useAppData } from '@/contexts/AppDataContext';
import { useAction } from '@/lib/hooks';
import { rpc } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/constants';
import { useLang } from '@/i18n/LangContext';

export default function SecuritySettings() {
  const { t: tr } = useLang();
  const app = useAppData();
  const [run, busy] = useAction();
  const [roles, setRoles] = useState([]);
  useEffect(() => { setRoles(app.settings.security?.require2fa || []); }, [app.settings.security]);
  return (
    <Card size="small" title={tr('2-step login (authenticator app)')} style={{ maxWidth: 720 }}>
      <Typography.Paragraph>{tr('Every user can turn on 2-step login from the menu under their name. Tick roles below to make it compulsory – those users must set it up at their next sign-in.')}</Typography.Paragraph>
      <Checkbox.Group
        value={roles}
        onChange={setRoles}
        options={['superAdmin', 'accountant', 'operator', 'auditor', 'custom'].map((r) => ({ value: r, label: tr(ROLE_LABELS[r] || 'Custom role') }))}
      />
      <Alert type="info" showIcon style={{ margin: '12px 0' }} title={tr('Lost phone? Super Admin → Users & Roles → “…” → Reset 2-step login.')} />
      <Space><Button type="primary" icon={<SaveOutlined />} loading={busy} onClick={() => run(() => rpc('settings.security', { require2fa: roles }), 'Saved')}>{tr('Save')}</Button></Space>
    </Card>
  );
}

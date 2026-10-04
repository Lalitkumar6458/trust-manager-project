'use client';

import { useState, useEffect } from 'react';
import { Button, Select, Space, Empty, Card } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { money, sum } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Guard } from '@/components/common';
import AccountBook from '@/components/AccountBook';
import { AccountModal } from '@/components/AccountModals';
import { useLang } from '@/i18n/LangContext';

export default function CashBookPage() {
  const { t: tr } = useLang();
  const { can } = useAuth();
  const app = useAppData();
  const [accountId, setAccountId] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!accountId && app.cashAccounts.length) setAccountId(app.cashAccounts[0].id);
  }, [app.cashAccounts, accountId]);
  const account = app.cashAccounts.find((a) => a.id === accountId);
  return (
    <Guard perm="accounts.view">
      <PageHeader
        title={tr('Cash Book (रोकड़ बही)')}
        subtitle={tr('Opening cash + cash in − cash out = closing cash · Total cash in hand {v0}', { v0: money(sum(app.cashAccounts, (a) => a.currentBalance)) })}
        extra={[
          app.cashAccounts.length > 1 ? <Select key="s" value={accountId} onChange={setAccountId} style={{ width: 220 }} options={app.cashAccounts.map((a) => ({ value: a.id, label: a.name }))} /> : null,
          can('accounts.manage') ? <Button key="n" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{tr('Add cash account')}</Button> : null,
        ]}
      />
      {account ? <AccountBook account={account} title={tr('Cash Book – {v0}', { v0: account.name })} /> : <Card><Empty description={tr('No cash account')} /></Card>}
      <Space />
      {open ? <AccountModal open={open} onClose={() => setOpen(false)} type="cash" /> : null}
    </Guard>
  );
}

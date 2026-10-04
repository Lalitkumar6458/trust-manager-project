'use client';

import { useParams } from 'next/navigation';
import { Card, Descriptions, Result } from 'antd';
import { maskAccount, money } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Guard, StatusTag, Masked } from '@/components/common';
import AccountBook from '@/components/AccountBook';
import AuditHistory from '@/components/AuditHistory';
import { useLang } from '@/i18n/LangContext';

export default function BankAccountDetailPage() {
  const { t: tr } = useLang();
  const { id } = useParams();
  const { can } = useAuth();
  const app = useAppData();
  const a = app.accounts.find((x) => x.id === id);
  if (!a) return <Result status="404" title={tr('Account not found')} />;
  return (
    <Guard perm="accounts.view">
      <PageHeader title={<span>{a.name} <StatusTag status={a.status || 'active'} /></span>} subtitle={tr('Bank Book · Current balance {v0}', { v0: money(a.currentBalance) })} />
      <Card style={{ marginBottom: 12 }} size="small">
        <Descriptions size="small" column={{ xs: 1, md: 3 }}>
          <Descriptions.Item label={tr('Bank')}>{a.bankName} {a.branch ? `(${a.branch})` : ''}</Descriptions.Item>
          <Descriptions.Item label={tr('Account no.')}>{can('accounts.manage') ? <Masked value={a.accountNumber} show /> : maskAccount(a.accountNumber)}</Descriptions.Item>
          <Descriptions.Item label={tr('IFSC')}>{a.ifsc}</Descriptions.Item>
          <Descriptions.Item label={tr('Holder')}>{a.accountName}</Descriptions.Item>
          <Descriptions.Item label={tr('Type')}>{tr(a.accountType || '')}</Descriptions.Item>
          <Descriptions.Item label={tr('Opening (first)')}>{money(a.openingBalance)} on {a.openingDate}</Descriptions.Item>
        </Descriptions>
      </Card>
      <AccountBook account={a} title={tr('Bank Book – {v0}', { v0: a.name })} />
      <Card title={tr('Account change history')} style={{ marginTop: 12 }}><AuditHistory docId={a.id} /></Card>
    </Guard>
  );
}

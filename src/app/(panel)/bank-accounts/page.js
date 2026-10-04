'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Card, Table, Space, Row, Col, Statistic, Dropdown } from 'antd';
import { PlusOutlined, MoreOutlined } from '@ant-design/icons';
import { COL } from '@/lib/constants';
import { maskAccount, sum, money } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Money, Guard, StatusTag, useReasonPrompt } from '@/components/common';
import { setStatus } from '@/services/masters';
import { fyOpeningFor } from '@/services/ledger';
import { AccountModal, OpeningModal } from '@/components/AccountModals';
import { useLang } from '@/i18n/LangContext';

export default function BankAccountsPage() {
  const { t: tr } = useLang();
  const { can, user } = useAuth();
  const app = useAppData();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [opening, setOpening] = useState(null);
  const [ask, reasonModal] = useReasonPrompt();
  const [run] = useAction();
  const rows = app.bankAccounts;
  const fy = app.selectedFy;

  const toggle = async (a) => {
    const next = a.status === 'inactive' ? 'active' : 'inactive';
    const reason = await ask(`${next === 'inactive' ? tr('Deactivate') : tr('Activate')} ${a.name}?`, { okText: tr('Confirm'), danger: next === 'inactive' });
    if (reason) run(() => setStatus(COL.accounts, a.id, next, user, reason), 'Updated');
  };

  return (
    <Guard perm="accounts.view">
      <PageHeader
        title={tr('Bank Accounts')}
        subtitle={tr('Opening balance + donations − expenses ± adjustments = current balance')}
        extra={can('accounts.manage') ? [<Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{tr('Add bank account')}</Button>] : []}
      />
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}><Card><Statistic title={tr('Total bank balance')} value={sum(rows.filter((a) => a.status !== 'inactive'), (a) => a.currentBalance)} precision={2} prefix="₹" /></Card></Col>
        <Col xs={12} md={8}><Card><Statistic title={tr('Active accounts')} value={rows.filter((a) => a.status !== 'inactive').length} /></Card></Col>
        <Col xs={12} md={8}><Card><Statistic title={tr('Opening FY {v0}', { v0: fy?.id })} value={sum(rows, (a) => fyOpeningFor(fy, a))} precision={2} prefix="₹" /></Card></Col>
      </Row>
      <Card>
        <Table
          rowKey="id"
          dataSource={rows}
          scroll={{ x: 900 }}
          pagination={false}
          columns={[
            { title: tr('Account'), render: (_, a) => <div><Link href={`/bank-accounts/${a.id}`}><b>{a.name}</b></Link><div className="muted" style={{ fontSize: 12 }}>{a.accountName}</div></div> },
            { title: tr('Bank / Branch'), render: (_, a) => [a.bankName, a.branch].filter(Boolean).join(', ') },
            { title: tr('A/c no.'), dataIndex: 'accountNumber', render: maskAccount, width: 110 },
            { title: tr('IFSC'), dataIndex: 'ifsc', width: 120, responsive: ['lg'] },
            { title: tr('Type'), dataIndex: 'accountType', width: 100, responsive: ['lg'], render: (v) => tr(v || '') },
            { title: tr('Opening FY {v0}', { v0: fy?.id }), align: 'right', render: (_, a) => <Money value={fyOpeningFor(fy, a)} />, width: 140 },
            { title: tr('Current balance'), dataIndex: 'currentBalance', align: 'right', render: (v) => <Money value={v} strong />, width: 150 },
            { title: tr('Status'), dataIndex: 'status', render: (s) => <StatusTag status={s || 'active'} />, width: 90 },
            {
              title: '', width: 50,
              render: (_, a) => (can('accounts.manage') ? (
                <Dropdown menu={{
                  items: [
                    { key: 'e', label: tr('Edit details'), onClick: () => setEdit(a) },
                    { key: 'o', label: tr('Opening balance (FY {v0})', { v0: fy?.id }), disabled: fy?.status !== 'open', onClick: () => setOpening(a) },
                    { key: 's', label: a.status === 'inactive' ? tr('Activate') : tr('Deactivate'), onClick: () => toggle(a) },
                  ],
                }}
                >
                  <Button size="small" icon={<MoreOutlined />} />
                </Dropdown>
              ) : null),
            },
          ]}
          summary={() => (
            <Table.Summary.Row className="table-summary">
              <Table.Summary.Cell index={0} colSpan={6}>{tr('Total')}</Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">{money(sum(rows, (a) => a.currentBalance))}</Table.Summary.Cell>
              <Table.Summary.Cell index={7} colSpan={2} />
            </Table.Summary.Row>
          )}
        />
        <Space className="muted" style={{ marginTop: 8, fontSize: 12 }}>{tr('Account numbers are masked. Use Bank Reconciliation to match the bank statement.')}</Space>
      </Card>
      {open ? <AccountModal open={open} onClose={() => setOpen(false)} type="bank" /> : null}
      {edit ? <AccountModal open={!!edit} onClose={() => setEdit(null)} type={edit.type} account={edit} /> : null}
      {opening ? <OpeningModal account={opening} onClose={() => setOpening(null)} /> : null}
      {reasonModal}
    </Guard>
  );
}

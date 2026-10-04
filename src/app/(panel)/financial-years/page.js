'use client';

import { useEffect, useState } from 'react';
import {
  Card, Table, Button, Tag, Space, Modal, List, Alert, Checkbox, Typography, Dropdown, Select,
} from 'antd';
import { PlusOutlined, CheckCircleTwoTone, CloseCircleTwoTone, MoreOutlined, LockOutlined } from '@ant-design/icons';
import { fmtDate, nextFyId, fyIdOf, todayStr, sum } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Guard, Money, StatusTag, useReasonPrompt } from '@/components/common';
import {
  createFinancialYear, setCurrentFy, fyChecklist, closeFinancialYear, reopenFinancialYear, recalcCarryForward, saveFyFields,
} from '@/services/closing';
import { useLang } from '@/i18n/LangContext';

function CloseWizard({ fy, onClose }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const app = useAppData();
  const [checks, setChecks] = useState(null);
  const [override, setOverride] = useState(false);
  const [run, busy] = useAction();
  useEffect(() => { if (fy) fyChecklist(fy).then(setChecks).catch(() => setChecks([])); }, [fy]);
  const critical = (checks || []).some((c) => c.critical && !c.ok);
  const soft = (checks || []).some((c) => !c.critical && !c.ok);
  const submit = async () => {
    const ok = await run(() => closeFinancialYear({ fy, accounts: app.accounts, user, override }), tr('FY {v0} closed – opening balances carried to FY {v1}', { v0: fy.id, v1: nextFyId(fy.id) }));
    if (ok) onClose();
  };
  return (
    <Modal open={!!fy} onCancel={onClose} title={tr('Close financial year {v0}', { v0: fy?.id })} onOk={submit} okText={tr('Close FY & carry forward')} okButtonProps={{ disabled: !checks || critical || (soft && !override) }} confirmLoading={busy} width={640}>
      <Typography.Paragraph>{tr('Year-end checklist:')}</Typography.Paragraph>
      <List
        loading={!checks}
        dataSource={checks || []}
        renderItem={(c) => (
          <List.Item>
            <List.Item.Meta
              avatar={c.ok ? <CheckCircleTwoTone twoToneColor="#52c41a" /> : <CloseCircleTwoTone twoToneColor={c.critical ? '#ff4d4f' : '#faad14'} />}
              title={<span>{c.label} {c.critical ? <Tag color="red">{tr('required')}</Tag> : null}</span>}
              description={c.detail}
            />
          </List.Item>
        )}
      />
      {soft && !critical ? <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)}>{tr('Close anyway (non-critical items pending – will be noted in the audit trail)')}</Checkbox> : null}
      <Alert style={{ marginTop: 12 }} type="info" showIcon title={tr('Closing balance of every bank & cash account becomes the opening balance of the next FY. The year is then locked for everyone except the Super Admin, and finalized after audit.')} />
    </Modal>
  );
}

export default function FinancialYearsPage() {
  const { t: tr } = useLang();
  const { can, user } = useAuth();
  const app = useAppData();
  const [run, busy] = useAction();
  const [ask, reasonModal] = useReasonPrompt();
  const [closingFy, setClosingFy] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newId, setNewId] = useState(null);
  const latest = app.fys[0];
  const suggestions = [latest ? nextFyId(latest.id) : fyIdOf(todayStr()), fyIdOf(todayStr())].filter((x, i, a) => a.indexOf(x) === i && !app.fys.some((f) => f.id === x));

  return (
    <Guard perm="fy.view">
      <PageHeader
        title={tr('Financial Years')}
        subtitle={tr('April – March accounting years. Each year keeps its own opening balance, transactions, closing balance & audit.')}
        extra={can('fy.manage') ? [<Button key="n" type="primary" icon={<PlusOutlined />} onClick={() => { setNewId(suggestions[0]); setNewOpen(true); }}>{tr('Create financial year')}</Button>] : []}
      />
      <Card>
        <Table
          rowKey="id"
          dataSource={app.fys}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            { title: tr('Financial year'), render: (_, f) => <b>{tr('FY')}{' '}{f.id} {f.isCurrent ? <Tag color="blue">{tr('Current')}</Tag> : null}</b> },
            { title: tr('Period'), render: (_, f) => `${fmtDate(f.startDate)} – ${fmtDate(f.endDate)}` },
            { title: tr('Status'), dataIndex: 'status', render: (s) => <StatusTag status={s} /> },
            { title: tr('Audit'), render: (_, f) => <StatusTag status={f.audit?.status || 'draft'} /> },
            { title: tr('Opening balance'), align: 'right', render: (_, f) => <Money value={sum(Object.values(f.openingBalances || {}), (x) => x)} /> },
            { title: tr('Closing balance'), align: 'right', render: (_, f) => (f.closingTotal !== undefined ? <Money value={f.closingTotal} strong /> : <span className="muted">—</span>) },
            { title: tr('Cash verified'), render: (_, f) => (f.cashVerified ? `✓ ${f.cashVerifiedBy || ''}` : '') },
            {
              title: '', width: 60,
              render: (_, f) => (can('fy.manage') ? (
                <Dropdown
                  menu={{
                    items: [
                      { key: 'cur', label: tr('Set as current FY'), disabled: f.isCurrent, onClick: () => run(() => setCurrentFy(f.id, app.fys, user), 'Current FY updated') },
                      { key: 'cash', label: f.cashVerified ? tr('Unmark cash verified') : tr('Mark cash physically verified'), disabled: f.status !== 'open', onClick: () => run(() => saveFyFields({ fy: f, patch: { cashVerified: !f.cashVerified, cashVerifiedBy: user.name, cashVerifiedOn: todayStr() }, user }), 'Saved') },
                      { key: 'close', label: tr('Close financial year…'), disabled: f.status !== 'open', onClick: () => setClosingFy(f) },
                      { key: 'recalc', label: tr('Recalculate carry-forward'), disabled: f.status !== 'closed', onClick: () => run(() => recalcCarryForward({ fy: f, accounts: app.accounts, user }), 'Recalculated') },
                      {
                        key: 'reopen', label: tr('Reopen year'), danger: true, disabled: f.status !== 'closed',
                        onClick: async () => { const r = await ask(tr('Reopen FY {v0}?', { v0: f.id }), { okText: tr('Reopen') }); if (r) run(() => reopenFinancialYear({ fy: f, user, reason: r }), 'Reopened'); },
                      },
                    ],
                  }}
                >
                  <Button size="small" icon={<MoreOutlined />} loading={busy} />
                </Dropdown>
              ) : null),
            },
          ]}
        />
        <Space orientation="vertical" style={{ marginTop: 12 }} className="muted">
          <span style={{ fontSize: 12 }}><LockOutlined /> {tr('Open → Closed (year-end, carried forward, audit) → Finalized (after audit; permanently locked, corrections only via adjustment entries in the current year).')}</span>
        </Space>
      </Card>
      <Modal open={newOpen} onCancel={() => setNewOpen(false)} title={tr('Create financial year')} okText={tr('Create')} confirmLoading={busy} okButtonProps={{ disabled: !newId }}
        onOk={async () => { if (await run(() => createFinancialYear(newId, user, { makeCurrent: !app.fys.length, accounts: app.accounts }), tr('FY {v0} created', { v0: newId }))) setNewOpen(false); }}
      >
        <Typography.Paragraph>{tr('Select year:')}</Typography.Paragraph>
        <Select style={{ width: 200 }} value={newId} onChange={setNewId} options={[...suggestions, ...[0, 1, 2].map((i) => nextFyId(fyIdOf(todayStr()).replace(/^\d{4}/, (y) => String(Number(y) - 3 + i))))].filter((x, i, a) => a.indexOf(x) === i && !app.fys.some((f) => f.id === x)).map((x) => ({ value: x, label: `FY ${x}` }))} />
        <Alert style={{ marginTop: 12 }} type="info" showIcon title={tr('Opening balances are carried automatically when the previous year is closed. For the very first year, set each account\'s opening balance from Bank Accounts / Cash Book.')} />
      </Modal>
      {closingFy ? <CloseWizard fy={closingFy} onClose={() => setClosingFy(null)} /> : null}
      {reasonModal}
    </Guard>
  );
}

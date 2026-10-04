'use client';

import { useMemo, useState } from 'react';
import {
  App, Button, Card, Table, Modal, Select, Upload, Space, Tag, Row, Col, Statistic, Alert, Form, InputNumber, Tabs, Typography, Popconfirm, Empty,
} from 'antd';
import { UploadOutlined, ThunderboltOutlined, LinkOutlined, DisconnectOutlined, EyeInvisibleOutlined } from '@ant-design/icons';
import { where } from 'firebase/firestore';
import { COL, TXN_TYPES } from '@/lib/constants';
import dayjs from 'dayjs';
import { fmtDate, round2, sum, fyIdOf } from '@/lib/format';
import { useLiveQuery, useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { PageHeader, Guard, Money, StatusTag, useReasonPrompt } from '@/components/common';
import {
  parseStatementFile, guessMapping, mapRows, saveStatement, autoMatch, manualMatch, unmatch, setIgnored,
} from '@/services/reconciliation';
import { withRunningBalance, fyOpeningFor } from '@/services/ledger';
import { useLang } from '@/i18n/LangContext';

function ImportModal({ open, onClose, onImported }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const app = useAppData();
  const [rows, setRows] = useState(null);
  const [file, setFile] = useState(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState({});
  const [form] = Form.useForm();
  const [run, busy] = useAction();

  const onFile = async (f) => {
    const r = await run(() => parseStatementFile(f));
    if (!r) return false;
    // header = first row that looks like a header
    const hIdx = Math.max(0, r.findIndex((row) => row.some((c) => /date/i.test(c)) && row.some((c) => /(debit|withdraw|credit|deposit)/i.test(c))));
    setFile(f);
    setRows(r);
    setHeaderRow(hIdx);
    setMapping(guessMapping(r[hIdx]));
    return false;
  };
  const header = rows ? rows[headerRow] || [] : [];
  const preview = rows ? mapRows(rows, mapping, headerRow) : [];
  const colOpts = [{ value: -1, label: tr('— none —') }, ...header.map((h, i) => ({ value: i, label: `${i + 1}: ${h}` }))];

  const save = async () => {
    const v = await form.validateFields();
    const acc = app.accounts.find((a) => a.id === v.accountId);
    const id = await run(() => saveStatement({ account: acc, fileName: file.name, lines: preview, openingBalance: v.openingBalance ?? null, closingBalance: v.closingBalance ?? null, user }), 'Statement imported');
    if (id) {
      const n = await run(() => autoMatch(id, user));
      if (n !== false) onImported?.(id, n);
      setRows(null);
      onClose();
    }
  };

  return (
    <Modal open={open} onCancel={onClose} title={tr('Import bank statement (CSV / Excel)')} width={900} onOk={save} okText={tr('Import {v0} line(s) & auto-match', { v0: preview.length })} okButtonProps={{ disabled: !preview.length }} confirmLoading={busy} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col xs={24} md={10}><Form.Item name="accountId" label={tr('Bank account')} rules={[{ required: true }]}><Select options={app.bankAccounts.map((a) => ({ value: a.id, label: a.name }))} /></Form.Item></Col>
          <Col xs={12} md={7}><Form.Item name="openingBalance" label={tr('Statement opening bal.')}><InputNumber style={{ width: '100%' }} precision={2} /></Form.Item></Col>
          <Col xs={12} md={7}><Form.Item name="closingBalance" label={tr('Statement closing bal.')} extra={tr('Taken from last row if blank')}><InputNumber style={{ width: '100%' }} precision={2} /></Form.Item></Col>
        </Row>
      </Form>
      <Upload beforeUpload={onFile} maxCount={1} accept=".csv,.xlsx,.txt" showUploadList={!!file} fileList={file ? [{ uid: '1', name: file.name, status: 'done' }] : []} onRemove={() => { setFile(null); setRows(null); }}>
        <Button icon={<UploadOutlined />}>{tr('Select statement file')}</Button>
      </Upload>
      {rows ? (
        <>
          <Typography.Paragraph style={{ marginTop: 12 }} type="secondary">{tr('Check the column mapping (auto-detected). Header row:')}</Typography.Paragraph>
          <Space wrap>
            <Select style={{ width: 120 }} value={headerRow} onChange={(v) => { setHeaderRow(v); setMapping(guessMapping(rows[v])); }} options={rows.slice(0, 30).map((_, i) => ({ value: i, label: tr('Row {v0}', { v0: i + 1 }) }))} />
            {['date', 'description', 'reference', 'debit', 'credit', 'balance'].map((k) => (
              <Space key={k} size={4}><span style={{ textTransform: 'capitalize' }}>{k}</span><Select style={{ width: 170 }} value={mapping[k] ?? -1} onChange={(v) => setMapping({ ...mapping, [k]: v })} options={colOpts} /></Space>
            ))}
          </Space>
          <Table
            style={{ marginTop: 12 }}
            size="small"
            rowKey={(_, i) => i}
            dataSource={preview.slice(0, 50)}
            pagination={false}
            scroll={{ y: 260 }}
            columns={[
              { title: tr('Date'), dataIndex: 'date', render: fmtDate, width: 100 },
              { title: tr('Description'), dataIndex: 'description', ellipsis: true },
              { title: tr('Ref'), dataIndex: 'reference', width: 120, ellipsis: true },
              { title: tr('Withdrawal'), dataIndex: 'debit', align: 'right', render: (v) => (v ? <Money value={v} type="out" /> : ''), width: 110 },
              { title: tr('Deposit'), dataIndex: 'credit', align: 'right', render: (v) => (v ? <Money value={v} type="in" /> : ''), width: 110 },
              { title: tr('Balance'), dataIndex: 'balance', align: 'right', render: (v) => (v !== null ? <Money value={v} /> : ''), width: 110 },
            ]}
          />
          <Typography.Text type="secondary">{preview.length} valid line(s){preview.length > 50 ? ' – showing first 50' : ''}</Typography.Text>
        </>
      ) : null}
    </Modal>
  );
}

function MatchModal({ line, statement, onClose }) {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const [run, busy] = useAction();
  // candidates within ±45 days of the bank line (index: transactions accountId + date)
  const winFrom = line ? dayjs(line.date).subtract(45, 'day').format('YYYY-MM-DD') : '';
  const winTo = line ? dayjs(line.date).add(45, 'day').format('YYYY-MM-DD') : '';
  const { data: txns } = useLiveQuery(
    line ? COL.transactions : null,
    [where('accountId', '==', statement?.accountId || '-'), where('date', '>=', winFrom), where('date', '<=', winTo)],
    [statement?.accountId, line?.id],
  );
  const isIn = line?.credit > 0;
  const amt = isIn ? line?.credit : line?.debit;
  const cands = txns.filter((t) => !t.reconciled && (isIn ? t.credit > 0 : t.debit > 0))
    .map((t) => ({ ...t, diff: Math.abs((isIn ? t.credit : t.debit) - amt) }))
    .sort((a, b) => a.diff - b.diff || Math.abs(new Date(a.date) - new Date(line.date)) - Math.abs(new Date(b.date) - new Date(line.date)))
    .slice(0, 40);
  return (
    <Modal open={!!line} onCancel={onClose} footer={null} width={860} title={tr('Match: {v0} · {v1} ₹{v2}', { v0: fmtDate(line?.date), v1: isIn ? tr('Deposit') : tr('Withdrawal'), v2: amt })} destroyOnHidden>
      <Typography.Paragraph type="secondary">{line?.description} {line?.reference}</Typography.Paragraph>
      <Table
        size="small"
        rowKey="id"
        dataSource={cands}
        pagination={false}
        scroll={{ y: 400 }}
        columns={[
          { title: tr('Date'), dataIndex: 'date', render: fmtDate, width: 100 },
          { title: tr('Type'), dataIndex: 'type', render: (t) => tr(TXN_TYPES[t]), width: 120 },
          { title: tr('Ref'), dataIndex: 'reference', width: 140 },
          { title: tr('Party / description'), render: (_, t) => `${t.partyName || ''} ${t.description || ''}`, ellipsis: true },
          { title: tr('Amount'), render: (_, t) => <Money value={isIn ? t.credit : t.debit} />, align: 'right', width: 120 },
          { title: '', width: 80, render: (_, t) => <Button size="small" type={t.diff < 0.01 ? 'primary' : 'default'} loading={busy} onClick={async () => { if (await run(() => manualMatch({ statementId: statement.id, lineId: line.id, txnId: t.id, user }), 'Matched')) onClose(); }}>{tr('Match')}</Button> },
        ]}
      />
    </Modal>
  );
}

export default function ReconciliationPage() {
  const { t: tr } = useLang();
  const { can, user } = useAuth();
  const app = useAppData();
  const { message } = App.useApp();
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [matchLine, setMatchLine] = useState(null);
  const [run, busy] = useAction();
  const [ask, reasonModal] = useReasonPrompt();
  const { data: statements } = useLiveQuery(COL.bankStatements, [], []);
  const st = statements.find((s) => s.id === selected) || null;
  const { data: lines, loading } = useLiveQuery(st ? COL.statementLines : null, [where('statementId', '==', st?.id || '-')], [st?.id]);
  // only the statement's financial year (not every year of this account)
  const stFy = st?.periodTo ? fyIdOf(st.periodTo) : '-';
  const { data: acctTxns } = useLiveQuery(st ? COL.transactions : null, [where('accountId', '==', st?.accountId || '-'), where('financialYearId', '==', stFy)], [st?.accountId, stFy]);

  const sortedStatements = [...statements].sort((a, b) => (b.periodTo || '').localeCompare(a.periodTo || ''));
  const sortedLines = useMemo(() => [...lines].sort((a, b) => a.seq - b.seq), [lines]);

  const systemBal = useMemo(() => {
    if (!st) return 0;
    const acc = app.accounts.find((a) => a.id === st.accountId);
    const fy = app.fys.find((f) => st.periodTo >= f.startDate && st.periodTo <= f.endDate) || app.selectedFy;
    const fyTx = acctTxns.filter((t) => t.financialYearId === fy?.id && t.date <= st.periodTo);
    const r = withRunningBalance(fyTx, fyOpeningFor(fy, acc || { id: st.accountId }));
    return r.length ? r[r.length - 1].balance : fyOpeningFor(fy, acc || { id: st.accountId });
  }, [st, acctTxns, app.accounts, app.fys, app.selectedFy]);

  const unreconciledBook = useMemo(() => (st ? acctTxns.filter((t) => !t.reconciled && t.date >= st.periodFrom && t.date <= st.periodTo && t.status !== 'reversed') : []), [st, acctTxns]);
  const bankBal = st?.closingBalance ?? null;
  const unmatched = sortedLines.filter((l) => l.status === 'unmatched');

  return (
    <Guard perm="reconciliation.view">
      <PageHeader
        title={tr('Bank Reconciliation')}
        subtitle={tr('Upload a bank statement → auto-match with the ledger → resolve differences')}
        extra={can('reconciliation.manage') ? [<Button key="i" type="primary" icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>{tr('Import statement')}</Button>] : []}
      />
      <Row gutter={12}>
        <Col xs={24} lg={8}>
          <Card title={tr('Statements')} size="small" style={{ marginBottom: 12 }}>
            {sortedStatements.length ? (
              <Table
                size="small"
                rowKey="id"
                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                dataSource={sortedStatements}
                onRow={(r) => ({ onClick: () => setSelected(r.id), style: { cursor: 'pointer', background: r.id === selected ? '#fff7e6' : undefined } })}
                columns={[
                  { title: tr('Account / period'), render: (_, s) => <div><b>{s.accountName}</b><div className="muted" style={{ fontSize: 12 }}>{fmtDate(s.periodFrom)} – {fmtDate(s.periodTo)}</div></div> },
                  {
                    title: tr('Status'),
                    render: (_, s) => {
                      const left = (s.lineCount || 0) - (s.matchedCount || 0) - (s.ignoredCount || 0);
                      return left ? <Tag color="orange">{left}{' '}{tr('unmatched')}</Tag> : <Tag color="green">{tr('Reconciled')}</Tag>;
                    },
                  },
                ]}
              />
            ) : <Empty description={tr('No statement imported')} />}
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          {st ? (
            <>
              <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                <Col xs={12} md={6}><Card size="small"><Statistic title={tr('System balance ({v0})', { v0: fmtDate(st.periodTo) })} value={systemBal} precision={2} prefix="₹" /></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Bank statement balance')} value={bankBal ?? '—'} precision={2} prefix={bankBal !== null ? '₹' : ''} /></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Difference')} value={bankBal !== null ? round2(systemBal - bankBal) : '—'} precision={2} styles={{ content: { color: bankBal !== null && Math.abs(systemBal - bankBal) > 0.009 ? '#a8071a' : '#237804' } }} /></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Statistic title={tr('Matched')} value={`${st.matchedCount || 0} / ${st.lineCount}`} /></Card></Col>
              </Row>
              {bankBal !== null && Math.abs(systemBal - bankBal) > 0.009 ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  title={tr('Difference found')}
                  description={tr('In bank but not in books: deposits ₹{v0}, withdrawals ₹{v1}. In books but not in bank (period): in ₹{v2}, out ₹{v3}. Record missing bank charges / interest from Transactions, or match manually.', { v0: sum(unmatched, (l) => l.credit), v1: sum(unmatched, (l) => l.debit), v2: sum(unreconciledBook, (t) => t.credit), v3: sum(unreconciledBook, (t) => t.debit) })}
                />
              ) : null}
              <Card
                size="small"
                title={`${st.accountName} · ${st.fileName}`}
                extra={can('reconciliation.manage') ? <Button icon={<ThunderboltOutlined />} loading={busy} onClick={async () => { const n = await run(() => autoMatch(st.id, user)); if (n !== false) message.info(tr('{v0} line(s) auto-matched', { v0: n === true ? 0 : n })); }}>{tr('Auto-match')}</Button> : null}
              >
                <Tabs
                  items={[
                    {
                      key: 'lines', label: tr('Statement lines ({v0})', { v0: sortedLines.length }),
                      children: (
                        <Table
                          size="small"
                          rowKey="id"
                          loading={loading}
                          dataSource={sortedLines}
                          scroll={{ x: 800 }}
                          pagination={{ defaultPageSize: 50 }}
                          columns={[
                            { title: tr('Date'), dataIndex: 'date', render: fmtDate, width: 100 },
                            { title: tr('Description'), dataIndex: 'description', ellipsis: true },
                            { title: tr('Ref'), dataIndex: 'reference', width: 110, ellipsis: true },
                            { title: tr('Withdrawal'), dataIndex: 'debit', align: 'right', width: 110, render: (v) => (v ? <Money value={v} type="out" /> : '') },
                            { title: tr('Deposit'), dataIndex: 'credit', align: 'right', width: 110, render: (v) => (v ? <Money value={v} type="in" /> : '') },
                            { title: tr('Status'), dataIndex: 'status', width: 110, render: (s, l) => <span><StatusTag status={s} />{l.matchType === 'manual' ? <Tag>{tr('manual')}</Tag> : null}</span> },
                            {
                              title: '', width: 110,
                              render: (_, l) => (!can('reconciliation.manage') ? null : l.status === 'unmatched' ? (
                                <Space size={4}>
                                  <Button size="small" icon={<LinkOutlined />} title={tr('Match manually')} onClick={() => setMatchLine(l)} />
                                  <Button size="small" icon={<EyeInvisibleOutlined />} title={tr('Ignore')} onClick={async () => { const r = await ask('Ignore this statement line?', { okText: tr('Ignore'), danger: false }); if (r) run(() => setIgnored({ statementId: st.id, line: l, ignored: true, reason: r, user })); }} />
                                </Space>
                              ) : l.status === 'matched' ? (
                                <Popconfirm title={tr('Unmatch?')} onConfirm={() => run(() => unmatch({ statementId: st.id, line: l, user }))}><Button size="small" icon={<DisconnectOutlined />} title={tr('Unmatch')} /></Popconfirm>
                              ) : (
                                <Button size="small" onClick={() => run(() => setIgnored({ statementId: st.id, line: l, ignored: false, user }))}>{tr('Restore')}</Button>
                              )),
                            },
                          ]}
                        />
                      ),
                    },
                    {
                      key: 'book', label: tr('In books, not in bank ({v0})', { v0: unreconciledBook.length }),
                      children: (
                        <Table
                          size="small"
                          rowKey="id"
                          dataSource={unreconciledBook}
                          pagination={false}
                          columns={[
                            { title: tr('Date'), dataIndex: 'date', render: fmtDate },
                            { title: tr('Type'), dataIndex: 'type', render: (t) => tr(TXN_TYPES[t]) },
                            { title: tr('Reference'), dataIndex: 'reference' },
                            { title: tr('Party'), dataIndex: 'partyName' },
                            { title: tr('In'), dataIndex: 'credit', align: 'right', render: (v) => (v ? <Money value={v} type="in" /> : '') },
                            { title: tr('Out'), dataIndex: 'debit', align: 'right', render: (v) => (v ? <Money value={v} type="out" /> : '') },
                          ]}
                        />
                      ),
                    },
                  ]}
                />
              </Card>
            </>
          ) : <Card><Empty description={tr('Select a statement on the left, or import a new one')} /></Card>}
        </Col>
      </Row>
      {importOpen ? <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={(id) => setSelected(id)} /> : null}
      <MatchModal line={matchLine} statement={st} onClose={() => setMatchLine(null)} />
      {reasonModal}
    </Guard>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Card, Row, Col, Input, InputNumber, Button, Space, Segmented, Select, Tag, Typography, Alert, List, Checkbox, Empty, Tooltip,
} from 'antd';
import {
  ThunderboltOutlined, UserOutlined, RedoOutlined, PrinterOutlined, CheckCircleOutlined, ClearOutlined,
} from '@ant-design/icons';
import { Guard, PageHeader, Money } from '@/components/common';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { fetchAll, fetchOne } from '@/lib/api';
import { where, orderBy, limit } from '@/lib/q';
import { COL, isCashMode } from '@/lib/constants';
import { fmtDate, money, todayStr, MOBILE_REGEX } from '@/lib/format';
import { amountInWordsHi } from '@/lib/amountInWords';
import { useAction } from '@/lib/hooks';
import { createDonation, markReceiptPrinted } from '@/services/donations';
import { donationReceiptPdf } from '@/pdf/generate';
import { useLang } from '@/i18n/LangContext';

// Counter screen: mobile → donor, category → amount → Enter = saved + receipt printed.
// Keyboard: F2 = mobile, Enter (in amount / UTR) = save, Esc = clear.

const AMOUNTS = [101, 251, 501, 1100, 2100, 5100, 11000];
const MODES = ['Cash', 'UPI', 'Cheque', 'Bank Transfer'];
const LS_PRINT = 'tm_quick_print';
const readLS = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export default function QuickDonationPage() {
  const { t: tr, pick } = useLang();
  const { can, user } = useAuth();
  const app = useAppData();
  const [run, busy] = useAction();
  const mobileRef = useRef(null);
  const amountRef = useRef(null);

  const [mobile, setMobile] = useState('');
  const [donors, setDonors] = useState(null); // null = not searched
  const [donor, setDonor] = useState(null);
  const [newDonor, setNewDonor] = useState({ name: '', address: '' });
  const [last, setLast] = useState(null);
  const [categoryId, setCategoryId] = useState(null);
  const [amount, setAmount] = useState(null);
  const [mode, setMode] = useState('Cash');
  const [utr, setUtr] = useState('');
  const [purpose, setPurpose] = useState('');
  const [print, setPrint] = useState(true);
  const [session, setSession] = useState([]);

  useEffect(() => { setPrint(readLS(LS_PRINT, true)); }, []);

  const cats = useMemo(() => {
    const list = app.activeDonationCategories || [];
    return [...list].sort((a, b) => (b.showOnReceipt ? 1 : 0) - (a.showOnReceipt ? 1 : 0));
  }, [app.activeDonationCategories]);
  useEffect(() => { if (!categoryId && cats.length) setCategoryId(cats[0].id); }, [cats, categoryId]);

  const accounts = useMemo(() => app.activeAccounts.filter((a) => (isCashMode(mode) ? a.type === 'cash' : a.type === 'bank')), [app.activeAccounts, mode]);
  const [accountId, setAccountId] = useState(null);
  useEffect(() => { if (!accounts.some((a) => a.id === accountId)) setAccountId(accounts[0]?.id || null); }, [accounts, accountId]);

  const reset = useCallback((keepMode = true) => {
    setMobile(''); setDonors(null); setDonor(null); setNewDonor({ name: '', address: '' }); setLast(null);
    setAmount(null); setUtr(''); setPurpose('');
    if (!keepMode) setMode('Cash');
    setTimeout(() => mobileRef.current?.focus(), 50);
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'F2') { e.preventDefault(); mobileRef.current?.focus(); }
      if (e.key === 'Escape') { e.preventDefault(); reset(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [reset]);
  useEffect(() => { mobileRef.current?.focus(); }, []);

  // mobile → donor(s)
  useEffect(() => {
    if (!MOBILE_REGEX.test(mobile)) { setDonors(null); setDonor(null); setLast(null); return; }
    let off = false;
    (async () => {
      try {
        const list = await fetchAll(COL.donors, where('mobile', '==', mobile), limit(10));
        if (off) return;
        setDonors(list);
        setDonor(list.length === 1 ? list[0] : null);
        if (!list.length) setTimeout(() => document.getElementById('qd-name')?.focus(), 50);
      } catch { if (!off) setDonors([]); }
    })();
    return () => { off = true; };
  }, [mobile]);

  // donor → last donation (for "repeat")
  useEffect(() => {
    if (!donor) { setLast(null); return; }
    let off = false;
    (async () => {
      try {
        const [d] = await fetchAll(COL.donations, where('donorId', '==', donor.id), orderBy('createdAt', 'desc'), limit(1));
        if (!off) setLast(d || null);
      } catch { /* ignore */ }
    })();
    setTimeout(() => amountRef.current?.focus(), 50);
    return () => { off = true; };
  }, [donor]);

  const repeatLast = () => {
    if (!last) return;
    const l = last.lines?.[0];
    if (l?.categoryId && cats.some((c) => c.id === l.categoryId)) setCategoryId(l.categoryId);
    setAmount(last.amount);
    if (MODES.includes(last.paymentMode)) setMode(last.paymentMode);
    setPurpose(last.purpose || '');
    setTimeout(() => amountRef.current?.focus(), 50);
  };

  const needUtr = !isCashMode(mode);
  const canApprove = can('donations.verify') && can('donations.approve');
  const ready = (donor || newDonor.name.trim()) && categoryId && Number(amount) > 0 && accountId && (!needUtr || utr.trim());

  const save = () => {
    if (!ready || busy) return;
    run(async () => {
      const cat = cats.find((c) => c.id === categoryId);
      const input = {
        date: todayStr(),
        paymentMode: mode,
        accountId,
        utr: mode === 'Cheque' ? null : (needUtr ? utr.trim() : null),
        chequeNo: mode === 'Cheque' ? utr.trim() : null,
        purpose: purpose.trim(),
        lines: [{ categoryId, amount: Number(amount), fundId: cat?.defaultFundId || null }],
        donorId: donor?.id || null,
        newDonor: donor ? null : { name: newDonor.name.trim(), address: newDonor.address.trim(), mobile: MOBILE_REGEX.test(mobile) ? mobile : '', donorType: 'Individual' },
      };
      const id = await createDonation(input, { submit: true, approveNow: canApprove });
      const d = await fetchOne(COL.donations, id);
      setSession((s) => [{ id, receiptNo: d?.receiptNo, name: d?.donor?.name, amount: d?.amount, mode, status: d?.status }, ...s].slice(0, 30));
      if (print && d) {
        try { await markReceiptPrinted(id, user); } catch { /* print anyway */ }
        await donationReceiptPdf({ donation: d, settings: app.settings, categories: app.donationCategories, mode: 'print' });
      }
      reset();
    }, canApprove ? tr('Donation saved & approved') : tr('Donation submitted for verification'));
  };
  const enterSave = (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } };

  const todayTotal = session.reduce((s, x) => s + (Number(x.amount) || 0), 0);

  return (
    <Guard perm="donations.create">
      <PageHeader
        title={<Space><ThunderboltOutlined />{tr('Quick donation entry')}</Space>}
        subtitle={tr('Mobile → category → amount → Enter. Receipt prints automatically.')}
        extra={[<Link key="f" href="/donations/new"><Button>{tr('Full form')}</Button></Link>]}
      />
      <Row gutter={16}>
        <Col xs={24} lg={15}>
          <Card size="small" style={{ marginBottom: 12 }}>
            <Typography.Text strong>{tr('Donor mobile')} <Tag>F2</Tag></Typography.Text>
            <Input
              ref={mobileRef}
              size="large"
              prefix={<UserOutlined />}
              inputMode="numeric"
              maxLength={10}
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
              placeholder={tr('10 digit mobile (leave empty for walk-in donor)')}
              style={{ marginTop: 6, fontSize: 20 }}
            />
            {donors && donors.length > 1 ? (
              <Space wrap style={{ marginTop: 8 }}>
                {donors.map((d) => (
                  <Button key={d.id} type={donor?.id === d.id ? 'primary' : 'default'} onClick={() => setDonor(d)}>{d.name}</Button>
                ))}
                <Button type={!donor ? 'primary' : 'dashed'} onClick={() => setDonor(null)}>{tr('New donor')}</Button>
              </Space>
            ) : null}
            {donor ? (
              <Alert
                style={{ marginTop: 8 }}
                type="success"
                showIcon
                title={<span><b>{donor.name}</b>{donor.organizationName ? ` (${donor.organizationName})` : ''} {donor.pan ? <Tag>PAN</Tag> : null}</span>}
                description={(
                  <div>
                    {donor.address ? <div>{donor.address}</div> : null}
                    {last ? (
                      <div style={{ marginTop: 4 }}>
                        {tr('Last donation')}: {fmtDate(last.date)} · {money(last.amount)} · {(last.lines || []).map((l) => l.categoryNameHi || l.categoryName).join(', ')}{' '}
                        <Button size="small" icon={<RedoOutlined />} onClick={repeatLast}>{tr('Repeat')}</Button>
                      </div>
                    ) : null}
                  </div>
                )}
              />
            ) : null}
            {!donor ? (
              <Row gutter={8} style={{ marginTop: 8 }}>
                <Col xs={24} md={10}><Input id="qd-name" size="large" placeholder={tr('Donor name (श्री)')} value={newDonor.name} onChange={(e) => setNewDonor({ ...newDonor, name: e.target.value })} /></Col>
                <Col xs={24} md={14}><Input size="large" placeholder={tr('Village / city (optional)')} value={newDonor.address} onChange={(e) => setNewDonor({ ...newDonor, address: e.target.value })} /></Col>
                {donors && !donors.length ? <Col span={24}><Typography.Text type="secondary" style={{ fontSize: 12 }}>{tr('New donor – will be saved with this mobile number.')}</Typography.Text></Col> : null}
              </Row>
            ) : null}
          </Card>

          <Card size="small" style={{ marginBottom: 12 }}>
            <Typography.Text strong>{tr('Category')}</Typography.Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0 12px' }}>
              {cats.slice(0, 12).map((c) => (
                <Button key={c.id} type={categoryId === c.id ? 'primary' : 'default'} onClick={() => { setCategoryId(c.id); amountRef.current?.focus(); }}>{pick(c.name, c.nameHi)}</Button>
              ))}
              {cats.length > 12 ? (
                <Select showSearch={{ optionFilterProp: 'label' }} style={{ minWidth: 180 }} placeholder={tr('More…')} value={cats.slice(12).some((c) => c.id === categoryId) ? categoryId : undefined}
                  onChange={setCategoryId} options={cats.slice(12).map((c) => ({ value: c.id, label: pick(c.name, c.nameHi) }))}
                />
              ) : null}
            </div>
            <Typography.Text strong>{tr('Amount (₹)')}</Typography.Text>
            <InputNumber
              ref={amountRef}
              size="large"
              min={1}
              precision={2}
              value={amount}
              onChange={setAmount}
              onKeyDown={needUtr ? (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('qd-utr')?.focus(); } } : enterSave}
              style={{ width: '100%', margin: '6px 0', fontSize: 24 }}
            />
            <Space wrap>
              {AMOUNTS.map((a) => <Button key={a} size="small" onClick={() => { setAmount(a); amountRef.current?.focus(); }}>₹{a}</Button>)}
            </Space>
            {Number(amount) > 0 ? <div style={{ marginTop: 6 }}><Typography.Text type="secondary">{amountInWordsHi(Number(amount))}</Typography.Text></div> : null}
          </Card>

          <Card size="small" style={{ marginBottom: 12 }}>
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Typography.Text strong>{tr('Payment mode')}</Typography.Text>
                <Segmented block style={{ margin: '6px 0' }} value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: tr(m) }))} />
              </Col>
              <Col xs={24} md={12}>
                <Typography.Text strong>{isCashMode(mode) ? tr('Cash account') : tr('Received in bank account')}</Typography.Text>
                <Select style={{ width: '100%', margin: '6px 0' }} value={accountId} onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: a.name }))} placeholder={tr('Select account')} />
              </Col>
              {needUtr ? (
                <Col span={24}>
                  <Input id="qd-utr" size="large" placeholder={mode === 'Cheque' ? tr('Cheque / DD no.') : tr('Transaction ID / UTR')} value={utr} onChange={(e) => setUtr(e.target.value)} onKeyDown={enterSave} />
                </Col>
              ) : null}
              <Col span={24} style={{ marginTop: 8 }}>
                <Input placeholder={tr('Purpose / उद्देश्य (optional)')} value={purpose} onChange={(e) => setPurpose(e.target.value)} onKeyDown={enterSave} />
              </Col>
            </Row>
            {isCashMode(mode) && Number(amount) > Number(app.settings.cashLimitWarning || 2000) ? (
              <Alert style={{ marginTop: 8 }} type="warning" showIcon title={tr('Cash donations above this limit are not eligible for 80G deduction. Prefer bank / UPI and record donor PAN.')} />
            ) : null}
          </Card>

          <Space wrap align="center">
            <Button type="primary" size="large" icon={<CheckCircleOutlined />} loading={busy} disabled={!ready} onClick={save}>
              {canApprove ? tr('Save & approve') : tr('Save & submit')} (Enter)
            </Button>
            <Button size="large" icon={<ClearOutlined />} onClick={() => reset()}>{tr('Clear')} (Esc)</Button>
            <Checkbox checked={print} onChange={(e) => { setPrint(e.target.checked); writeLS(LS_PRINT, e.target.checked); }}><PrinterOutlined /> {tr('Print receipt after saving')}</Checkbox>
          </Space>
          {!accounts.length ? <Alert style={{ marginTop: 12 }} type="error" showIcon title={tr('No account for this payment mode – add one in Bank Accounts.')} /> : null}
        </Col>

        <Col xs={24} lg={9}>
          <Card size="small" title={tr('Entered now')} extra={<b><Money value={todayTotal} /></b>}>
            {session.length ? (
              <List
                size="small"
                dataSource={session}
                renderItem={(r) => (
                  <List.Item actions={[
                    <Tooltip key="p" title={tr('Print')}>
                      <Button size="small" icon={<PrinterOutlined />} onClick={() => run(async () => {
                        const d = await fetchOne(COL.donations, r.id);
                        try { await markReceiptPrinted(r.id, user); } catch { /* ignore */ }
                        await donationReceiptPdf({ donation: d, settings: app.settings, categories: app.donationCategories, mode: 'print', duplicate: true });
                      })}
                      />
                    </Tooltip>,
                  ]}
                  >
                    <List.Item.Meta title={<Link href={`/donations/${r.id}`}>{r.receiptNo}</Link>} description={`${r.name} · ${tr(r.mode)}`} />
                    <Money value={r.amount} />
                  </List.Item>
                )}
              />
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tr('Receipts made on this screen appear here')} />}
          </Card>
        </Col>
      </Row>
    </Guard>
  );
}

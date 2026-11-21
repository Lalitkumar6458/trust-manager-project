'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Card, Row, Col, Radio, Select, Segmented, ColorPicker, Switch, Slider, Input, Checkbox, Button, Space, Collapse, Typography, Alert, Popconfirm, Spin,
} from 'antd';
import { SaveOutlined, DownloadOutlined, PrinterOutlined, UndoOutlined, ReloadOutlined } from '@ant-design/icons';
import { todayStr, fyIdOf } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { saveSettings } from '@/services/masters';
import { receiptBlob, openBlob, printBlob } from '@/pdf/generate';
import {
  RECEIPT_TEMPLATES, RECEIPT_SIZES, RECEIPT_LANGUAGES, RECEIPT_LABELS, LABEL_FIELDS, SHOW_FIELDS, DEFAULT_RECEIPT_DESIGN, receiptDesignOf,
} from '@/lib/receiptDesign';
import { useLang } from '@/i18n/LangContext';

const COLOR_PRESETS = [
  { name: 'Maroon & gold', colors: { primary: '#7d1a12', accent: '#c8963e', text: '#2a1a12', paper: '#fcf3dc' } },
  { name: 'Saffron', colors: { primary: '#c2410c', accent: '#f59e0b', text: '#292524', paper: '#fff7ed' } },
  { name: 'Royal blue', colors: { primary: '#1e3a8a', accent: '#b8860b', text: '#1f2937', paper: '#f1f5ff' } },
  { name: 'Green', colors: { primary: '#166534', accent: '#a16207', text: '#1c1917', paper: '#f0fdf4' } },
  { name: 'Black', colors: { primary: '#111111', accent: '#666666', text: '#111111', paper: '#ffffff' } },
];

/** saved design → editable state (only real overrides kept in labels) */
function editableOf(settings) {
  const saved = settings.receiptDesign || {};
  const d = receiptDesignOf(settings);
  return { ...d, labels: { ...(saved.labels || {}) } };
}

/** sample donation used for the live preview */
function sampleDonation(settings, categories) {
  const cats = categories.filter((c) => c.showOnReceipt && c.active !== false);
  const pick = cats.length ? cats : categories.filter((c) => c.active !== false);
  const date = todayStr();
  const lines = pick.slice(0, 2).map((c, i) => ({ categoryId: c.id, categoryName: c.name, categoryNameHi: c.nameHi, amount: i ? 1100 : 5100 }));
  const amount = lines.reduce((s, l) => s + l.amount, 0) || 5100;
  return {
    id: 'sample', receiptNo: `${settings.receiptPrefix || 'R'}/${fyIdOf(date)}/00001`, date, financialYearId: fyIdOf(date), status: 'approved', amount,
    paymentMode: 'UPI', utr: '412345678901', purpose: 'मंदिर विकास / Temple development',
    donor: { name: 'श्री रमेश कुमार शर्मा', address: 'मेन बाज़ार, उदयपुर (राज.)', mobile: '9876543210', pan: 'ABCDE1234F', email: 'ramesh@example.com' },
    lines: lines.length ? lines : [{ categoryId: 'x', categoryName: 'General donation', categoryNameHi: 'सामान्य दान', amount }],
  };
}

export default function ReceiptDesigner() {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const app = useAppData();
  const [run, busy] = useAction();
  const [d, setD] = useState(() => editableOf(app.settings));
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(null);
  const [rendering, setRendering] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const lastUrl = useRef(null);

  // pick up changes saved elsewhere, unless the user is editing
  useEffect(() => { if (!dirty) setD(editableOf(app.settings)); }, [app.settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => { setD((x) => ({ ...x, ...patch })); setDirty(true); };
  const setShow = (k, v) => set({ show: { ...d.show, [k]: v } });
  const setColor = (k, v) => set({ colors: { ...d.colors, [k]: v } });
  const setLabel = (k, v) => set({ labels: { ...d.labels, [k]: v } });

  const toSave = useMemo(() => {
    // every label key is written ('' = use default) so cleared labels really clear (settings are merged on save)
    const labels = Object.fromEntries(LABEL_FIELDS.map(([k]) => [k, String(d.labels[k] || '').trim()]));
    return {
      template: d.template, pageSize: d.pageSize, language: d.language, colors: d.colors, paperTint: !!d.paperTint, fontScale: Number(d.fontScale) || 1,
      categoryRows: d.categoryRows, show: d.show, labels, footerText: d.footerText || '', verifyBaseUrl: String(d.verifyBaseUrl || '').trim(),
    };
  }, [d]);
  const previewSettings = useMemo(() => ({ ...app.settings, receiptDesign: toSave }), [app.settings, toSave]);
  const sample = useMemo(() => sampleDonation(app.settings, app.donationCategories), [app.settings, app.donationCategories]);

  // live preview (debounced)
  useEffect(() => {
    let cancelled = false;
    const h = setTimeout(async () => {
      setRendering(true);
      try {
        const blob = await receiptBlob({ donation: sample, settings: previewSettings, categories: app.donationCategories });
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
        lastUrl.current = url;
        setPreview(url);
        setPreviewError(null);
      } catch (e) {
        if (!cancelled) setPreviewError(e.message || String(e));
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(h); };
  }, [previewSettings, sample, app.donationCategories]);
  useEffect(() => () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); }, []);

  const save = () => run(async () => {
    await saveSettings({ receiptDesign: toSave }, user);
    setDirty(false);
  }, 'Receipt design saved');
  const reset = () => {
    setD({ ...DEFAULT_RECEIPT_DESIGN, colors: { ...DEFAULT_RECEIPT_DESIGN.colors }, show: { ...DEFAULT_RECEIPT_DESIGN.show }, labels: {} });
    setDirty(true);
  };
  const sampleFile = (mode) => run(async () => {
    const blob = await receiptBlob({ donation: sample, settings: previewSettings, categories: app.donationCategories });
    if (mode === 'print') printBlob(blob, 'Receipt-sample.pdf');
    else openBlob(blob, 'Receipt-sample.pdf', true);
  });

  const defaults = RECEIPT_LABELS[d.language] || RECEIPT_LABELS.hi;
  const legacyDefault = (k) => (d.language === 'hi' && k === 'title' && app.settings.receiptTitle) || (d.language === 'hi' && k === 'intro' && app.settings.receiptIntro) || defaults[k];
  const colorsDisabled = d.template === 'simple';

  return (
    <Row gutter={16}>
      <Col xs={24} xl={11}>
        {dirty ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tr('Unsaved changes – press “Save design”.')} /> : null}
        <Card size="small" title={tr('Layout')} style={{ marginBottom: 12 }}>
          <Typography.Text strong>{tr('Template')}</Typography.Text>
          <Radio.Group style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '6px 0 12px' }} value={d.template} onChange={(e) => set({ template: e.target.value })} options={RECEIPT_TEMPLATES.map((o) => ({ value: o.value, label: tr(o.label) }))} />
          <Row gutter={12}>
            <Col xs={24} sm={14}>
              <Typography.Text strong>{tr('Paper size')}</Typography.Text>
              <Select style={{ width: '100%', margin: '6px 0 12px' }} value={d.pageSize} onChange={(v) => set({ pageSize: v })} options={RECEIPT_SIZES.map((o) => ({ value: o.value, label: tr(o.label) }))} />
            </Col>
            <Col xs={24} sm={10}>
              <Typography.Text strong>{tr('Language')}</Typography.Text>
              <Segmented block style={{ margin: '6px 0 12px' }} value={d.language} onChange={(v) => set({ language: v })} options={RECEIPT_LANGUAGES.map((o) => ({ value: o.value, label: tr(o.label) }))} />
            </Col>
          </Row>
          <Typography.Text strong>{tr('Category rows')}</Typography.Text>
          <Radio.Group
            style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '6px 0 12px' }}
            value={d.categoryRows}
            onChange={(e) => set({ categoryRows: e.target.value })}
            options={[
              { value: 'all', label: tr('All “print on receipt” categories with tick boxes') },
              { value: 'donated', label: tr('Only the donated categories') },
            ]}
          />
          <Typography.Text strong>{tr('Text size')}</Typography.Text>
          <Slider min={0.8} max={1.3} step={0.05} value={Number(d.fontScale) || 1} onChange={(v) => set({ fontScale: v })} marks={{ 0.8: tr('Small'), 1: '100%', 1.3: tr('Large') }} />
        </Card>

        <Card size="small" title={tr('Colours')} style={{ marginBottom: 12 }} extra={colorsDisabled ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{tr('Simple template prints in black')}</Typography.Text> : null}>
          <Space wrap style={{ marginBottom: 12 }}>
            {COLOR_PRESETS.map((p) => (
              <Button key={p.name} size="small" disabled={colorsDisabled} onClick={() => set({ colors: { ...p.colors } })}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: p.colors.primary, marginRight: 4 }} />
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: p.colors.accent, marginRight: 6 }} />
                {tr(p.name)}
              </Button>
            ))}
          </Space>
          <Space wrap size={16}>
            {[['primary', 'Main colour'], ['accent', 'Border / accent'], ['text', 'Text'], ['paper', 'Paper tint']].map(([k, l]) => (
              <Space key={k} orientation="vertical" size={2}>
                <span style={{ fontSize: 12 }}>{tr(l)}</span>
                <ColorPicker disabled={colorsDisabled} value={d.colors[k]} onChangeComplete={(c) => setColor(k, c.toHexString())} showText disabledAlpha />
              </Space>
            ))}
          </Space>
          <div style={{ marginTop: 12 }}>
            <Switch size="small" checked={!!d.paperTint} disabled={d.template !== 'classic'} onChange={(v) => set({ paperTint: v })} /> <span style={{ marginLeft: 6 }}>{tr('Tinted paper background (classic template)')}</span>
          </div>
        </Card>

        <Card size="small" title={tr('What to print')} style={{ marginBottom: 12 }}>
          <Row gutter={[8, 6]}>
            {SHOW_FIELDS.map(([k, l]) => (
              <Col xs={24} sm={12} key={k}><Checkbox checked={!!d.show[k]} onChange={(e) => setShow(k, e.target.checked)}>{tr(l)}</Checkbox></Col>
            ))}
          </Row>
          {d.show.qr ? (
            <div style={{ marginTop: 12, padding: 10, background: '#fafafa', borderRadius: 6 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>{tr('Website address for the QR link (anyone scanning the QR sees a “genuine receipt” page)')}</div>
              <Input size="small" value={d.verifyBaseUrl || ''} placeholder={typeof window !== 'undefined' ? window.location.origin : 'https://trust.example.org'} onChange={(e) => set({ verifyBaseUrl: e.target.value })} />
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>{tr('Leave empty to use this panel’s address. Use your public domain (https://…), not localhost.')}</Typography.Text>
            </div>
          ) : null}
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>{tr('Images, trust address, PAN and 80G numbers come from the “Trust profile & receipt” tab.')}</Typography.Text>
        </Card>

        <Collapse
          style={{ marginBottom: 12 }}
          items={[
            {
              key: 'l',
              label: tr('Printed words (labels) – leave empty for default'),
              children: (
                <Row gutter={[12, 8]}>
                  {LABEL_FIELDS.map(([k, l]) => (
                    <Col xs={24} sm={12} key={k}>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>{tr(l)}</div>
                      <Input size="small" allowClear value={d.labels[k] || ''} placeholder={legacyDefault(k)} onChange={(e) => setLabel(k, e.target.value)} />
                    </Col>
                  ))}
                </Row>
              ),
            },
            {
              key: 'f',
              label: tr('Footer text'),
              children: <Input.TextArea rows={3} value={d.footerText} onChange={(e) => set({ footerText: e.target.value })} placeholder={tr('e.g. Bank: SBI A/c 1234… IFSC SBIN000… / UPI: trust@sbi')} />,
            },
          ]}
        />

        <Space wrap>
          <Button type="primary" size="large" icon={<SaveOutlined />} loading={busy} onClick={save} disabled={!dirty}>{tr('Save design')}</Button>
          {dirty ? <Button icon={<ReloadOutlined />} onClick={() => { setD(editableOf(app.settings)); setDirty(false); }}>{tr('Discard changes')}</Button> : null}
          <Popconfirm title={tr('Reset every receipt option to the default?')} onConfirm={reset}><Button icon={<UndoOutlined />}>{tr('Reset to default')}</Button></Popconfirm>
        </Space>
      </Col>

      <Col xs={24} xl={13}>
        <Card
          size="small"
          title={<Space>{tr('Live preview')}{rendering ? <Spin size="small" /> : null}</Space>}
          extra={(
            <Space>
              <Button size="small" icon={<PrinterOutlined />} onClick={() => sampleFile('print')}>{tr('Test print')}</Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => sampleFile('download')}>{tr('Download sample')}</Button>
            </Space>
          )}
          style={{ position: 'sticky', top: 76 }}
        >
          {previewError ? <Alert type="error" showIcon title={previewError} style={{ marginBottom: 8 }} /> : null}
          {preview ? (
            <iframe title="receipt-preview" src={`${preview}#toolbar=0&navpanes=0&view=FitH`} style={{ width: '100%', height: '78vh', border: '1px solid #eee', borderRadius: 6, background: '#f5f5f5' }} />
          ) : <div style={{ height: 300, display: 'grid', placeItems: 'center' }}><Spin /></div>}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{tr('Preview uses a sample donor. Real receipts use the same design.')}</Typography.Text>
        </Card>
      </Col>
    </Row>
  );
}

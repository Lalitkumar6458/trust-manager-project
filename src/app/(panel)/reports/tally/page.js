'use client';

import { useEffect, useState } from 'react';
import { Card, Button, Space, Input, Alert, Typography, DatePicker, Statistic, Row, Col } from 'antd';
import { DownloadOutlined, ExportOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Guard, PageHeader } from '@/components/common';
import { useAppData } from '@/contexts/AppDataContext';
import { useAction } from '@/lib/hooks';
import { rpcRead } from '@/lib/api';
import { fyRange, todayStr } from '@/lib/format';
import { openBlob } from '@/pdf/generate';
import { useLang } from '@/i18n/LangContext';

export default function TallyExportPage() {
  const { t: tr } = useLang();
  const app = useAppData();
  const [run, busy] = useAction();
  const [range, setRange] = useState(null);
  const [company, setCompany] = useState('');
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (range || !app.selectedFyId) return;
    const r = fyRange(app.selectedFyId);
    const end = r.end > todayStr() ? todayStr() : r.end;
    setRange([dayjs(r.start), dayjs(end)]);
  }, [app.selectedFyId, range]);
  useEffect(() => { setCompany(app.settings.tallyCompany || app.settings.nameEn || ''); }, [app.settings.tallyCompany, app.settings.nameEn]);

  const make = () => run(async () => {
    const r = await rpcRead('reports.tally', { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD'), company: company.trim() });
    setResult(r);
  });
  const dl = (kind) => {
    const tag = `${range[0].format('YYYYMMDD')}-${range[1].format('YYYYMMDD')}`;
    openBlob(new Blob([result[kind]], { type: 'application/xml' }), `Tally-${kind}-${tag}.xml`, true);
  };

  return (
    <Guard perm="reports.export">
      <PageHeader title={tr('Tally export')} subtitle={tr('Ledger entries as Tally XML – for your CA / auditor who keeps books in Tally.')} />
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap align="end">
          <div><div style={{ fontSize: 12 }}>{tr('Period')}</div><DatePicker.RangePicker value={range} onChange={setRange} format="DD-MM-YYYY" allowClear={false} /></div>
          <div><div style={{ fontSize: 12 }}>{tr('Company name in Tally (exactly)')}</div><Input style={{ width: 280 }} value={company} onChange={(e) => setCompany(e.target.value)} /></div>
          <Button type="primary" icon={<ExportOutlined />} loading={busy} disabled={!range} onClick={make}>{tr('Prepare')}</Button>
        </Space>
      </Card>
      {result ? (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={8}><Statistic title={tr('Vouchers')} value={result.counts.vouchers} /></Col>
            <Col span={8}><Statistic title={tr('Ledgers')} value={result.counts.ledgers} /></Col>
          </Row>
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={() => dl('masters')}>1. {tr('Masters (ledgers) XML')}</Button>
            <Button type="primary" icon={<DownloadOutlined />} onClick={() => dl('vouchers')}>2. {tr('Vouchers XML')}</Button>
          </Space>
        </Card>
      ) : null}
      <Alert
        type="info"
        showIcon
        title={tr('How to import in Tally')}
        description={(
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>{tr('Open the company in Tally (same name as above).')}</li>
            <li>{tr('Gateway of Tally → Import → Masters → choose the Masters XML.')}</li>
            <li>{tr('Then Import → Transactions → choose the Vouchers XML.')}</li>
            <li>{tr('Bank / cash ledgers use the account names from the panel; donation heads become “Donation - <category>” under Indirect Incomes, corpus under Capital Account.')}</li>
          </ol>
        )}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>{tr('Opening balances are not exported – enter them once in Tally. Import each period only once (re-importing creates duplicates).')}</Typography.Text>
    </Guard>
  );
}

'use client';

import Link from 'next/link';
import { Card, Col, Row, List, Typography, Alert } from 'antd';
import { FileSearchOutlined } from '@ant-design/icons';
import { PageHeader, Guard } from '@/components/common';
import { REPORT_GROUPS, REPORTS } from '@/reports/definitions';
import { useLang } from '@/i18n/LangContext';

export default function ReportsHub() {
  const { t: tr } = useLang();
  return (
    <Guard perm="reports.view">
      <PageHeader title={tr('Reports')} subtitle={tr('Every report supports date / FY / category / donor / mode / account / project / amount / status filters and Excel, CSV, PDF & Print export.')} />
      <Row gutter={[12, 12]}>
        {REPORT_GROUPS.map((g) => (
          <Col xs={24} md={12} xl={6} key={g.key}>
            <Card title={tr(g.title)} size="small" style={{ height: '100%' }}>
              <List
                size="small"
                dataSource={REPORTS.filter((r) => r.group === g.key)}
                renderItem={(r) => (
                  <List.Item style={{ paddingInline: 0 }}>
                    <Link href={`/reports/${r.key}`}><FileSearchOutlined /> {tr(r.title)}</Link>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        ))}
      </Row>
      <Alert
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        title={tr('Statutory formats')}
        description={tr('Exact government / tax formats depend on your trust\'s registration and tax status. These reports provide the underlying registers and statements; finalise the statutory format with your CA.')}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>{tr('The monthly financial report is generated automatically for any month you pick; month-end closing freezes it (Monthly Closing menu).')}</Typography.Paragraph>
    </Guard>
  );
}

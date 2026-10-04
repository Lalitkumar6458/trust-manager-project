'use client';

import { useMemo, useState } from 'react';
import { Card, Table, Select, DatePicker, Space, Tag, Input } from 'antd';
import dayjs from 'dayjs';
import { where, orderBy, limit, Timestamp } from 'firebase/firestore';
import { COL } from '@/lib/constants';
import { fmtDateTime } from '@/lib/format';
import { useLiveQuery } from '@/lib/hooks';
import { PageHeader, Guard } from '@/components/common';
import { ChangesTable } from '@/components/AuditHistory';
import ExportButtons from '@/components/ExportButtons';
import { useLang } from '@/i18n/LangContext';

const ACTION_COLOR = { create: 'green', update: 'orange', void: 'red', reverse: 'red', approve: 'blue', pay: 'blue', close: 'purple', reopen: 'magenta', login: 'default', opening_balance: 'gold' };

export default function AuditLogsPage() {
  const { t: tr } = useLang();
  const [range, setRange] = useState([dayjs().subtract(30, 'day').startOf('day'), dayjs().endOf('day')]);
  const [coll, setColl] = useState();
  const [action, setAction] = useState();
  const [text, setText] = useState('');
  const { data, loading } = useLiveQuery(
    COL.auditLogs,
    [where('at', '>=', Timestamp.fromDate(range[0].toDate())), where('at', '<=', Timestamp.fromDate(range[1].toDate())), orderBy('at', 'desc'), limit(2000)],
    [range[0].valueOf(), range[1].valueOf()],
  );
  const rows = useMemo(() => data.filter((r) => (!coll || r.collection === coll) && (!action || r.action === action)
    && (!text || [r.userName, r.ref, r.summary, r.reason].filter(Boolean).some((x) => x.toLowerCase().includes(text.toLowerCase())))), [data, coll, action, text]);
  const colls = [...new Set(data.map((d) => d.collection))].sort();
  const actions = [...new Set(data.map((d) => d.action))].sort();

  return (
    <Guard perm="auditLogs.view">
      <PageHeader
        title={tr('Audit Logs')}
        subtitle={tr('Every change – who, when, what (old → new), why. Logs are append-only and cannot be edited or deleted.')}
        extra={[<ExportButtons key="x" title={tr('Audit Trail')} subtitle={`${range[0].format('DD-MM-YYYY')} to ${range[1].format('DD-MM-YYYY')}`} rows={rows} columns={[
          { title: tr('When'), key: 'at', value: (r) => fmtDateTime(r.at) }, { title: tr('User'), key: 'userName' }, { title: tr('Role'), key: 'role' }, { title: tr('Module'), key: 'collection' },
          { title: tr('Ref'), key: 'ref' }, { title: tr('Action'), key: 'action' },
          { title: tr('Changes'), key: 'c', width: 3, value: (r) => (r.changes || []).map((c) => `${c.field}: ${JSON.stringify(c.old)} → ${JSON.stringify(c.new)}`).join('; ') },
          { title: tr('Reason'), key: 'reason', width: 2 }, { title: tr('Device'), key: 'device', width: 2 },
        ]} />]}
      />
      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          <DatePicker.RangePicker format="DD-MM-YYYY" allowClear={false} value={range} onChange={(r) => setRange([r[0].startOf('day'), r[1].endOf('day')])} />
          <Select allowClear placeholder={tr('Module')} style={{ width: 170 }} value={coll} onChange={setColl} options={colls.map((c) => ({ value: c, label: tr(c) }))} />
          <Select allowClear placeholder={tr('Action')} style={{ width: 150 }} value={action} onChange={setAction} options={actions.map((c) => ({ value: c, label: tr(c) }))} />
          <Input.Search allowClear placeholder={tr('User, reference, reason')} value={text} onChange={(e) => setText(e.target.value)} style={{ width: 220 }} />
        </Space>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 900 }}
          pagination={{ defaultPageSize: 50, showSizeChanger: true }}
          expandable={{ expandedRowRender: (r) => <div><ChangesTable changes={r.changes} />{r.device ? <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{tr('Device:')}{' '}{r.device}{r.ip ? ` · IP ${r.ip}` : ''}</div> : null}</div> }}
          columns={[
            { title: tr('When'), dataIndex: 'at', render: fmtDateTime, width: 170 },
            { title: tr('User'), dataIndex: 'userName', render: (v, r) => <span>{v} <span className="muted">({r.role})</span></span> },
            { title: tr('Module'), dataIndex: 'collection', width: 130 },
            { title: tr('Reference'), dataIndex: 'ref', width: 170 },
            { title: tr('Action'), dataIndex: 'action', render: (a) => <Tag color={ACTION_COLOR[a]}>{a}</Tag>, width: 120 },
            { title: tr('Details'), render: (_, r) => [r.summary, r.reason && tr('Reason: {v0}', { v0: r.reason })].filter(Boolean).join(' · '), ellipsis: true },
          ]}
        />
      </Card>
    </Guard>
  );
}

'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AutoComplete, Input, Tag, Button } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { globalSearch } from '@/services/search';
import { useAuth } from '@/contexts/AuthContext';
import { useLang } from '@/i18n/LangContext';

const KIND_COLOR = { Donation: 'green', Expense: 'volcano', Donor: 'blue', Beneficiary: 'purple', Vendor: 'cyan', Ledger: 'gold' };

export default function GlobalSearch({ compact }) {
  const { t: tr } = useLang();
  const router = useRouter();
  const { can } = useAuth();
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(!compact);
  const timer = useRef(null);

  const onSearch = (text) => {
    clearTimeout(timer.current);
    if (!text || text.trim().length < 2) {
      setOptions([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      const res = await globalSearch(text, { canLedger: can('ledger.view') });
      setLoading(false);
      setOptions(res.length ? res.map((r) => ({
        value: `${r.kind}:${r.id}`,
        href: r.href,
        label: (
          <div style={{ lineHeight: 1.3, padding: '2px 0' }}>
            <Tag color={KIND_COLOR[r.kind]}>{tr(r.kind)}</Tag> <b>{r.title}</b>
            <div className="muted" style={{ fontSize: 12 }}>{r.sub}</div>
          </div>
        ),
      })) : [{ value: 'none', disabled: true, label: <span className="muted">{tr('No match. Try receipt no., UTR, mobile, PAN or name.')}</span> }]);
    }, 350);
  };

  if (compact && !open) return <Button type="text" icon={<SearchOutlined />} onClick={() => setOpen(true)} />;

  return (
    <AutoComplete
      style={{ width: '100%', maxWidth: 520 }}
      options={options}
      onSearch={onSearch}
      onSelect={(_, opt) => { if (opt.href) router.push(opt.href); }}
      popupMatchSelectWidth={compact ? 300 : true}
      onBlur={() => compact && setOpen(false)}
    >
      <Input
        prefix={<SearchOutlined />}
        allowClear
        autoFocus={compact}
        placeholder={tr('Search donor, receipt / voucher no., UTR, mobile, PAN…')}
        suffix={loading ? <span className="muted">…</span> : null}
      />
    </AutoComplete>
  );
}

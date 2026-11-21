'use client';

import { DatePicker, Input, InputNumber, Select, Button, Space, Tooltip } from 'antd';
import { ClearOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { PAYMENT_MODES, STATUS_META } from '@/lib/constants';
import { useAppData } from '@/contexts/AppDataContext';
import { useLang } from '@/i18n/LangContext';

/**
 * Reusable filter bar.
 * fields: array of 'dates' | 'text' | 'donationCategory' | 'expenseCategory' | 'mode' | 'account' | 'fund' | 'status' | 'amount' | 'payeeType'
 */
export default function FilterBar({ value, onChange, fields, statuses = [], textPlaceholder, rules }) {
  const { t: tr, pick } = useLang();
  const app = useAppData();
  const set = (k, v) => onChange({ ...value, [k]: v });
  // a filter that cannot be combined with an active one is greyed out (every filter runs on the server)
  const off = rules ? disabledFields(value, rules) : {};
  const show = (name, el) => {
    if (!fields.includes(name)) return null;
    if (!off[name]) return el;
    return (
      <Tooltip title={tr('Clear “{v0}” to use this filter', { v0: tr(FIELD_LABEL[off[name]] || off[name]) })}>
        <span style={{ display: 'inline-block' }}>{el}</span>
      </Tooltip>
    );
  };
  const catOpts = (list) => list.map((c) => ({ value: c.id, label: pick(c.name, c.nameHi) }));
  return (
    <div className="filter-bar">
      {show('text', <Input.Search disabled={!!off.text} allowClear placeholder={textPlaceholder || tr('Search name, receipt, UTR, mobile…')} style={{ width: 240 }} value={value.text} onChange={(e) => set('text', e.target.value)} />)}
      {show('dates', (
        <DatePicker.RangePicker
          disabled={!!off.dates}
          format="DD-MM-YYYY"
          value={value.from ? [dayjs(value.from), dayjs(value.to)] : null}
          onChange={(r) => onChange({ ...value, from: r ? r[0].format('YYYY-MM-DD') : null, to: r ? r[1].format('YYYY-MM-DD') : null })}
          presets={[
            { label: tr('Today'), value: [dayjs(), dayjs()] },
            { label: tr('This month'), value: [dayjs().startOf('month'), dayjs().endOf('month')] },
            { label: tr('Last month'), value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
          ]}
        />
      ))}
      {show('donationCategory', <Select disabled={!!off.donationCategory} allowClear placeholder={tr('Category')} style={{ width: 190 }} value={value.categoryId} onChange={(v) => set('categoryId', v)} options={catOpts(app.donationCategories)} showSearch={{ optionFilterProp: 'label' }} />)}
      {show('expenseCategory', <Select disabled={!!off.expenseCategory} allowClear placeholder={tr('Category')} style={{ width: 190 }} value={value.categoryId} onChange={(v) => set('categoryId', v)} options={catOpts(app.expenseCategories)} showSearch={{ optionFilterProp: 'label' }} />)}
      {show('mode', <Select disabled={!!off.mode} allowClear placeholder={tr('Payment mode')} style={{ width: 150 }} value={value.mode} onChange={(v) => set('mode', v)} options={PAYMENT_MODES.map((m) => ({ value: m, label: tr(m) }))} />)}
      {show('account', <Select disabled={!!off.account} allowClear placeholder={tr('Bank / Cash account')} style={{ width: 200 }} value={value.accountId} onChange={(v) => set('accountId', v)} options={app.accounts.map((a) => ({ value: a.id, label: a.name }))} />)}
      {show('fund', <Select disabled={!!off.fund} allowClear placeholder={tr('Fund / Project')} style={{ width: 180 }} value={value.fundId} onChange={(v) => set('fundId', v)} options={app.funds.map((f) => ({ value: f.id, label: f.name }))} />)}
      {show('status', <Select disabled={!!off.status} allowClear placeholder={tr('Status')} style={{ width: 150 }} value={value.status} onChange={(v) => set('status', v)} options={statuses.map((s) => ({ value: s, label: tr(STATUS_META[s]?.label || s) }))} />)}
      {show('amount', (
        <Space.Compact>
          <InputNumber disabled={!!off.amount} placeholder={tr('Min ₹')} style={{ width: 100 }} value={value.min} onChange={(v) => set('min', v)} min={0} />
          <InputNumber disabled={!!off.amount} placeholder={tr('Max ₹')} style={{ width: 100 }} value={value.max} onChange={(v) => set('max', v)} min={0} />
        </Space.Compact>
      ))}
      <Button icon={<ClearOutlined />} onClick={() => onChange({})}>{tr('Clear')}</Button>
    </div>
  );
}

const FIELD_LABEL = {
  text: 'Search', dates: 'Date range', donationCategory: 'Category', expenseCategory: 'Category', mode: 'Payment mode', account: 'Bank / Cash account', fund: 'Fund / Project', amount: 'Amount', status: 'Status',
};

/** Which FilterBar fields are active in `value` */
export function activeFields(v) {
  const a = new Set();
  if ((v.text || '').trim().length >= 2) a.add('text');
  if (v.from) a.add('dates');
  if (v.categoryId) { a.add('donationCategory'); a.add('expenseCategory'); }
  if (v.mode) a.add('mode');
  if (v.accountId) a.add('account');
  if (v.fundId) a.add('fund');
  if (v.min != null || v.max != null) a.add('amount');
  if (v.status) a.add('status');
  return a;
}

/**
 * rules: { field: [fields it cannot be combined with] } – symmetric.
 * Returns { blockedField: activeFieldThatBlocksIt }.
 */
export function disabledFields(value, rules) {
  const act = activeFields(value);
  const out = {};
  Object.entries(rules).forEach(([a, list]) => list.forEach((b) => {
    if (act.has(a) && !act.has(b)) out[b] = out[b] || a;
    if (act.has(b) && !act.has(a)) out[a] = out[a] || b;
  }));
  return out;
}

/** Generic client-side filter */
export function applyFilters(rows, f, { textFields = () => [], categoryField, dateField = 'date' } = {}) {
  const t = (f.text || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (f.from && r[dateField] < f.from) return false;
    if (f.to && r[dateField] > f.to) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.mode && r.paymentMode !== f.mode) return false;
    if (f.accountId && r.accountId !== f.accountId) return false;
    if (f.fundId && !(r.fundIds || [r.fundId]).includes(f.fundId)) return false;
    if (f.categoryId) {
      const cats = categoryField === 'categoryIds' ? r.categoryIds || [] : [r.categoryId];
      if (!cats.includes(f.categoryId)) return false;
    }
    if (f.min !== undefined && f.min !== null && (r.amount || 0) < f.min) return false;
    if (f.max !== undefined && f.max !== null && (r.amount || 0) > f.max) return false;
    if (t && !textFields(r).filter(Boolean).some((x) => String(x).toLowerCase().includes(t))) return false;
    return true;
  });
}

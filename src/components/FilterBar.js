'use client';

import { DatePicker, Input, InputNumber, Select, Button, Space } from 'antd';
import { ClearOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { PAYMENT_MODES, STATUS_META } from '@/lib/constants';
import { useAppData } from '@/contexts/AppDataContext';
import { useLang } from '@/i18n/LangContext';

/**
 * Reusable filter bar.
 * fields: array of 'dates' | 'text' | 'donationCategory' | 'expenseCategory' | 'mode' | 'account' | 'fund' | 'status' | 'amount' | 'payeeType'
 */
export default function FilterBar({ value, onChange, fields, statuses = [], textPlaceholder }) {
  const { t: tr, pick } = useLang();
  const app = useAppData();
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="filter-bar">
      {fields.includes('text') ? (
        <Input.Search allowClear placeholder={textPlaceholder || tr('Search name, receipt, UTR, mobile…')} style={{ width: 240 }} value={value.text} onChange={(e) => set('text', e.target.value)} />
      ) : null}
      {fields.includes('dates') ? (
        <DatePicker.RangePicker
          format="DD-MM-YYYY"
          value={value.from ? [dayjs(value.from), dayjs(value.to)] : null}
          onChange={(r) => onChange({ ...value, from: r ? r[0].format('YYYY-MM-DD') : null, to: r ? r[1].format('YYYY-MM-DD') : null })}
          presets={[
            { label: tr('Today'), value: [dayjs(), dayjs()] },
            { label: tr('This month'), value: [dayjs().startOf('month'), dayjs().endOf('month')] },
            { label: tr('Last month'), value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
          ]}
        />
      ) : null}
      {fields.includes('donationCategory') ? (
        <Select allowClear placeholder={tr('Category')} style={{ width: 190 }} value={value.categoryId} onChange={(v) => set('categoryId', v)} options={app.donationCategories.map((c) => ({ value: c.id, label: pick(c.name, c.nameHi) }))} showSearch={{ optionFilterProp: 'label' }} />
      ) : null}
      {fields.includes('expenseCategory') ? (
        <Select allowClear placeholder={tr('Category')} style={{ width: 190 }} value={value.categoryId} onChange={(v) => set('categoryId', v)} options={app.expenseCategories.map((c) => ({ value: c.id, label: pick(c.name, c.nameHi) }))} showSearch={{ optionFilterProp: 'label' }} />
      ) : null}
      {fields.includes('mode') ? (
        <Select allowClear placeholder={tr('Payment mode')} style={{ width: 150 }} value={value.mode} onChange={(v) => set('mode', v)} options={PAYMENT_MODES.map((m) => ({ value: m, label: tr(m) }))} />
      ) : null}
      {fields.includes('account') ? (
        <Select allowClear placeholder={tr('Bank / Cash account')} style={{ width: 200 }} value={value.accountId} onChange={(v) => set('accountId', v)} options={app.accounts.map((a) => ({ value: a.id, label: a.name }))} />
      ) : null}
      {fields.includes('fund') ? (
        <Select allowClear placeholder={tr('Fund / Project')} style={{ width: 180 }} value={value.fundId} onChange={(v) => set('fundId', v)} options={app.funds.map((f) => ({ value: f.id, label: f.name }))} />
      ) : null}
      {fields.includes('status') ? (
        <Select allowClear placeholder={tr('Status')} style={{ width: 150 }} value={value.status} onChange={(v) => set('status', v)} options={statuses.map((s) => ({ value: s, label: STATUS_META[s]?.label || s }))} />
      ) : null}
      {fields.includes('amount') ? (
        <Space.Compact>
          <InputNumber placeholder={tr('Min ₹')} style={{ width: 100 }} value={value.min} onChange={(v) => set('min', v)} min={0} />
          <InputNumber placeholder={tr('Max ₹')} style={{ width: 100 }} value={value.max} onChange={(v) => set('max', v)} min={0} />
        </Space.Compact>
      ) : null}
      <Button icon={<ClearOutlined />} onClick={() => onChange({})}>{tr('Clear')}</Button>
    </div>
  );
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

'use client';

import { useEffect, useRef, useState } from 'react';
import { Select, Spin } from 'antd';
import { where, limit, orderBy } from 'firebase/firestore';
import { COL } from '@/lib/constants';
import { normalizeSearch } from '@/lib/keywords';
import { fetchAll, fetchOne } from '@/services/db';
import { useLang } from '@/i18n/LangContext';

/**
 * Searchable select for donors / beneficiaries (server side search by keywords).
 * value = document id; onChange(id, record)
 */
export default function PartySelect({ kind = 'donor', value, onChange, placeholder, typeFilter, style, allowClear = true, id }) {
  const { t: tr } = useLang();
  const coll = kind === 'donor' ? COL.donors : COL.beneficiaries;
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const cache = useRef({});
  const timer = useRef(null);

  const toOpt = (r) => {
    cache.current[r.id] = r;
    const code = r.donorCode || r.code || '';
    return {
      value: r.id,
      label: `${r.name}${r.organizationName ? ` (${r.organizationName})` : ''}${r.mobile ? ` · ${r.mobile}` : ''}${code ? ` · ${code}` : ''}`,
    };
  };

  const load = async (text) => {
    setLoading(true);
    try {
      const term = normalizeSearch(text || '');
      const cons = term.length >= 2 ? [where('searchKeywords', 'array-contains', term), limit(20)] : [orderBy('createdAt', 'desc'), limit(20)];
      let rows = await fetchAll(coll, ...cons);
      if (typeFilter) rows = rows.filter((r) => typeFilter.includes(r.type));
      rows = rows.filter((r) => r.status !== 'inactive');
      setOptions(rows.map(toOpt));
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [coll]);

  // make sure the selected value has a label
  useEffect(() => {
    if (value && !options.some((o) => o.value === value)) {
      fetchOne(coll, value).then((r) => r && setOptions((o) => [toOpt(r), ...o]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Select
      id={id}
      showSearch={{ filterOption: false, onSearch: (t) => { clearTimeout(timer.current); timer.current = setTimeout(() => load(t), 300); } }}
      value={value}
      onChange={(v) => onChange?.(v, v ? cache.current[v] : null)}
      notFoundContent={loading ? <Spin size="small" /> : tr('Type name / mobile / PAN to search')}
      options={options}
      placeholder={placeholder || (kind === 'donor' ? tr('Search existing donor') : tr('Search existing payee'))}
      style={{ width: '100%', ...style }}
      allowClear={allowClear}
    />
  );
}

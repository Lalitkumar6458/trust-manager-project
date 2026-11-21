'use client';

import { useEffect, useState, useRef } from 'react';
import { App } from 'antd';
import { useLang } from '@/i18n/LangContext';
import { query, onDataChanged } from '@/lib/api';

/**
 * Query that stays fresh: loaded from the server, re-loaded after every change made in
 * this browser and every 30 s while the tab is visible (changes by other users).
 * @param {string|null} coll collection name (null → skip)
 * @param {Array} constraints where / orderBy / limit (src/lib/q.js)
 * @param {Array} deps re-run when these change
 */
export function useLiveQuery(coll, constraints = [], deps = []) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const consRef = useRef(constraints);
  consRef.current = constraints;
  useEffect(() => {
    if (!coll) {
      setData([]);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    let seq = 0;
    const load = async (first) => {
      const my = ++seq; // eslint-disable-line no-plusplus
      if (first) setLoading(true);
      try {
        const r = await query({ coll, cons: consRef.current, mode: 'list' });
        if (alive && my === seq) { setData(r.rows); setError(null); }
      } catch (e) {
        // 403 = this role may not see it (the page shows “no access”) – not an error worth logging
        if (e?.status !== 403) console.error(coll, e); // eslint-disable-line no-console
        if (alive && my === seq) setError(e);
      } finally {
        if (alive && my === seq) setLoading(false);
      }
    };
    load(true);
    const off = onDataChanged(() => load(false));
    return () => { alive = false; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coll, ...deps]);
  return { data, loading, error };
}

export function useLiveDoc(coll, id) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!coll || !id) return undefined;
    let alive = true;
    const load = async (first) => {
      if (first) setLoading(true);
      try {
        const r = await query({ coll, id });
        if (alive) setData(r.doc);
      } catch {
        if (alive && first) setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load(true);
    const off = onDataChanged(() => load(false));
    return () => { alive = false; off(); };
  }, [coll, id]);
  return { data, loading };
}

/** Wraps an async action with loading state + antd message on success / error */
export function useAction() {
  const { message } = App.useApp();
  const { t: tr } = useLang();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const run = async (fn, successMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (successMsg) message.success(tr(successMsg));
      return r === undefined ? true : r;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      message.error(tr(e.message || 'Something went wrong'), 6);
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return [run, busy];
}

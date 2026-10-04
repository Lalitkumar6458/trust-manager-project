'use client';

import { useEffect, useState, useRef } from 'react';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { App } from 'antd';
import { db } from '@/lib/firebase';
import { useLang } from '@/i18n/LangContext';

/**
 * Live Firestore query.
 * @param {string|null} coll collection name (null → skip)
 * @param {Array} constraints query constraints
 * @param {Array} deps dependency list that should re-run the query
 */
export function useLiveQuery(coll, constraints = [], deps = []) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!coll) {
      setData([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const q = constraints.length ? query(collection(db, coll), ...constraints) : collection(db, coll);
    const unsub = onSnapshot(q, (snap) => {
      setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
      setError(null);
    }, (e) => {
      // eslint-disable-next-line no-console
      console.error(coll, e);
      setError(e);
      setLoading(false);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coll, ...deps]);
  return { data, loading, error };
}

export function useLiveDoc(coll, id) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!coll || !id) return undefined;
    setLoading(true);
    return onSnapshot(doc(db, coll, id), (s) => {
      setData(s.exists() ? { id: s.id, ...s.data() } : null);
      setLoading(false);
    }, () => setLoading(false));
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

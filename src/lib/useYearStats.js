'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COL } from '@/lib/constants';
import { useAuth } from '@/contexts/AuthContext';
import { rebuildStats } from '@/services/stats';

/**
 * Live year summary (stats/fy_<id>). If it does not exist yet (first use after the update,
 * or an old year) a user who may post builds it automatically once – one full read of the year.
 */
export function useYearStats(fy) {
  const { can } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const tried = useRef({});
  const canBuild = can('donations.approve') || can('expenses.pay') || can('finance.void') || can('ledger.manual');

  useEffect(() => {
    if (!fy?.id) { setStats(null); setLoading(false); return undefined; }
    setLoading(true);
    return onSnapshot(doc(db, COL.stats, `fy_${fy.id}`), (s) => {
      setStats(s.exists() ? s.data() : null);
      setLoading(false);
    }, () => { setStats(null); setLoading(false); });
  }, [fy?.id]);

  const rebuild = useCallback(async () => {
    if (!fy) return;
    setBuilding(true);
    try { await rebuildStats(fy); } finally { setBuilding(false); }
  }, [fy]);

  useEffect(() => {
    if (loading || stats || !fy || !canBuild || tried.current[fy.id]) return;
    tried.current[fy.id] = true;
    rebuild().catch(() => {});
  }, [loading, stats, fy, canBuild, rebuild]);

  return { stats, loading: loading || building, building, missing: !loading && !building && !stats, canBuild, rebuild };
}

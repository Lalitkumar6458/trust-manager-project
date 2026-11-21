'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { COL } from '@/lib/constants';
import { useLiveDoc } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { rebuildStats } from '@/services/stats';

/**
 * Year summary (stats/fy_<id>), refreshed after every change. If it does not exist yet (first use after the update,
 * or an old year) a user who may post builds it automatically once (computed on the server).
 */
export function useYearStats(fy) {
  const { can } = useAuth();
  const { data: stats, loading: docLoading } = useLiveDoc(fy?.id ? COL.stats : null, fy?.id ? `fy_${fy.id}` : null);
  const loading = fy?.id ? docLoading : false;
  const [building, setBuilding] = useState(false);
  const tried = useRef({});
  const canBuild = can('donations.approve') || can('expenses.pay') || can('finance.void') || can('ledger.manual');

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

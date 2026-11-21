'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { query, onDataChanged } from '@/lib/api';
import { orderBy } from '@/lib/q';
import { COL, DEFAULT_TRUST_SETTINGS } from '@/lib/constants';
import { fyIdOf, todayStr } from '@/lib/format';
import { useAuth } from './AuthContext';

const AppDataContext = createContext(null);
const FY_KEY = 'tm.selectedFy';

const readLS = (k) => {
  try { return window.localStorage.getItem(k); } catch { return null; }
};
const writeLS = (k, v) => {
  try { window.localStorage.setItem(k, v); } catch { /* ignore */ }
};

/**
 * Small master collections are kept in memory for the whole session (refreshed after changes):
 * settings, categories, accounts, funds, financial years, monthly closings.
 */
export function AppDataProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(DEFAULT_TRUST_SETTINGS);
  const [donationCategories, setDonationCategories] = useState([]);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [fys, setFys] = useState([]);
  const [closings, setClosings] = useState({});
  const [roles, setRoles] = useState([]);
  const [selectedFyId, setSelectedFyIdState] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    const list = (coll, cons = []) => query({ coll, cons, mode: 'list' }).then((r) => r.rows).catch(() => null);
    const load = async () => {
      const [st, dc, ec, acc, fd, fy, mc, rl] = await Promise.all([
        query({ coll: COL.settings, id: 'trust' }).then((r) => r.doc).catch(() => undefined),
        list(COL.donationCategories, [orderBy('order')]),
        list(COL.expenseCategories, [orderBy('order')]),
        list(COL.accounts),
        list(COL.funds),
        list(COL.financialYears),
        list(COL.monthlyClosings),
        list(COL.roles),
      ]);
      if (!alive) return;
      if (st !== undefined) setSettings({ ...DEFAULT_TRUST_SETTINGS, ...(st || {}) });
      if (dc) setDonationCategories(dc);
      if (ec) setExpenseCategories(ec);
      if (acc) setAccounts(acc.sort((a, b) => (a.type === b.type ? (a.name || '').localeCompare(b.name || '') : a.type === 'bank' ? -1 : 1)));
      if (fd) setFunds(fd.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      if (fy) setFys(fy.sort((a, b) => b.id.localeCompare(a.id)));
      if (mc) { const m = {}; mc.forEach((d) => { m[d.id] = d; }); setClosings(m); }
      if (rl) setRoles(rl.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setReady(true);
    };
    load();
    // master data refreshes after every change and every minute
    const off = onDataChanged(load, { pollMs: 60_000 });
    return () => { alive = false; off(); };
  }, [user]);

  // choose FY: saved selection → current flag → FY of today
  useEffect(() => {
    if (!fys.length || selectedFyId) return;
    const saved = readLS(FY_KEY);
    const pick = fys.find((f) => f.id === saved) || fys.find((f) => f.isCurrent) || fys.find((f) => f.id === fyIdOf(todayStr())) || fys[0];
    setSelectedFyIdState(pick.id);
  }, [fys, selectedFyId]);

  const value = useMemo(() => {
    const currentFy = fys.find((f) => f.isCurrent) || fys.find((f) => f.id === fyIdOf(todayStr())) || fys[0] || null;
    const selectedFy = fys.find((f) => f.id === selectedFyId) || currentFy;
    return {
      ready,
      settings,
      donationCategories,
      activeDonationCategories: donationCategories.filter((c) => c.active !== false),
      expenseCategories,
      activeExpenseCategories: expenseCategories.filter((c) => c.active !== false),
      accounts,
      activeAccounts: accounts.filter((a) => a.status !== 'inactive'),
      bankAccounts: accounts.filter((a) => a.type === 'bank'),
      cashAccounts: accounts.filter((a) => a.type === 'cash'),
      roles,
      funds,
      activeFunds: funds.filter((f) => f.status !== 'inactive'),
      fys,
      closings,
      currentFy,
      selectedFy,
      selectedFyId: selectedFy?.id || null,
      setSelectedFyId: (id) => {
        writeLS(FY_KEY, id);
        setSelectedFyIdState(id);
      },
      categoryName: (id) => donationCategories.find((c) => c.id === id)?.name || expenseCategories.find((c) => c.id === id)?.name || '',
      accountName: (id) => accounts.find((a) => a.id === id)?.name || '',
      fundName: (id) => funds.find((f) => f.id === id)?.name || '',
    };
  }, [ready, settings, donationCategories, expenseCategories, accounts, funds, fys, closings, selectedFyId, roles]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export const useAppData = () => useContext(AppDataContext);

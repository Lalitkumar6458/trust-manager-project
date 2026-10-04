'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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
 * Small master collections are kept live in memory for the whole session:
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
    const subs = [];
    const list = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const loaded = new Set();
    const mark = (k) => {
      loaded.add(k);
      if (loaded.size >= 6) setReady(true);
    };
    subs.push(onSnapshot(doc(db, COL.settings, 'trust'), (s) => { setSettings({ ...DEFAULT_TRUST_SETTINGS, ...(s.data() || {}) }); mark('s'); }, () => mark('s')));
    subs.push(onSnapshot(query(collection(db, COL.donationCategories), orderBy('order')), (s) => { setDonationCategories(list(s)); mark('dc'); }, () => mark('dc')));
    subs.push(onSnapshot(query(collection(db, COL.expenseCategories), orderBy('order')), (s) => { setExpenseCategories(list(s)); mark('ec'); }, () => mark('ec')));
    subs.push(onSnapshot(collection(db, COL.accounts), (s) => { setAccounts(list(s).sort((a, b) => (a.type === b.type ? (a.name || '').localeCompare(b.name || '') : a.type === 'bank' ? -1 : 1))); mark('a'); }, () => mark('a')));
    subs.push(onSnapshot(collection(db, COL.funds), (s) => { setFunds(list(s).sort((a, b) => (a.name || '').localeCompare(b.name || ''))); }, () => {}));
    subs.push(onSnapshot(collection(db, COL.financialYears), (s) => { setFys(list(s).sort((a, b) => b.id.localeCompare(a.id))); mark('fy'); }, () => mark('fy')));
    subs.push(onSnapshot(collection(db, COL.monthlyClosings), (s) => {
      const m = {};
      s.docs.forEach((d) => { m[d.id] = { id: d.id, ...d.data() }; });
      setClosings(m);
      mark('mc');
    }, () => mark('mc')));
    subs.push(onSnapshot(collection(db, COL.roles), (s) => { setRoles(list(s).sort((a, b) => (a.name || '').localeCompare(b.name || ''))); }, () => {}));
    return () => subs.forEach((u) => u());
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

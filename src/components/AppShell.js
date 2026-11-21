'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Layout, Menu, Select, Avatar, Dropdown, Spin, Result, Button, Tag, Grid, Space, Typography, Segmented,
} from 'antd';
import {
  DashboardOutlined, GiftOutlined, TeamOutlined, WalletOutlined, UserSwitchOutlined, ShopOutlined, BankOutlined,
  DollarOutlined, SwapOutlined, FundOutlined, BarChartOutlined, AuditOutlined, CalendarOutlined, ScheduleOutlined,
  SafetyCertificateOutlined, FileTextOutlined, CrownOutlined, UserOutlined, SettingOutlined, HistoryOutlined,
  LogoutOutlined, GlobalOutlined, CheckOutlined, KeyOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ReconciliationOutlined, LockOutlined, ThunderboltOutlined, CreditCardOutlined, CalculatorOutlined, HeartOutlined, PieChartOutlined, IdcardOutlined, FireOutlined, HomeOutlined, InboxOutlined, ToolOutlined,
} from '@ant-design/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/constants';
import GlobalSearch from './GlobalSearch';
import NotificationBell from './NotificationBell';
import { OfflineBanner, YearBanners, ChangePasswordModal, useIdleLogout, InstallAppButton, TwoFactorModal } from './ShellExtras';
import { LicenseBanner, LockedScreen, FeatureLocked, useFeatureGate } from './LicenseBits';
import { useLang } from '@/i18n/LangContext';

const { Sider, Header, Content } = Layout;

// grouped side menu (top items first, then folders); FLAT_MENU is used for permissions / highlighting
const MENU = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard', perm: 'dashboard.view' },
  { key: '/donations/quick', icon: <ThunderboltOutlined />, label: 'Quick entry', perm: 'donations.create' },
  {
    key: 'g-don', icon: <GiftOutlined />, label: 'Donations',
    children: [
      { key: '/donations', icon: <GiftOutlined />, label: 'Donations', perm: 'donations.view' },
      { key: '/online-donations', icon: <GlobalOutlined />, label: 'Online donations', perm: 'online.view' },
      { key: '/donors', icon: <TeamOutlined />, label: 'Donors', perm: 'donors.view' },
      { key: '/pledges', icon: <HeartOutlined />, label: 'Sankalp / pledges', perm: 'pledges.view' },
    ],
  },
  {
    key: 'g-exp', icon: <WalletOutlined />, label: 'Expenses',
    children: [
      { key: '/expenses', icon: <WalletOutlined />, label: 'Expenses', perm: 'expenses.view' },
      { key: '/beneficiaries', icon: <UserSwitchOutlined />, label: 'Beneficiaries', perm: 'beneficiaries.view' },
      { key: '/vendors', icon: <ShopOutlined />, label: 'Vendors', perm: 'beneficiaries.view' },
      { key: '/payroll', icon: <IdcardOutlined />, label: 'Staff & salary', perm: 'payroll.view' },
    ],
  },
  {
    key: 'g-acc', icon: <BankOutlined />, label: 'Accounts',
    children: [
      { key: '/bank-accounts', icon: <BankOutlined />, label: 'Bank Accounts', perm: 'accounts.view' },
      { key: '/cash-book', icon: <DollarOutlined />, label: 'Cash Book', perm: 'accounts.view' },
      { key: '/cash-count', icon: <CalculatorOutlined />, label: 'Cash count', perm: 'cash.count' },
      { key: '/transactions', icon: <SwapOutlined />, label: 'Transactions / Ledger', perm: 'ledger.view' },
      { key: '/funds', icon: <FundOutlined />, label: 'Funds / Projects', perm: 'funds.view' },
      { key: '/reconciliation', icon: <ReconciliationOutlined />, label: 'Bank Reconciliation', perm: 'reconciliation.view' },
      { key: '/monthly-closing', icon: <ScheduleOutlined />, label: 'Monthly Closing', perm: 'closing.view' },
      { key: '/financial-years', icon: <CalendarOutlined />, label: 'Financial Year', perm: 'fy.view' },
      { key: '/budget', icon: <PieChartOutlined />, label: 'Budget', perm: 'budget.view' },
    ],
  },
  {
    key: 'g-tmp', icon: <FireOutlined />, label: 'Temple & services',
    children: [
      { key: '/seva', icon: <FireOutlined />, label: 'Seva / pooja booking', perm: 'seva.view' },
      { key: '/bookings', icon: <HomeOutlined />, label: 'Hall / room booking', perm: 'bookings.view' },
      { key: '/inventory', icon: <InboxOutlined />, label: 'Store / inventory', perm: 'inventory.view' },
      { key: '/assets', icon: <ToolOutlined />, label: 'Asset register', perm: 'assets.view' },
    ],
  },
  {
    key: 'g-rep', icon: <BarChartOutlined />, label: 'Reports & audit',
    children: [
      { key: '/reports', icon: <BarChartOutlined />, label: 'Reports', perm: 'reports.view' },
      { key: '/audit', icon: <SafetyCertificateOutlined />, label: 'Audit', perm: 'audit.view' },
      { key: '/documents', icon: <FileTextOutlined />, label: 'Documents', perm: 'documents.view' },
      { key: '/audit-logs', icon: <HistoryOutlined />, label: 'Audit Logs', perm: 'auditLogs.view' },
    ],
  },
  {
    key: 'g-adm', icon: <SettingOutlined />, label: 'Administration',
    children: [
      { key: '/trustees', icon: <CrownOutlined />, label: 'Trustees', perm: 'trustees.view' },
      { key: '/users', icon: <UserOutlined />, label: 'Users & Roles', perm: 'users.manage' },
      { key: '/settings', icon: <SettingOutlined />, label: 'Settings', perm: 'settings.manage' },
      { key: '/system', icon: <DashboardOutlined />, label: 'System health', perm: 'system.monitor' },
      { key: '/billing', icon: <CreditCardOutlined />, label: 'Plan & billing', perm: 'billing' },
    ],
  },
];
const FLAT_MENU = MENU.flatMap((m) => (m.children ? m.children.map((c) => ({ ...c, group: m.key })) : [m]));

export default function AppShell({ children }) {
  const { t: tr, lang, setLang } = useLang();
  const { user, loading, error, logout, can } = useAuth();
  const app = useAppData();
  const pathname = usePathname();
  const router = useRouter();
  const screens = Grid.useBreakpoint();
  const [collapsed, setCollapsed] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [tfOpen, setTfOpen] = useState(false);
  const [tfSkip, setTfSkip] = useState(false);
  useIdleLogout();
  const isMobile = !screens.lg;

  useEffect(() => {
    if (!loading && !user && !error) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, error, router, pathname]);

  useEffect(() => { setCollapsed(isMobile); }, [isMobile]);

  // a role without Dashboard access lands on its first allowed screen
  useEffect(() => {
    if (!user || pathname !== '/dashboard' || can('dashboard.view')) return;
    const first = FLAT_MENU.find((m) => can(m.perm));
    if (first) router.replace(first.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, pathname]);

  // "Plan & billing" – Super Admin of a sanstha in the multi-sanstha setup
  const allowed = (perm) => (perm === 'billing' ? user?.role === 'superAdmin' && user?.license?.mode === 'saas' && user?.license?.billing !== 'fixed' : can(perm));
  const lockedFeature = useFeatureGate(pathname);
  const items = useMemo(
    () => MENU.map((m) => {
      if (!m.children) return allowed(m.perm) ? { key: m.key, icon: m.icon, label: <Link href={m.key}>{tr(m.label)}</Link> } : null;
      const kids = m.children.filter((c) => allowed(c.perm)).map((c) => ({ key: c.key, icon: c.icon, label: <Link href={c.key}>{tr(c.label)}</Link> }));
      if (!kids.length) return null;
      // a folder with one entry → show the entry directly
      return kids.length === 1 ? kids[0] : { key: m.key, icon: m.icon, label: tr(m.label), children: kids };
    }).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.role, (user?.permissions || []).join(','), lang, user?.license?.state, (user?.license?.features || []).join(',')],
  );
  const selected = FLAT_MENU.map((m) => m.key).filter((k) => pathname.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  const selectedGroup = FLAT_MENU.find((m) => m.key === selected)?.group;
  const [openKeys, setOpenKeys] = useState([]);
  useEffect(() => { if (selectedGroup) setOpenKeys((k) => (k.includes(selectedGroup) ? k : [...k, selectedGroup])); }, [selectedGroup]);

  if (loading || (!user && !error)) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spin size="large" /></div>;
  }
  if (error) {
    return <Result status="403" title={tr('No access')} subTitle={tr(error)} extra={<Button onClick={logout}>{tr('Sign out')}</Button>} />;
  }

  const fy = app.selectedFy;
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={236}
        collapsedWidth={isMobile ? 0 : 64}
        style={isMobile ? { position: 'fixed', height: '100vh', zIndex: 100, overflow: 'auto' } : { overflow: 'auto', height: '100vh', position: 'sticky', top: 0 }}
      >
        <div className="sider-brand">
          {collapsed ? '॥' : (
            <>
              {app.settings?.name || tr('Trust Manager')}
              <small>{tr('Donation & Accounting Panel')}</small>
            </>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          openKeys={collapsed ? undefined : openKeys}
          onOpenChange={setOpenKeys}
          items={items}
          onClick={() => isMobile && setCollapsed(true)}
        />
      </Sider>
      {isMobile && !collapsed ? (
        <div onClick={() => setCollapsed(true)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 99 }} />
      ) : null}
      <Layout>
        <Header style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 10, lineHeight: 'normal', borderBottom: '1px solid #eee', position: 'sticky', top: 0, zIndex: 50 }} className="no-print">
          <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
          <Select
            value={app.selectedFyId}
            onChange={app.setSelectedFyId}
            style={{ width: isMobile ? 120 : 170 }}
            options={app.fys.map((f) => ({
              value: f.id,
              label: (
                <span>
                  FY {f.id} {f.status !== 'open' ? <LockOutlined style={{ color: '#a8071a' }} /> : null}
                </span>
              ),
            }))}
            placeholder={tr('Financial year')}
          />
          {!isMobile && fy && fy.status !== 'open' ? <Tag color={fy.status === 'finalized' ? 'red' : 'orange'}>{fy.status === 'finalized' ? tr('Finalized') : tr('Closed')}</Tag> : null}
          <div style={{ flex: 1, minWidth: 0 }}><GlobalSearch compact={isMobile} /></div>
          {!isMobile ? (
            <Space size={4} title={tr('Language')}>
              <GlobalOutlined style={{ color: '#8f2d1f' }} />
              <Segmented
                size="small"
                value={lang}
                onChange={setLang}
                options={[{ value: 'en', label: 'EN' }, { value: 'hi', label: 'हिं' }]}
              />
            </Space>
          ) : null}
          <InstallAppButton />
          <NotificationBell />
          <Dropdown
            menu={{
              items: [
                { key: 'role', label: <span>{user.email}<br /><Tag color={ROLE_COLORS[user.role]}>{user.role === 'custom' ? user.roleName : tr(ROLE_LABELS[user.role])}</Tag></span>, disabled: true },
                { type: 'divider' },
                {
                  key: 'lang', icon: <GlobalOutlined />, label: tr('Language'),
                  children: [
                    { key: 'lang-en', label: 'English', icon: lang === 'en' ? <CheckOutlined /> : <span style={{ width: 14, display: 'inline-block' }} />, onClick: () => setLang('en') },
                    { key: 'lang-hi', label: 'हिन्दी', icon: lang === 'hi' ? <CheckOutlined /> : <span style={{ width: 14, display: 'inline-block' }} />, onClick: () => setLang('hi') },
                  ],
                },
                { key: 'pw', icon: <KeyOutlined />, label: tr('Change password'), onClick: () => setPwOpen(true) },
                { key: 'tf', icon: <SafetyCertificateOutlined />, label: `${tr('2-step login')}${user?.twoFactor ? ' ✓' : ''}`, onClick: () => setTfOpen(true) },
                { type: 'divider' },
                { key: 'logout', icon: <LogoutOutlined />, label: tr('Sign out'), onClick: logout },
              ],
            }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar style={{ background: '#8f2d1f' }}>{(user.name || 'U')[0].toUpperCase()}</Avatar>
              {!isMobile ? <Typography.Text>{user.name}</Typography.Text> : null}
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ margin: isMobile ? 10 : 20, minWidth: 0 }}>
          <OfflineBanner />
          {user?.license?.locked ? <LockedScreen /> : (
            <>
              <LicenseBanner />
              {app.ready ? <YearBanners /> : null}
              {lockedFeature ? <FeatureLocked feature={lockedFeature} /> : app.ready ? children : <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>}
            </>
          )}
        </Content>
        <ChangePasswordModal open={pwOpen || !!user?.mustChangePassword} forced={!!user?.mustChangePassword} onClose={() => setPwOpen(false)} />
        {(() => {
          const forced = !user?.mustChangePassword && !user?.twoFactor && !tfSkip && (app.settings.security?.require2fa || []).includes(user?.role);
          return <TwoFactorModal open={tfOpen || forced} forced={forced} onClose={() => { setTfOpen(false); if (forced) setTfSkip(true); }} />;
        })()}
      </Layout>
    </Layout>
  );
}

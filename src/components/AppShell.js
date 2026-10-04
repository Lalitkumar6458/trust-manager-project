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
  LogoutOutlined, GlobalOutlined, CheckOutlined, KeyOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ReconciliationOutlined, LockOutlined,
} from '@ant-design/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/constants';
import { isFirebaseConfigured } from '@/lib/firebase';
import GlobalSearch from './GlobalSearch';
import NotificationBell from './NotificationBell';
import { OfflineBanner, YearBanners, ChangePasswordModal, useIdleLogout } from './ShellExtras';
import { useLang } from '@/i18n/LangContext';

const { Sider, Header, Content } = Layout;

const MENU = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard', perm: 'dashboard.view' },
  { key: '/donations', icon: <GiftOutlined />, label: 'Donations', perm: 'donations.view' },
  { key: '/donors', icon: <TeamOutlined />, label: 'Donors', perm: 'donors.view' },
  { key: '/expenses', icon: <WalletOutlined />, label: 'Expenses', perm: 'expenses.view' },
  { key: '/beneficiaries', icon: <UserSwitchOutlined />, label: 'Beneficiaries', perm: 'beneficiaries.view' },
  { key: '/vendors', icon: <ShopOutlined />, label: 'Vendors', perm: 'beneficiaries.view' },
  { key: '/bank-accounts', icon: <BankOutlined />, label: 'Bank Accounts', perm: 'accounts.view' },
  { key: '/cash-book', icon: <DollarOutlined />, label: 'Cash Book', perm: 'accounts.view' },
  { key: '/transactions', icon: <SwapOutlined />, label: 'Transactions / Ledger', perm: 'ledger.view' },
  { key: '/funds', icon: <FundOutlined />, label: 'Funds / Projects', perm: 'funds.view' },
  { key: '/reports', icon: <BarChartOutlined />, label: 'Reports', perm: 'reports.view' },
  { key: '/reconciliation', icon: <ReconciliationOutlined />, label: 'Bank Reconciliation', perm: 'reconciliation.view' },
  { key: '/monthly-closing', icon: <ScheduleOutlined />, label: 'Monthly Closing', perm: 'closing.view' },
  { key: '/financial-years', icon: <CalendarOutlined />, label: 'Financial Year', perm: 'fy.view' },
  { key: '/audit', icon: <SafetyCertificateOutlined />, label: 'Audit', perm: 'audit.view' },
  { key: '/documents', icon: <FileTextOutlined />, label: 'Documents', perm: 'documents.view' },
  { key: '/trustees', icon: <CrownOutlined />, label: 'Trustees', perm: 'trustees.view' },
  { key: '/users', icon: <UserOutlined />, label: 'Users & Roles', perm: 'users.manage' },
  { key: '/settings', icon: <SettingOutlined />, label: 'Settings', perm: 'settings.manage' },
  { key: '/audit-logs', icon: <HistoryOutlined />, label: 'Audit Logs', perm: 'auditLogs.view' },
];

export default function AppShell({ children }) {
  const { t: tr, lang, setLang } = useLang();
  const { user, loading, error, logout, can } = useAuth();
  const app = useAppData();
  const pathname = usePathname();
  const router = useRouter();
  const screens = Grid.useBreakpoint();
  const [collapsed, setCollapsed] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  useIdleLogout();
  const isMobile = !screens.lg;

  useEffect(() => {
    if (!loading && !user && !error && isFirebaseConfigured) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, error, router, pathname]);

  useEffect(() => { setCollapsed(isMobile); }, [isMobile]);

  // a role without Dashboard access lands on its first allowed screen
  useEffect(() => {
    if (!user || pathname !== '/dashboard' || can('dashboard.view')) return;
    const first = MENU.find((m) => can(m.perm));
    if (first) router.replace(first.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, pathname]);

  const items = useMemo(
    () => MENU.filter((m) => can(m.perm)).map((m) => ({ key: m.key, icon: m.icon, label: <Link href={m.key}>{tr(m.label)}</Link> })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.role, (user?.permissions || []).join(','), lang],
  );
  const selected = MENU.map((m) => m.key).filter((k) => pathname.startsWith(k)).sort((a, b) => b.length - a.length)[0];

  if (!isFirebaseConfigured) {
    return <Result status="warning" title={tr('Firebase is not configured')} subTitle={tr('Copy .env.example to .env.local, fill your Firebase web-app keys and restart the dev server.')} />;
  }
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
          {app.ready ? <YearBanners /> : null}
          {app.ready ? children : <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>}
        </Content>
        <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      </Layout>
    </Layout>
  );
}

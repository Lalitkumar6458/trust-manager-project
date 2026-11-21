'use client';

import Link from 'next/link';
import { Alert, Button, Result, Space, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useLang } from '@/i18n/LangContext';
import { featureLabel, pathFeature, hasFeature } from '@/lib/features';
import { fmtDate } from '@/lib/format';

// Plan / expiry messages inside the sanstha panel (multi-sanstha mode only).

function Support({ s }) {
  const { t: tr } = useLang();
  if (!s || (!s.phone && !s.email)) return null;
  return <span> {tr('Contact')}: {[s.name, s.phone, s.email].filter(Boolean).join(' · ')}</span>;
}

export function LicenseBanner() {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const l = user?.license;
  if (!l || l.mode !== 'saas' || !['warning', 'grace', 'readonly'].includes(l.state)) return null;
  const sa = user.role === 'superAdmin' && l.billing !== 'fixed'; // fixed deal: no billing screen
  const renew = sa ? <Link href="/billing"><Button size="small" type="primary">{tr('Renew now')}</Button></Link> : null;
  if (l.state === 'warning') {
    return <Alert className="no-print" type="warning" showIcon style={{ marginBottom: 12 }} message={<span>{tr('Your plan expires on')} <b>{fmtDate(l.expiresOn)}</b> ({l.daysLeft} {tr('days left')}).<Support s={l.support} /></span>} action={renew} />;
  }
  if (l.state === 'grace') {
    return <Alert className="no-print" type="error" showIcon style={{ marginBottom: 12 }} message={<span>{tr('Your plan expired on')} <b>{fmtDate(l.expiresOn)}</b>. {tr('The panel becomes read-only on')} <b>{fmtDate(l.graceEndsOn)}</b> {tr('unless renewed.')}<Support s={l.support} /></span>} action={renew} />;
  }
  return (
    <Alert
      className="no-print"
      type="error"
      showIcon
      icon={<LockOutlined />}
      style={{ marginBottom: 12 }}
      message={tr('Plan expired – read-only mode')}
      description={<span>{tr('You can view, print and download everything, but new entries and changes are stopped until the plan is renewed. Your data is safe.')}<Support s={l.support} /></span>}
      action={renew}
    />
  );
}

/** whole panel blocked (suspended by the provider) */
export function LockedScreen() {
  const { t: tr } = useLang();
  const { user, logout } = useAuth();
  const s = user?.license?.support || {};
  return (
    <Result
      status="403"
      title={tr('Account suspended')}
      subTitle={<span>{tr('Access to this panel is paused by your software provider. Your data is safe.')}<br />{[s.name, s.phone, s.email].filter(Boolean).join(' · ')}</span>}
      extra={<Button onClick={logout}>{tr('Sign out')}</Button>}
    />
  );
}

/** page of a module that is not in the plan */
export function useFeatureGate(pathname) {
  const { user } = useAuth();
  const f = pathFeature(pathname);
  if (!f || !user?.license || hasFeature(user.license, f)) return null;
  return f;
}
export function FeatureLocked({ feature }) {
  const { t: tr, lang } = useLang();
  const { user } = useAuth();
  const s = user?.license?.support || {};
  return (
    <Result
      icon={<LockOutlined style={{ color: '#b07a2a' }} />}
      title={<span>“{featureLabel(feature, lang)}” {tr('is not in your plan')}</span>}
      subTitle={(
        <Space direction="vertical" size={2}>
          <Typography.Text>{tr('Ask your software provider to add this module to your plan.')}</Typography.Text>
          {s.phone || s.email ? <Typography.Text type="secondary">{[s.name, s.phone, s.email].filter(Boolean).join(' · ')}</Typography.Text> : null}
        </Space>
      )}
      extra={user?.role === 'superAdmin' && user?.license?.billing !== 'fixed' ? <Link href="/billing"><Button type="primary">{tr('Plan & billing')}</Button></Link> : null}
    />
  );
}

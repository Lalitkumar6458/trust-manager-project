'use client';

import { Tag, Checkbox, Row, Col, Typography } from 'antd';
import { FEATURES } from '@/lib/features';

export const inr = (n) => (n === null || n === undefined || n === '' ? '—' : `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(n))}`);
export const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—');
export const dmyt = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—');

const STATE = {
  active: ['green', 'Active'], warning: ['orange', 'Expiring soon'], grace: ['volcano', 'Expired – grace'], readonly: ['red', 'Read-only'], locked: ['default', 'Suspended'],
};
export function StateTag({ lic, trial }) {
  if (!lic) return null;
  const [c, l] = STATE[lic.state] || ['default', lic.state];
  return (
    <span>
      <Tag color={c}>{l}</Tag>
      {trial ? <Tag color="blue">Trial</Tag> : null}
    </span>
  );
}
export function daysText(lic) {
  if (!lic || lic.daysLeft === null || lic.daysLeft === undefined) return 'No expiry';
  if (lic.daysLeft > 0) return `${lic.daysLeft} days left`;
  if (lic.daysLeft === 0) return 'Expires today';
  return `Expired ${-lic.daysLeft} days ago`;
}

/** feature checkboxes (value = array of keys) */
export function FeaturePicker({ value = [], onChange, disabled, base }) {
  return (
    <Checkbox.Group value={value} onChange={onChange} disabled={disabled} style={{ width: '100%' }}>
      <Row gutter={[8, 6]}>
        {FEATURES.map((f) => (
          <Col xs={24} sm={12} key={f.key}>
            <Checkbox value={f.key}>
              {f.en}
              {base && base.includes(f.key) !== value.includes(f.key) ? <Typography.Text type="warning" style={{ fontSize: 12 }}> {value.includes(f.key) ? '(added)' : '(removed)'}</Typography.Text> : null}
            </Checkbox>
          </Col>
        ))}
      </Row>
    </Checkbox.Group>
  );
}

/**
 * Sanstha address as it opens from here: on the live server https://shawlaji.yourbrand.in,
 * on your own computer http://shawlaji.localhost:3000 (same http/port as this control panel).
 */
export function siteUrl(url) {
  if (!url || typeof window === 'undefined') return url || '';
  const { protocol, port } = window.location;
  if (protocol === 'https:' && !port) return url;
  try {
    const u = new URL(url);
    return `${protocol}//${u.hostname}${port ? `:${port}` : ''}`;
  } catch {
    return url;
  }
}

'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Badge, Button, Popover, List, Typography, Empty } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { where, orderBy, limit, arrayUnion, updateDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COL } from '@/lib/constants';
import { CUSTOM_ROLE } from '@/lib/permissions';
import { NOTIFY_PERM } from '@/services/db';

const NOTIFY_TAGS = [...new Set(Object.values(NOTIFY_PERM))].map((p) => `perm:${p}`);
import { fmtDateTime } from '@/lib/format';
import { useLiveQuery } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useLang } from '@/i18n/LangContext';

export default function NotificationBell() {
  const { t: tr } = useLang();
  const { user } = useAuth();
  const isCustom = user?.role === CUSTOM_ROLE;
  const tags = isCustom ? (user.permissions || []).map((p) => `perm:${p}`).filter((t) => NOTIFY_TAGS.includes(t)) : [];
  const { data } = useLiveQuery(
    user && (!isCustom || tags.length) ? COL.notifications : null,
    [isCustom ? where('roles', 'array-contains-any', tags) : where('roles', 'array-contains', user?.role || 'none'), orderBy('createdAt', 'desc'), limit(30)],
    [user?.role, tags.join(',')],
  );
  const unread = useMemo(() => data.filter((n) => !(n.readBy || []).includes(user?.uid)), [data, user]);

  const markRead = (ids) => Promise.all(ids.map((id) => updateDoc(doc(db, COL.notifications, id), { readBy: arrayUnion(user.uid) }))).catch(() => {});

  const content = (
    <div style={{ width: 'min(340px, 86vw)', maxHeight: 420, overflow: 'auto' }}>
      {data.length ? (
        <List
          size="small"
          dataSource={data}
          renderItem={(n) => {
            const isUnread = !(n.readBy || []).includes(user?.uid);
            return (
              <List.Item style={{ background: isUnread ? '#fff7e6' : undefined, paddingInline: 8 }}>
                <div style={{ width: '100%' }}>
                  <Link href={n.link || '#'} onClick={() => markRead([n.id])}><b>{tr(n.title)}</b></Link>
                  <div style={{ fontSize: 13 }}>{n.message}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>{fmtDateTime(n.createdAt)}</Typography.Text>
                </div>
              </List.Item>
            );
          }}
        />
      ) : <Empty description={tr('No notifications')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
    </div>
  );

  return (
    <Popover
      content={content}
      title={(
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{tr('Notifications')}</span>
          {unread.length ? <Button size="small" type="link" onClick={() => markRead(unread.map((n) => n.id))}>{tr('Mark all read')}</Button> : null}
        </div>
      )}
      trigger="click"
      placement="bottomRight"
    >
      <Badge count={unread.length} size="small" offset={[-4, 4]}>
        <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} />
      </Badge>
    </Popover>
  );
}

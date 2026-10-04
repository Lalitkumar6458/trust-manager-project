'use client';

import { useParams } from 'next/navigation';
import { Result, Spin } from 'antd';
import { COL } from '@/lib/constants';
import { useLiveDoc } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { isPeriodLocked } from '@/services/periodLock';
import { Guard, PageHeader } from '@/components/common';
import DonationForm from '@/components/DonationForm';
import { useLang } from '@/i18n/LangContext';

export default function EditDonationPage() {
  const { t: tr } = useLang();
  const { user, can } = useAuth();
  const app = useAppData();
  const { id } = useParams();
  const { data, loading } = useLiveDoc(COL.donations, id);
  if (loading) return <Spin />;
  if (!data) return <Result status="404" title={tr('Donation not found')} />;
  if (data.posted || ['approved', 'void'].includes(data.status)) {
    return <Result status="warning" title={tr('This donation can no longer be edited')} subTitle={tr('Approved / void entries are locked. Void it and create a corrected entry instead.')} />;
  }
  if (!can('donations.verify') && data.createdBy !== user.uid) {
    return <Result status="403" title={tr('You can only edit your own entries')} />;
  }
  if (isPeriodLocked({ dateStr: data.date, user, fys: app.fys, closings: app.closings })) {
    return <Result status="warning" title={tr('This period is locked (month closed / FY closed). Changes are restricted.')} />;
  }
  return (
    <Guard perm="donations.create">
      <PageHeader title={tr('Edit donation {v0}', { v0: data.receiptNo || tr('(draft)') })} />
      <DonationForm donation={data} />
    </Guard>
  );
}

'use client';

import { useParams } from 'next/navigation';
import { Result, Spin } from 'antd';
import { COL } from '@/lib/constants';
import { useLiveDoc } from '@/lib/hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData } from '@/contexts/AppDataContext';
import { isPeriodLocked } from '@/services/periodLock';
import { Guard, PageHeader } from '@/components/common';
import ExpenseForm from '@/components/ExpenseForm';
import { useLang } from '@/i18n/LangContext';

export default function EditExpensePage() {
  const { t: tr } = useLang();
  const { user, can } = useAuth();
  const app = useAppData();
  const { id } = useParams();
  const { data, loading } = useLiveDoc(COL.expenses, id);
  if (loading) return <Spin />;
  if (!data) return <Result status="404" title={tr('Expense not found')} />;
  if (data.posted || ['paid', 'void'].includes(data.status)) {
    return <Result status="warning" title={tr('This expense can no longer be edited')} subTitle={tr('Paid / void entries are locked. Void it and create a corrected entry instead.')} />;
  }
  if (!can('expenses.approve') && data.createdBy !== user.uid) {
    return <Result status="403" title={tr('You can only edit your own entries')} />;
  }
  if (isPeriodLocked({ dateStr: data.date, user, fys: app.fys, closings: app.closings })) {
    return <Result status="warning" title={tr('This period is locked (month closed / FY closed). Changes are restricted.')} />;
  }
  return (
    <Guard perm="expenses.create">
      <PageHeader title={tr('Edit expense {v0}', { v0: data.voucherNo || tr('(draft)') })} />
      <ExpenseForm expense={data} />
    </Guard>
  );
}

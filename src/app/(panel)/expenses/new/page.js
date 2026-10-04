'use client';

import { Guard, PageHeader } from '@/components/common';
import ExpenseForm from '@/components/ExpenseForm';
import { useLang } from '@/i18n/LangContext';

export default function NewExpensePage() {
  const { t: tr } = useLang();
  return (
    <Guard perm="expenses.create">
      <PageHeader title={tr('New expense / payment voucher')} subtitle={tr('भुगतान वाउचर – voucher number is generated on submit')} />
      <ExpenseForm />
    </Guard>
  );
}

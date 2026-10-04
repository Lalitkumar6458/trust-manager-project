'use client';

import PayeeListPage from '@/components/PayeeListPage';
import { useLang } from '@/i18n/LangContext';

export default function VendorsPage() {
  const { t: tr } = useLang();
  return <PayeeListPage title={tr('Vendors / Payees')} types={['vendor']} defaultType="vendor" />;
}

'use client';

import PayeeListPage from '@/components/PayeeListPage';
import { useLang } from '@/i18n/LangContext';

export default function BeneficiariesPage() {
  const { t: tr } = useLang();
  return <PayeeListPage title={tr('Beneficiaries')} types={['beneficiary', 'organization', 'staff', 'other']} defaultType="beneficiary" />;
}

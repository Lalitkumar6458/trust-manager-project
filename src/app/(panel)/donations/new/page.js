'use client';

import { Guard, PageHeader } from '@/components/common';
import DonationForm from '@/components/DonationForm';
import { useLang } from '@/i18n/LangContext';

export default function NewDonationPage() {
  const { t: tr } = useLang();
  return (
    <Guard perm="donations.create">
      <PageHeader title={tr('New donation')} subtitle={tr('दान प्रविष्टि – receipt is generated automatically')} />
      <DonationForm />
    </Guard>
  );
}

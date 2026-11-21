import { redirect } from 'next/navigation';
import { isControlRequest } from '@/server/tenant';

export const dynamic = 'force-dynamic';

export default async function Home() {
  redirect((await isControlRequest()) ? '/control' : '/dashboard');
}

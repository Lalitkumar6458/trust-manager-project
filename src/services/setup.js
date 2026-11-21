'use client';

import { authApi } from '@/lib/api';

export async function isBootstrapped() {
  const r = await authApi.setupStatus();
  if (r.error) throw new Error(r.error);
  return !!r.done;
}

/** First-time setup: Super Admin login + trust settings, categories, Cash account, current FY */
export const bootstrapTrust = (data) => authApi.setup(data);

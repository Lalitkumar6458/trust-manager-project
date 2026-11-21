'use client';

// Browser side: every change is sent to the server (src/server/rpc.js), which checks
// the permission and runs the business logic inside a PostgreSQL transaction.
import { rpc, rpcRead } from '@/lib/api';
import { buildKeywords } from '@/lib/keywords';

export const saveMaster = (collName, id, data) => rpc('masters.save', collName, id || null, data);
export const saveDonor = (id, data) => rpc('masters.saveDonor', id || null, data);
export const saveBeneficiary = (id, data) => rpc('masters.saveBeneficiary', id || null, data);
export const createAccount = (data) => rpc('masters.createAccount', data);
export const changeOpeningBalance = (accountId, fyId, newOpening, reason) => rpc('masters.openingBalance', accountId, fyId, newOpening, reason);
export const setStatus = (collName, id, status, _user, reason) => rpc('masters.setStatus', collName, id, status, reason || '');
export const saveSettings = (data) => rpc('settings.save', data);
export const donorKeywords = (d) => buildKeywords({ names: [d.name, d.organizationName], exact: [d.mobile, d.pan, d.donorCode, d.email] });
export const payeeKeywords = (d) => buildKeywords({ names: [d.name], exact: [d.mobile, d.pan, d.gstin, d.code] });
export { rpcRead };

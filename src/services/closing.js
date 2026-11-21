'use client';

// Browser side: every change is sent to the server (src/server/rpc.js), which checks
// the permission and runs the business logic inside a PostgreSQL transaction.
import { rpc, rpcRead } from '@/lib/api';

export { prevFyIdOf } from '@/lib/format';

export const pendingItems = (args) => rpcRead('closing.pending', args);
export const closeMonth = ({ monthKey, fy, notes }) => rpc('closing.closeMonth', { monthKey, fyId: fy.id, notes });
export const reopenMonth = ({ monthKey, fy, reason }) => rpc('closing.reopenMonth', { monthKey, fyId: fy.id, reason });
export const createFinancialYear = (fyId, _user, opts = {}) => rpc('fy.create', fyId, { makeCurrent: !!opts.makeCurrent });
export const setCurrentFy = (fyId) => rpc('fy.setCurrent', fyId);
export const fyChecklist = (fy) => rpcRead('fy.checklist', fy.id);
export const closeFinancialYear = ({ fy, override }) => rpc('fy.close', { fyId: fy.id, override: !!override });
export const recalcCarryForward = ({ fy }) => rpc('fy.recalc', { fyId: fy.id });
export const reopenFinancialYear = ({ fy, reason }) => rpc('fy.reopen', { fyId: fy.id, reason });
export const updateAudit = ({ fy, patch, reason }) => rpc('fy.updateAudit', { fyId: fy.id, patch, reason });
export const saveFyFields = ({ fy, patch }) => rpc('fy.saveFields', { fyId: fy.id, patch });
export const refreshProvisionalOpening = ({ fy }) => rpc('fy.refreshOpening', { fyId: fy.id });

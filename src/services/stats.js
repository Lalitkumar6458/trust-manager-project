'use client';

// Browser side: every change is sent to the server (src/server/rpc.js), which checks
// the permission and runs the business logic inside a PostgreSQL transaction.
import { rpc, rpcRead } from '@/lib/api';
import { COL } from '@/lib/constants';

export { seriesFromStats, accountOpeningAtMonth } from '@/lib/statsMath';
export const statsId = (fyId) => `fy_${fyId}`;
export const STATS_COLL = COL.stats;
export const rebuildStats = (fy) => rpc('stats.rebuild', fy.id);
export { rpcRead };

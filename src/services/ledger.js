'use client';

// Browser side: every change is sent to the server (src/server/rpc.js), which checks
// the permission and runs the business logic inside a PostgreSQL transaction.
import { rpc, rpcRead } from '@/lib/api';

export {
  reversalFields, reversalDate, withRunningBalance, fyOpeningFor, balancesAsOn,
} from '@/lib/ledgerMath';

export const createManualEntry = (input) => rpc('ledger.manual', input);
export const reverseManualEntry = (txnId, reason) => rpc('ledger.reverse', txnId, reason);
export { rpcRead };

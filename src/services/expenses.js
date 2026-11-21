'use client';

// Browser side: every change is sent to the server (src/server/rpc.js), which checks
// the permission and runs the business logic inside a PostgreSQL transaction.
import { rpc, rpcRead } from '@/lib/api';

/** ctx: { submit, approveNow, payNow } */
export const createExpense = (input, ctx = {}) => rpc('expenses.create', input, { submit: !!ctx.submit, approveNow: !!ctx.approveNow, payNow: !!ctx.payNow });
export const updateExpense = (id, input) => rpc('expenses.update', id, input);
export const submitExpense = (id) => rpc('expenses.submit', id);
export const approveExpense = (id, _user, note) => rpc('expenses.approve', id, note || '');
export const payExpense = (id, pay) => rpc('expenses.pay', id, pay || {});
export const voidExpense = (id, reason) => rpc('expenses.void', id, reason);
export { rpcRead };

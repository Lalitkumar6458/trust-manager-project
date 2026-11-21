'use client';

// Browser side: every change is sent to the server (src/server/rpc.js), which checks
// the permission and runs the business logic inside a PostgreSQL transaction.
import { rpc, rpcRead } from '@/lib/api';

/** ctx: { submit, approveNow } (other context – categories, accounts, settings – is loaded on the server) */
export const createDonation = (input, ctx = {}) => rpc('donations.create', input, { submit: !!ctx.submit, approveNow: !!ctx.approveNow });
export const updateDonation = (id, input) => rpc('donations.update', id, input);
export const submitDonation = (id) => rpc('donations.submit', id);
export const verifyDonation = (id, _user, note) => rpc('donations.verify', id, note || '');
export const approveDonation = (id, _user, note) => rpc('donations.approve', id, note || '');
export const voidDonation = (id, reason, _user, opts = {}) => rpc('donations.void', id, reason, { bounced: !!opts.bounced });
export const markReceiptPrinted = (id) => rpc('donations.printed', id);
export { rpcRead };

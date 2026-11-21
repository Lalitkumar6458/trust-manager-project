import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request information (who / from where) available to deep server code such as the audit log.
const als = new AsyncLocalStorage();

export const withRequest = (info, fn) => als.run(info, fn);
export const requestInfo = () => als.getStore() || {};

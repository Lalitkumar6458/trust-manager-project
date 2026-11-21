'use client';

// ------------------------------------------------------------------
// Browser → server calls.
//   rpc('donations.approve', id)        – any change (permission checked on the server)
//   fetchAll('donations', where(…), …)  – reads (filters / sort / paging run in PostgreSQL)
// After every successful change a "tm:data" event tells open screens to refresh.
// ------------------------------------------------------------------

const DATA_EVENT = 'tm:data';

async function post(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Check your internet connection.');
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== 'undefined' && !url.includes('/auth/')) {
    window.dispatchEvent(new Event('tm:signedout'));
  }
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    if (json.createdId) err.createdId = json.createdId;
    err.status = res.status;
    throw err;
  }
  return json;
}

/** Tell every open list / dashboard that data changed */
export function notifyDataChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DATA_EVENT));
}

/** Subscribe to data changes (own changes immediately + a periodic refresh for other users' changes) */
export function onDataChanged(cb, { pollMs = 30_000 } = {}) {
  if (typeof window === 'undefined') return () => {};
  const handler = () => cb();
  const onVisible = () => { if (document.visibilityState === 'visible') cb(); };
  window.addEventListener(DATA_EVENT, handler);
  document.addEventListener('visibilitychange', onVisible);
  const timer = pollMs ? setInterval(() => { if (document.visibilityState === 'visible') cb(); }, pollMs) : null;
  return () => {
    window.removeEventListener(DATA_EVENT, handler);
    document.removeEventListener('visibilitychange', onVisible);
    if (timer) clearInterval(timer);
  };
}

export async function rpc(name, ...args) {
  const { result } = await post('/api/rpc', { name, args });
  notifyDataChanged();
  return result;
}

/** Read-only server action (does not trigger a refresh) */
export async function rpcRead(name, ...args) {
  const { result } = await post('/api/rpc', { name, args });
  return result;
}

export const query = (body) => post('/api/query', body);

/** Every matching record (filters / order / limit run on the server) */
export async function fetchAll(coll, ...cons) {
  return (await query({ coll, cons, mode: 'list' })).rows;
}

export async function fetchOne(coll, id) {
  if (!id) return null;
  return (await query({ coll, id })).doc;
}

export async function countDocs(coll, cons = []) {
  return (await query({ coll, cons, mode: 'count' })).count;
}

/** { field: sum } over the matching records */
export async function sumDocs(coll, cons = [], fields = []) {
  return (await query({ coll, cons, mode: 'sum', fields })).sums;
}

/** Upload a file (multipart) – returns the JSON response */
export async function upload(fields, onProgress) {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => { if (v !== undefined && v !== null) form.append(k, typeof v === 'object' && !(v instanceof Blob) ? JSON.stringify(v) : v); });
  const json = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed – check your internet connection'));
    xhr.send(form);
  });
  notifyDataChanged();
  return json;
}

export const authApi = {
  me: async () => (await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })).json(),
  login: (email, password) => post('/api/auth/login', { email, password }),
  verify2fa: (code) => post('/api/auth/2fa', { code }),
  logout: () => post('/api/auth/logout', {}),
  setupStatus: async () => (await fetch('/api/setup', { cache: 'no-store' })).json(),
  setup: (data) => post('/api/setup', data),
};

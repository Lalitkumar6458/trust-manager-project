#!/usr/bin/env node
// End-to-end smoke test against a running server.
//   npm run test:smoke -- --url http://localhost:3000 [--email admin@demo.test --password demo12345] [--write]
// Read-only by default (safe on the live server). --write also saves + approves a test donation (use on demo / CI only).
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const URL_ = String(args.url || process.env.SMOKE_URL || 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = args.email || process.env.SMOKE_EMAIL || 'admin@demo.test';
const PASSWORD = args.password || process.env.SMOKE_PASSWORD || 'demo12345';
let cookie = '';
let failed = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m, e) => { failed += 1; console.log(`  ✖ ${m}${e ? ` – ${e}` : ''}`); };

async function call(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(URL_ + path, {
    method, redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), origin: URL_ },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = r.headers.get('set-cookie');
  if (set && set.includes('tm_session=')) cookie = set.split(';')[0];
  const type = r.headers.get('content-type') || '';
  return { status: r.status, json: type.includes('json') ? await r.json() : null, type };
}
const rpc = async (name, ...a) => { const r = await call('/api/rpc', { name, args: a }); if (r.json?.error) throw new Error(r.json.error); return r.json?.result; };
const q = async (body) => { const r = await call('/api/query', body); if (r.json?.error) throw new Error(r.json.error); return r.json; };

async function step(name, fn) {
  try { const m = await fn(); ok(m ? `${name}: ${m}` : name); } catch (e) { bad(name, e.message); }
}

console.log(`Smoke test → ${URL_}`);
await step('health', async () => { const r = await call('/api/health'); if (!r.json?.ok) throw new Error(JSON.stringify(r.json)); return `db ${r.json.db}`; });
await step('login', async () => {
  const r = await call('/api/auth/login', { email: EMAIL, password: PASSWORD });
  if (r.json?.needs2fa) throw new Error('account has 2-step login – use a test account without it');
  if (!r.json?.user) throw new Error(r.json?.error || r.status);
  return r.json.user.email;
});
await step('who am I', async () => { const r = await call('/api/auth/me'); if (!r.json?.user) throw new Error('no session'); return r.json.user.role; });
await step('settings', async () => { const r = await q({ coll: 'settings', id: 'trust', mode: 'doc' }); return r.doc?.name || '(not set)'; });
await step('donations list', async () => { const r = await q({ coll: 'donations', cons: [{ t: 'limit', n: 5 }], mode: 'list' }); return `${r.rows.length} rows`; });
await step('donation count', async () => { const r = await q({ coll: 'donations', cons: [], mode: 'count' }); return `${r.count ?? r.n ?? JSON.stringify(r)}`; });
await step('accounts', async () => { const r = await q({ coll: 'accounts', cons: [], mode: 'list' }); if (!r.rows.length) throw new Error('no bank / cash account'); return `${r.rows.length}`; });
for (const p of ['/login', '/dashboard', '/donations', '/donations/quick', '/reports', '/settings', '/donate', '/portal', '/manifest.webmanifest']) {
  // eslint-disable-next-line no-await-in-loop
  await step(`page ${p}`, async () => { const r = await call(p); if (r.status >= 400) throw new Error(`HTTP ${r.status}`); return `${r.status}`; });
}
await step('blocked without login', async () => {
  const keep = cookie; cookie = '';
  const r = await call('/api/query', { coll: 'donations', cons: [], mode: 'list' });
  cookie = keep;
  if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`);
  return '401';
});

if (args.write) {
  await step('create + approve donation', async () => {
    const accounts = (await q({ coll: 'accounts', cons: [], mode: 'list' })).rows;
    const cats = (await q({ coll: 'donationCategories', cons: [], mode: 'list' })).rows;
    const cash = accounts.find((a) => a.type === 'cash');
    const d = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const id = await rpc('donations.create', { date: d, paymentMode: 'Cash', accountId: cash.id, newDonor: { name: 'Smoke Test', donorType: 'Individual' }, lines: [{ categoryId: cats[0].id, amount: 11 }] }, { submit: true, approveNow: true });
    const doc = (await q({ coll: 'donations', id, mode: 'doc' })).doc;
    if (doc.status !== 'approved') throw new Error(`status ${doc.status}`);
    return doc.receiptNo;
  });
}
await call('/api/auth/logout', {});
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);

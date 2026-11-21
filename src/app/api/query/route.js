import { NextResponse } from 'next/server';
import { withUser } from '@/server/http';
import { assertCanRead, forcedFilter, redact, assertCanSum } from '@/server/access';
import { enforceCollection } from '@/server/license';
import {
  getDocs, getDoc, docRef, getCountFromServer, getAggregateFromServer, sum,
} from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROWS = 50000;

/**
 * Read API. Body:
 *  { coll, id }                              → one record
 *  { coll, cons, mode: 'list' }              → matching records (filters / sort / limit / offset run in SQL)
 *  { coll, cons, mode: 'count' }             → number of matching records
 *  { coll, cons, mode: 'sum', fields: [] }   → sums of numeric fields
 */
export const POST = withUser(async (req, user) => {
  const text = await req.text();
  if (text.length > 200_000) return NextResponse.json({ error: 'Request too large' }, { status: 413 });
  const body = JSON.parse(text || '{}');
  const { coll } = body;
  enforceCollection(coll, user.license);
  assertCanRead(user, coll, Array.isArray(body.cons) ? body.cons : []);
  const cons = [...(Array.isArray(body.cons) ? body.cons : []), ...forcedFilter(user, coll)];
  const shape = (rows) => rows.map((r) => redact(user, coll, r));
  if (body.id !== undefined) {
    if (coll === 'users' && body.id !== user.uid && user.role !== 'superAdmin') return NextResponse.json({ doc: null });
    const s = await getDoc(docRef(coll, body.id));
    return NextResponse.json({ doc: s.exists() ? redact(user, coll, { id: s.id, ...s.data() }) : null });
  }
  const q = { kind: 'query', coll, constraints: cons };
  switch (body.mode || 'list') {
    case 'count': {
      const r = await getCountFromServer(q);
      return NextResponse.json({ count: r.data().count });
    }
    case 'sum': {
      assertCanSum(user, coll, body.fields || []);
      const fields = (body.fields || []).slice(0, 10);
      const r = await getAggregateFromServer(q, Object.fromEntries(fields.map((f) => [f, sum(f)])));
      return NextResponse.json({ sums: r.data() });
    }
    default: {
      if (!cons.some((c) => c.t === 'limit')) cons.push({ t: 'limit', n: MAX_ROWS });
      const r = await getDocs(q);
      return NextResponse.json({ rows: shape(r.docs.map((d) => ({ id: d.id, ...d.data() }))) });
    }
  }
});

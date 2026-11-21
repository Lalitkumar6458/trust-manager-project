import 'server-only';

// ------------------------------------------------------------------
// Collection names (as used by the app) → PostgreSQL tables, and the
// translation of query constraints (src/lib/q.js) into SQL.
// ------------------------------------------------------------------
export const TABLES = {
  settings: 'settings',
  counters: 'counters',
  users: 'users',
  trustees: 'trustees',
  donors: 'donors',
  beneficiaries: 'beneficiaries',
  accounts: 'accounts',
  funds: 'funds',
  donationCategories: 'donation_categories',
  expenseCategories: 'expense_categories',
  donations: 'donations',
  expenses: 'expenses',
  transactions: 'transactions',
  bankStatements: 'bank_statements',
  statementLines: 'statement_lines',
  monthlyClosings: 'monthly_closings',
  financialYears: 'financial_years',
  reports: 'reports',
  auditLogs: 'audit_logs',
  documents: 'documents',
  notifications: 'notifications',
  roles: 'roles',
  stats: 'stats',
  cashCounts: 'cash_counts',
  messageLogs: 'message_logs',
  pledges: 'pledges',
  budgets: 'budgets',
  onlinePayments: 'online_payments',
  bookingResources: 'booking_resources',
  bookings: 'bookings',
  sevaTypes: 'seva_types',
  sevaBookings: 'seva_bookings',
  inventoryItems: 'inventory_items',
  stockMoves: 'stock_moves',
  assets: 'assets',
  staff: 'staff',
  payslips: 'payslips',
  errorLogs: 'error_logs',
};

export function tableOf(coll) {
  const t = TABLES[coll];
  if (!t) throw new Error(`Unknown collection: ${coll}`);
  return t;
}

const SEG = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
/** jsonb expression for a field path – written exactly like the index expressions */
export function fieldExpr(path, asText = false) {
  if (path === '__name__' || path === 'id') return asText ? 'id' : 'to_jsonb(id)';
  const segs = String(path).split('.');
  if (!segs.every((s) => SEG.test(s))) throw new Error(`Bad field name: ${path}`);
  if (segs.length === 1) return `data${asText ? '->>' : '->'}'${segs[0]}'`;
  return `data${asText ? '#>>' : '#>'}'{${segs.join(',')}}'`;
}

const TYPE_OF = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') return 'string';
  return 'object';
};

/**
 * Builds WHERE / ORDER BY / LIMIT / OFFSET for a list of constraints.
 * Returns { where, order, limit, offset, params }.
 */
export function compile(constraints = [], params = []) {
  if (constraints.length > 40) throw Object.assign(new Error('Too many filters'), { status: 400 });
  const conds = [];
  const orders = [];
  let lim = null;
  let off = null;
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const j = (v) => `${p(JSON.stringify(v))}::jsonb`;

  constraints.forEach((c) => {
    if (!c) return;
    if (c.t === 'limit') { lim = Math.max(0, Math.min(Number(c.n) || 0, 50000)); return; }
    if (c.t === 'offset') { off = Math.max(0, Math.min(Number(c.n) || 0, 10_000_000)); return; }
    if (c.t === 'order') { orders.push(`${fieldExpr(c.f)} ${c.d === 'desc' ? 'DESC NULLS LAST' : 'ASC NULLS FIRST'}`); return; }
    if (c.t === 'before') {
      // rows strictly before an anchor row in (field…, id) order – used for running balances
      const fs = Array.isArray(c.f) ? c.f : [c.f];
      const vs = Array.isArray(c.f) ? c.v : [c.v];
      conds.push(`ROW(${fs.map((f) => fieldExpr(f)).join(', ')}, id) < ROW(${vs.map((v) => j(v ?? null)).join(', ')}, ${p(String(c.id))})`);
      return;
    }
    if (c.t !== 'where') throw new Error('Bad query constraint');
    const e = fieldExpr(c.f);
    const v = c.v;
    switch (c.op) {
      case '==':
        conds.push(v === null ? `(${e} IS NULL OR ${e} = 'null'::jsonb)` : `${e} = ${j(v)}`);
        break;
      case '!=':
        conds.push(v === null ? `(${e} IS NOT NULL AND ${e} <> 'null'::jsonb)` : `(${e} IS NULL OR ${e} <> ${j(v)})`);
        break;
      case '<': case '<=': case '>': case '>=':
        conds.push(`(jsonb_typeof(${e}) = '${TYPE_OF(v)}' AND ${e} ${c.op} ${j(v)})`);
        break;
      case 'in':
        if (!Array.isArray(v) || !v.length) { conds.push('false'); break; }
        if (v.length > 500) throw Object.assign(new Error('Too many values in one filter'), { status: 400 });
        conds.push(`${e} = ANY(${p(v.map((x) => JSON.stringify(x)))}::jsonb[])`);
        break;
      case 'not-in':
        if (!Array.isArray(v) || !v.length) break;
        if (v.length > 500) throw Object.assign(new Error('Too many values in one filter'), { status: 400 });
        conds.push(`NOT (${e} = ANY(${p(v.map((x) => JSON.stringify(x)))}::jsonb[]))`);
        break;
      case 'array-contains':
        conds.push(`${e} @> ${j([v])}`);
        break;
      case 'array-contains-any':
        if (!Array.isArray(v) || !v.length) { conds.push('false'); break; }
        if (v.length > 50) throw Object.assign(new Error('Too many values in one filter'), { status: 400 });
        conds.push(`(${v.map((x) => `${e} @> ${j([x])}`).join(' OR ')})`);
        break;
      default:
        throw new Error(`Unsupported operator ${c.op}`);
    }
  });
  return {
    where: conds.length ? `WHERE ${conds.join(' AND ')}` : '',
    order: orders.length ? `ORDER BY ${orders.join(', ')}, id ${/DESC/.test(orders[orders.length - 1]) ? 'DESC' : 'ASC'}` : 'ORDER BY id',
    limit: lim !== null ? `LIMIT ${lim}` : '',
    offset: off ? `OFFSET ${off}` : '',
    params,
  };
}

/** SELECT id, data … for a collection + constraints */
export function selectSql(coll, constraints) {
  const c = compile(constraints);
  return { text: `SELECT id, data FROM ${tableOf(coll)} ${c.where} ${c.order} ${c.limit} ${c.offset}`, params: c.params };
}

export function countSql(coll, constraints) {
  const c = compile(constraints.filter((x) => x.t === 'where' || x.t === 'before'));
  return { text: `SELECT count(*)::bigint AS n FROM ${tableOf(coll)} ${c.where}`, params: c.params };
}

/** Sums of numeric fields over the matching rows (non-numbers ignored) */
export function sumSql(coll, constraints, fields) {
  const c = compile(constraints.filter((x) => x.t === 'where' || x.t === 'before'));
  const cols = fields.map((f, i) => {
    const e = fieldExpr(f);
    return `COALESCE(SUM(CASE WHEN jsonb_typeof(${e}) = 'number' THEN (${fieldExpr(f, true)})::numeric END), 0) AS s${i}`;
  });
  return { text: `SELECT ${cols.join(', ')} FROM ${tableOf(coll)} ${c.where}`, params: c.params };
}

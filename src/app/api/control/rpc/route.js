import { NextResponse } from 'next/server';
import { fail, assertSameOrigin } from '@/server/http';
import { requireOwner, changeOwnerPassword } from '@/server/control/auth';
import * as c from '@/server/control/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = {
  dashboard: () => c.dashboard(),
  'tenants.list': () => c.listTenants(),
  'tenants.get': ([id]) => c.getTenant(String(id)),
  'tenants.create': ([data], o) => c.createTenant(data || {}, o),
  'tenants.update': ([id, data], o) => c.updateTenant(String(id), data || {}, o),
  'tenants.status': ([id, status, reason], o) => c.setTenantStatus(String(id), status, reason, o),
  'payments.add': ([id, data], o) => c.addPayment(String(id), { ...(data || {}), source: 'manual', orderId: null }, o),
  'payments.void': ([id, reason], o) => c.voidPayment(String(id), reason, o),
  'payments.list': ([filter]) => c.listPayments(filter || {}),
  'plans.list': () => c.listPlans(),
  'plans.save': ([id, data], o) => c.savePlan(id || null, data || {}, o),
  'settings.get': () => c.getSettings(),
  'settings.save': ([data], o) => c.saveSettings(data || {}, o),
  'audit.list': () => c.auditLog(),
  'owner.password': ([cur, next], o) => changeOwnerPassword(o, cur, next),
};

/** POST { name, args } – owner control panel actions */
export async function POST(req) {
  try {
    assertSameOrigin(req);
    const owner = await requireOwner();
    const { name, args } = await req.json();
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name] : null;
    if (!fn) return NextResponse.json({ error: `Unknown action ${name}` }, { status: 400 });
    const result = await fn(Array.isArray(args) ? args : [], owner);
    return NextResponse.json({ result: result === undefined ? null : result });
  } catch (e) { return fail(e); }
}

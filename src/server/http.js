import 'server-only';
import { NextResponse } from 'next/server';
import { requireUser, clientInfo } from './auth';
import { withRequest } from './context';

/**
 * JSON error response. Business-rule errors (thrown with a message for the user, usually an
 * i18n key) → 400; programming / database errors → 500 with a generic message.
 */
export function fail(e) {
  const internal = !e.status && (e.severity || e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError || e instanceof RangeError);
  const status = e.status || (internal ? 500 : 400);
  if (status >= 500) {
    console.error(e); // eslint-disable-line no-console
    import('./monitor').then(({ logError }) => logError({ kind: 'server', message: e.message, stack: e.stack, path: e.path || '' })).catch(() => {});
  }
  const body = { error: internal ? 'Server error – please try again. If it keeps happening, check the server log.' : String(e.message || e) };
  if (e.createdId) body.createdId = e.createdId;
  return NextResponse.json(body, { status });
}

/** Route handler that needs a signed-in user; runs with request info for the audit log */
export function withUser(fn) {
  return async (req, ctx) => {
    try {
      const info = await clientInfo();
      const user = await requireUser();
      if (user.license?.locked) throw Object.assign(new Error('This account is suspended. Please contact your software provider.'), { status: 423 });
      return await withRequest(info, () => fn(req, user, ctx));
    } catch (e) {
      return fail(e);
    }
  };
}

/** Same-origin check for state-changing requests (CSRF protection on top of SameSite cookies) */
export function assertSameOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (new URL(origin).host !== host) throw Object.assign(new Error('Cross-site request blocked'), { status: 403 });
}

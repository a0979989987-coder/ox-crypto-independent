// The old OX Account front end (src/components/account/*) still loads on this site, but its
// Supabase login is retired here: members sign in with Google (server/app/auth.js).
// Two of its reads must keep answering, or the page would wait for them:
//   feature-access — every tool is public; the page fails closed without this list.
//   config         — the old login is not configured, so it never offers itself.
// Everything else under /api/v1/account/ is gone on Sites.
import { FEATURE_CATALOG } from '../account/feature-catalog.js';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const POLICY = Object.freeze({ ok: true, features: FEATURE_CATALOG.map(f => ({ ...f, mode: 'public', version: 'sites-public-v1' })) });
export function legacyAccountRoute(request, url) {
  const endpoint = url.pathname.slice('/api/v1/account/'.length);
  if (request.method === 'GET' && endpoint === 'feature-access') return Response.json(POLICY, { headers });
  if (request.method === 'GET' && endpoint === 'config') return Response.json({ configured: false, providerConnectionVerified: false, databaseConnected: false }, { headers });
  return Response.json({ ok: false, code: 'AUTH_PROVIDER_NOT_CONFIGURED', message: '請改用 Google 登入。' }, { status: 404, headers });
}

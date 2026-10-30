// OX 加密 on ChatGPT Sites. Static files are served by the platform first; this Worker
// handles everything else: the API, /admin, /privacy, /terms and the public data files.
import { readSnapshotAsset, snapshotAssetResponse } from './snapshots.js';
import { verifyPublisher } from './github-identity.js';
import { publishData, dataPath } from './data-store.js';
import { PUBLIC_ORIGIN } from './site.js';
import { appRoute, adminRoute } from '../server/app/routes.js';
import { authRoute, memberForUsage } from '../server/app/auth.js';
import { legacyAccountRoute } from '../server/app/legacy-account.js';

const reply = (data, status, extra = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
const PAGE_HEADERS = { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'", 'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' };
async function page(env, url, file, request, extra = {}) {
  const response = await env.ASSETS.fetch(new Request(new URL(file, url), request));
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}
// Only this Site's own pages may call its API. Browsers name the sending page in Origin.
// Allowed: the address the request came in on, crypto.oxpattern.com (OX_PUBLIC_ORIGIN) and
// the Site's chatgpt.site address (OX_SITE_ORIGIN, comma-separated if more than one).
const trimOrigin = value => String(value || '').trim().replace(/\/$/, '');
export const allowedOrigin = (origin, url, env) => origin === url.origin || origin === trimOrigin(env?.OX_PUBLIC_ORIGIN || PUBLIC_ORIGIN)
  || String(env?.OX_SITE_ORIGIN || '').split(',').map(trimOrigin).filter(Boolean).includes(origin);
// Best-effort limit per address and minute, per Worker instance. A visit makes a handful
// of API calls and the admin page a few dozen, so normal use stays far below it.
export const API_LIMIT = 600;
const hits = new Map();
function limited(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || '', now = Date.now();
  if (!ip) return false;
  const slot = hits.get(ip);
  if (!slot || now - slot.start > 60000) { if (hits.size > 5000) hits.clear(); hits.set(ip, { start: now, count: 1 }); return false; }
  return ++slot.count > API_LIMIT;
}
// Security headers on every response; a page or reply that sets its own keeps it.
const SECURE = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Strict-Transport-Security': 'max-age=15552000' };
function secure(response) {
  if (!response || response.status === 101) return response;
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURE)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env = {}, ctx) { return secure(await route(request, env, ctx)); }
};
async function route(request, env, ctx) {
    const url = new URL(request.url), storage = { bucket: env.BUCKET };
    const readData = async path => JSON.parse(new TextDecoder().decode(await readSnapshotAsset(path, env.ASSETS, storage)));
    if (url.pathname.startsWith('/api/')) {
      const origin = request.headers.get('Origin');
      if (origin && !allowedOrigin(origin, url, env)) return reply({ ok: false, error: { code: 'ORIGIN_NOT_ALLOWED' } }, 403);
      // The GitHub data publisher signs in with its own token; it is not a browser page.
      const publisher = url.pathname.startsWith('/api/v1/crypto/data-upload/');
      if (!publisher && limited(request)) return reply({ ok: false, error: { code: 'RATE_LIMITED', message: '請求太頻繁，請稍後再試' } }, 429, { 'Retry-After': '60' });
      // A page that changes something always sends Origin; a bare script does not.
      if (!publisher && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !origin) return reply({ ok: false, error: { code: 'ORIGIN_REQUIRED' } }, 403);
      try {
        if (url.pathname.startsWith('/api/v1/app/')) return await appRoute(request, env, url, req => memberForUsage(req, env));
        if (url.pathname.startsWith('/api/v1/auth/') || url.pathname.startsWith('/api/v1/me/')) return await authRoute(request, env, url);
        if (url.pathname.startsWith('/api/v1/admin/')) return await adminRoute(request, env, url, readData);
        if (url.pathname.startsWith('/api/v1/account/')) return legacyAccountRoute(request, url);
        if (url.pathname.startsWith('/api/v1/crypto/data-upload/')) {
          const identity = await verifyPublisher(request);
          if (!identity) return reply({ ok: false, error: { code: 'PUBLISHER_UNAUTHORIZED' } }, 401);
          return await publishData(request, env.BUCKET, identity);
        }
      } catch (error) {
        console.error('OX crypto API', url.pathname, error?.message);
        return reply({ ok: false, error: { code: 'SERVER_ERROR' } }, 500);
      }
      return reply({ ok: false, error: { code: 'ENDPOINT_NOT_FOUND' } }, 404);
    }
    // News, macro results, taker history and tool snapshots follow the latest data release.
    if (['GET', 'HEAD'].includes(request.method)) {
      let path = url.pathname.slice(1); try { path = decodeURIComponent(path); } catch {}
      if (dataPath(path)) try { return await snapshotAssetResponse(path, request, env.ASSETS, storage); } catch { return reply({ ok: false, error: { code: 'SNAPSHOT_UNAVAILABLE' } }, 503); }
    }
    if (!env.ASSETS) return new Response('Site assets unavailable', { status: 503 });
    if (request.method === 'GET') {
      // The owner's admin page; its data comes only from /api/v1/admin/*, which checks the signed-in owner.
      if (url.pathname === '/admin' || url.pathname === '/admin/') return page(env, url, '/admin.html', request, { ...PAGE_HEADERS, 'X-Robots-Tag': 'noindex, nofollow' });
      if (url.pathname === '/privacy' || url.pathname === '/terms') return page(env, url, url.pathname + '.html', request, { 'Cache-Control': 'no-cache' });
    }
    const response = await env.ASSETS.fetch(request);
    // A mistyped address (a chat app linking "/admin，用") must not come back as an empty
    // 404 that phones save as a file. /admin… goes to the admin page; anything else gets
    // a small page with a way home.
    if (response.status === 404 && request.method === 'GET') {
      let path = url.pathname; try { path = decodeURIComponent(path); } catch {}
      if (/^\/admin(?![a-z0-9_.-])/i.test(path)) return Response.redirect(new URL('/admin', url), 302);
      return new Response(NOT_FOUND, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return response;
}
const NOT_FOUND = '<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>找不到這個頁面｜OX 加密</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1114;color:#e9e7e2;font:16px/1.6 -apple-system,"PingFang TC","Noto Sans TC",sans-serif;text-align:center;padding:24px}a{display:inline-block;margin-top:18px;padding:10px 22px;border-radius:12px;background:#e9dcc0;color:#1b1a17;text-decoration:none;font-weight:700}p{opacity:.7}</style></head><body><div><h1>找不到這個頁面</h1><p>網址可能多打了字。</p><a href="/">回到 OX 加密</a></div></body></html>';

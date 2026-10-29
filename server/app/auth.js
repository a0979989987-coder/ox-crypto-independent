// Google sign-in for members (OpenID Connect, authorization code + PKCE + state + nonce).
//   GET  /api/v1/auth/google/start?return_to=/path
//   GET  /api/v1/auth/google/callback
//   GET  /api/v1/auth/me          → { configured, member }
//   POST /api/v1/auth/logout
//   GET/POST /api/v1/me/data      → the member's synced settings (src/app/sync-keys.js)
//   GET/POST /api/v1/me/bitget    → the member's one Bitget UID and its review status
// Sessions are random tokens in an HttpOnly cookie; only their SHA-256 is stored.
// Needs GOOGLE_CLIENT_ID and the secret GOOGLE_CLIENT_SECRET in the Site settings;
// without them (or without the database) sign-in shows 「會員功能尚未開放」.
import { db, json, bad, clip, allow, clientIP } from './store.js';
import { SYNC_KEYS, MAX_SYNC_CHARS } from '../../src/app/sync-keys.js';
import { UID } from './bitget.js';
import { PUBLIC_ORIGIN } from '../../worker/site.js';

const SESSION_DAYS = 30, STATE_MINUTES = 10;
const SYNC = new Map(SYNC_KEYS.map(item => [item.key, item]));
const bytes = n => crypto.getRandomValues(new Uint8Array(n));
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const sha256 = async text => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const fromB64url = s => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0))));

export function publicOrigin(env, url) {
  if (env?.OX_PUBLIC_ORIGIN) return String(env.OX_PUBLIC_ORIGIN).replace(/\/$/, '');
  return ['localhost', '127.0.0.1'].includes(url.hostname) ? url.origin : PUBLIC_ORIGIN;
}
// Over HTTPS the cookie carries the __Host- prefix: the browser then only accepts it
// from this exact host, Secure, Path=/ and without a Domain, so a sibling site cannot plant one.
const cookieName = origin => origin.startsWith('https:') ? '__Host-ox_crypto_session' : 'ox_crypto_session';
const sessionCookie = (token, origin, maxAge) => `${cookieName(origin)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`;
function returnPath(value) {
  if (typeof value !== 'string' || value.length > 300 || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/api/')) return '/';
  try { const u = new URL(value, 'https://app.local'); return u.origin === 'https://app.local' ? u.pathname + u.search + u.hash : '/'; } catch { return '/'; }
}
function cookieValue(request, names) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (names.includes(k)) return v.join('=');
  }
  return null;
}
const sessionToken = request => cookieValue(request, ['__Host-ox_crypto_session', 'ox_crypto_session']);

// The signed-in member's id, or null. Blocked members have no sessions.
export async function memberOf(request, env) {
  const token = sessionToken(request);
  if (!token || !/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null;
  const database = await db(env); if (!database) return null;
  const row = await database.prepare("SELECT s.member FROM sessions s JOIN members m ON m.id = s.member WHERE s.token = ? AND s.expires_at > ? AND m.status = 'active'").bind(await sha256(token), Date.now()).first();
  return row?.member || null;
}
// Usage records only need a label, so a short per-isolate memory saves a query per batch.
const recentMembers = new Map();
export async function memberForUsage(request, env) {
  const token = sessionToken(request); if (!token) return null;
  const saved = recentMembers.get(token);
  if (saved && Date.now() - saved.at < 60000) return saved.member;
  const member = await memberOf(request, env);
  recentMembers.set(token, { member, at: Date.now() }); if (recentMembers.size > 2000) recentMembers.delete(recentMembers.keys().next().value);
  return member;
}

export const BITGET_STATUS = ['pending', 'approved', 'rejected'];
export async function bitgetOf(database, member) {
  const row = await database.prepare('SELECT uid, status, note, submitted_at, reviewed_at FROM bitget_uids WHERE member = ?').bind(member).first();
  return row ? { uid: row.uid, status: row.status, note: row.status === 'pending' ? null : row.note || null, submittedAt: row.submitted_at, reviewedAt: row.reviewed_at || null, verified: row.status === 'approved' } : null;
}

export async function authRoute(request, env, url, { fetcher = fetch } = {}) {
  const path = url.pathname, database = await db(env), origin = publicOrigin(env, url);
  const configured = !!(env?.GOOGLE_CLIENT_ID && env?.GOOGLE_CLIENT_SECRET && database);
  const back = (to, extra = {}) => new Response(null, { status: 302, headers: { Location: origin + to, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...extra } });
  const post = request.method === 'POST';
  if (post && (request.headers.get('content-type') || '').split(';')[0].trim() !== 'application/json') return bad('JSON_REQUIRED', 415);

  if (path === '/api/v1/auth/me' && request.method === 'GET') {
    const member = await memberOf(request, env);
    if (!member) return json({ ok: true, data: { configured, member: null } });
    const row = await database.prepare('SELECT id, email, name, picture, last_seen FROM members WHERE id = ?').bind(member).first();
    // A visit counts once per 30 minutes of activity.
    if (Date.now() - row.last_seen > 30 * 60000) await database.prepare('UPDATE members SET last_seen = ?, visits = visits + 1 WHERE id = ?').bind(Date.now(), member).run();
    return json({ ok: true, data: { configured, member: { name: row.name, email: row.email, picture: row.picture, bitget: await bitgetOf(database, member) } } });
  }
  if (path === '/api/v1/auth/logout' && post) {
    const token = sessionToken(request);
    if (database && token) await database.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', origin, 0) });
  }
  if (path === '/api/v1/auth/google/start' && request.method === 'GET') {
    // The session cookie belongs to the public domain, so sign-in always starts there.
    if (url.origin !== origin) return Response.redirect(origin + path + url.search, 302);
    if (!configured) return back('/?login=unavailable');
    if (!allow('auth-start:' + clientIP(request), 20)) return back('/?login=failed');
    const state = b64url(bytes(24)), verifier = b64url(bytes(32)), nonce = b64url(bytes(16));
    await database.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(Date.now() - STATE_MINUTES * 60000).run();
    await database.prepare('INSERT INTO oauth_states (state, verifier, nonce, return_to, created_at) VALUES (?, ?, ?, ?, ?)').bind(state, verifier, nonce, returnPath(url.searchParams.get('return_to')), Date.now()).run();
    const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [k, v] of Object.entries({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: origin + '/api/v1/auth/google/callback', response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: await sha256(verifier), code_challenge_method: 'S256', prompt: 'select_account' })) google.searchParams.set(k, v);
    return new Response(null, { status: 302, headers: { Location: google.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }
  if (path === '/api/v1/auth/google/callback' && request.method === 'GET') {
    if (!configured) return back('/?login=unavailable');
    const state = clip(url.searchParams.get('state') || '', 100), code = clip(url.searchParams.get('code') || '', 2000);
    const saved = state && await database.prepare('SELECT verifier, nonce, return_to, created_at FROM oauth_states WHERE state = ?').bind(state).first();
    // Each state works once, for ten minutes.
    if (saved) await database.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
    if (!saved || Date.now() - saved.created_at > STATE_MINUTES * 60000) return back('/?login=expired');
    const to = saved.return_to, mark = result => to + (to.includes('?') ? '&' : '?') + 'login=' + result;
    if (!code) return back(mark('cancelled'));
    let claims;
    try {
      const response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
        body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: origin + '/api/v1/auth/google/callback', grant_type: 'authorization_code', code_verifier: saved.verifier }) });
      const token = await response.json();
      if (!response.ok || typeof token.id_token !== 'string' || token.id_token.length > 8000) throw Error('token');
      // Received directly from Google's token endpoint over TLS with our client
      // secret, so the claims are checked rather than the signature (OIDC 3.1.3.7).
      claims = fromB64url(token.id_token.split('.')[1]);
    } catch { return back(mark('failed')); }
    const now = Date.now();
    const valid = ['https://accounts.google.com', 'accounts.google.com'].includes(claims?.iss) && claims.aud === env.GOOGLE_CLIENT_ID && (!claims.azp || claims.azp === env.GOOGLE_CLIENT_ID) &&
      Number(claims.exp) * 1000 > now && typeof claims.nonce === 'string' && claims.nonce === saved.nonce && typeof claims.sub === 'string' && /^[0-9A-Za-z_-]{1,64}$/.test(claims.sub) &&
      typeof claims.email === 'string' && claims.email.includes('@') && claims.email_verified !== false && claims.email_verified !== 'false';
    if (!valid) return back(mark('failed'));
    const id = 'g:' + claims.sub;
    const existing = await database.prepare('SELECT status FROM members WHERE id = ?').bind(id).first();
    if (existing?.status === 'blocked') return back(mark('blocked'));
    const text = (v, n) => typeof v === 'string' ? v.slice(0, n) : null;
    await database.prepare('INSERT INTO members (id, email, name, picture, created_at, last_seen, visits) VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture, last_seen = excluded.last_seen, visits = visits + 1')
      .bind(id, text(claims.email, 200), text(claims.name, 100), /^https:\/\//.test(claims.picture || '') ? text(claims.picture, 500) : null, now, now).run();
    const session = b64url(bytes(32));
    await database.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
    await database.prepare('INSERT INTO sessions (token, member, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(session), id, now, now + SESSION_DAYS * 86400000).run();
    return back(mark('ok'), { 'Set-Cookie': sessionCookie(session, origin, SESSION_DAYS * 86400) });
  }

  if (path === '/api/v1/me/data' || path === '/api/v1/me/bitget') {
    const member = await memberOf(request, env);
    if (!member) return bad('SIGN_IN_REQUIRED', 401);
    if (post && !allow('me:' + member, 60)) return bad('RATE_LIMITED', 429);
    if (path === '/api/v1/me/data' && request.method === 'GET') {
      const rows = (await database.prepare('SELECT key, value FROM member_data WHERE member = ?').bind(member).all()).results;
      const data = {}; for (const r of rows) if (SYNC.has(r.key)) try { data[r.key] = JSON.parse(r.value); } catch {}
      return json({ ok: true, data });
    }
    if (path === '/api/v1/me/data' && post) {
      let body; try { body = JSON.parse(await limitedText(request, MAX_SYNC_CHARS + 400)); } catch { return bad('INVALID_JSON'); }
      const item = SYNC.get(body?.key);
      if (!item || body.value === undefined) return bad('INVALID_INPUT');
      if (body.value === null) { await database.prepare('DELETE FROM member_data WHERE member = ? AND key = ?').bind(member, item.key).run(); return json({ ok: true }); }
      if (!validValue(item, body.value)) return bad('INVALID_INPUT');
      const value = JSON.stringify(body.value);
      if (value.length > MAX_SYNC_CHARS) return bad('TOO_LARGE', 413);
      await database.prepare('INSERT INTO member_data (member, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(member, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(member, item.key, value, Date.now()).run();
      return json({ ok: true });
    }
    if (path === '/api/v1/me/bitget' && request.method === 'GET') return json({ ok: true, data: await bitgetOf(database, member) });
    if (path === '/api/v1/me/bitget' && post) {
      let body; try { body = JSON.parse(await limitedText(request, 400)); } catch { return bad('INVALID_JSON'); }
      const uid = typeof body?.uid === 'string' ? body.uid.trim() : '';
      if (!UID.test(uid)) return bad('INVALID_UID');
      const now = Date.now(), current = await bitgetOf(database, member);
      if (current?.uid === uid) return json({ ok: true, data: current });
      // A few changes a day is plenty; this also keeps the review list readable.
      const changes = (await database.prepare("SELECT COUNT(*) n FROM bitget_audit WHERE member = ? AND action = 'submit' AND ts > ?").bind(member, now - 86400000).first())?.n || 0;
      if (changes >= 5) return bad('RATE_LIMITED', 429);
      await database.batch([
        database.prepare("INSERT INTO bitget_uids (member, uid, status, note, submitted_at, reviewed_at, reviewed_by, check_result, checked_at) VALUES (?, ?, 'pending', NULL, ?, NULL, NULL, NULL, NULL) ON CONFLICT(member) DO UPDATE SET uid = excluded.uid, status = 'pending', note = NULL, submitted_at = excluded.submitted_at, reviewed_at = NULL, reviewed_by = NULL, check_result = NULL, checked_at = NULL").bind(member, uid, now),
        database.prepare("INSERT INTO bitget_audit (ts, member, uid, action, actor, status, note) VALUES (?, ?, ?, 'submit', 'member', 'pending', NULL)").bind(now, member, uid)
      ]);
      return json({ ok: true, data: await bitgetOf(database, member) });
    }
  }
  return bad('NOT_FOUND', 404);
}

async function limitedText(request, max) {
  const text = await request.text();
  if (text.length > max) throw Error('too large');
  return text;
}
// Synced values keep the shape the page stores: lists stay lists, one setting stays one value.
function validValue(item, value) {
  if (item.type === 'text') return typeof value === 'string' && value.length <= 2000;
  if (item.merge === 'records') return Array.isArray(value) && value.length <= 200 && value.every(v => v && typeof v === 'object' && !Array.isArray(v) && typeof v.symbol === 'string' && v.symbol.length <= 40);
  if (item.merge === 'list') return Array.isArray(value) && value.length <= 200 && value.every(v => ['string', 'number'].includes(typeof v) && String(v).length <= 100);
  return value !== null && ['object', 'string', 'number', 'boolean'].includes(typeof value);
}

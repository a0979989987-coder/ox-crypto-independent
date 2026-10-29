// /api/v1/app/*   — public: usage records, site announcement and switches, feedback.
// /api/v1/admin/* — owner only: Sites signs the owner in with ChatGPT and sends the
// verified email in oai-authenticated-user-email (the platform removes any copy a
// visitor sends). OX_ADMIN_EMAILS (comma separated) may name other admins.
import { db, taipeiDay, clip, json, bad, readJSON, allow, clientIP } from './store.js';
import { BITGET_STATUS } from './auth.js';
import { bitgetConfigured, createBitgetChecker, BitgetCheckError } from './bitget.js';
import { PATTERNS } from '../../src/markets/crypto/patterns/catalog.js';
import { SYNC_KEYS } from '../../src/app/sync-keys.js';
const PATTERN_NAMES = Object.fromEntries(PATTERNS.map(p => [p.id, p.name]));
const INDICATOR_NAMES = { vol: '成交量', 'ox-markers': 'OX 指標', 'key-levels': '前高前低' };
const NAME = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const SWITCH_KEY = /^tool\.[a-z0-9][a-z0-9-]{0,30}$/;
const TOPICS = ['功能建議', '操作問題', '資料 / 顯示問題', '其他'];
const DEFAULT_ADMINS = ['a0979989987@gmail.com'];
export const admins = env => new Set(String(env?.OX_ADMIN_EMAILS || DEFAULT_ADMINS.join(',')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean));

// Device class from the User-Agent; the agent string itself is not stored.
export function deviceClass(ua = '') {
  const os = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : 'desktop';
  const app = /Line\//i.test(ua) ? 'line' : /Threads|Barcelona/i.test(ua) ? 'threads' : /Instagram/i.test(ua) ? 'instagram' : /FBAN|FBAV|FB_IAB/i.test(ua) ? 'facebook' : /MicroMessenger/i.test(ua) ? 'wechat' : 'browser';
  return `${os}:${app}`;
}

// The announcement and switches change rarely; each isolate re-reads them every 15 s.
let configCache = { at: 0, database: null, data: null };
export async function siteConfig(database) {
  if (configCache.database === database && Date.now() - configCache.at < 15000) return configCache.data;
  const now = Date.now();
  const announcement = await database.prepare('SELECT id, text, link FROM announcements WHERE starts_at <= ? AND (ends_at IS NULL OR ends_at > ?) ORDER BY starts_at DESC, id DESC LIMIT 1').bind(now, now).first();
  const flags = (await database.prepare('SELECT key, value, message FROM flags').all()).results;
  const maintenance = flags.find(f => f.key === 'maintenance' && f.value === 'on');
  const off = Object.fromEntries(flags.filter(f => SWITCH_KEY.test(f.key) && f.value === 'off').map(f => [f.key.slice(5), f.message || '']));
  const data = { announcement: announcement || null, maintenance: maintenance ? { message: maintenance.message || '' } : null, off };
  configCache = { at: Date.now(), database, data };
  return data;
}
const forgetConfig = () => { configCache = { at: 0, database: null, data: null }; };

export async function appRoute(request, env, url, memberOf = async () => null) {
  const path = url.pathname.slice('/api/v1/app/'.length), database = await db(env);
  if (path === 'config' && request.method === 'GET') {
    if (!database) return json({ ok: true, data: { announcement: null, maintenance: null, off: {} } });
    return json({ ok: true, data: await siteConfig(database) });
  }
  if (request.method === 'POST' && (request.headers.get('content-type') || '').split(';')[0].trim() !== 'application/json') return bad('JSON_REQUIRED', 415);
  if (path === 'track' && request.method === 'POST') {
    if (!database) return json({ ok: true, data: { stored: 0 } });
    let body; try { body = await readJSON(request); } catch { return bad('INVALID_JSON'); }
    const device = clip(body.device, 40);
    if (!/^[a-z0-9-]{8,40}$/i.test(device) || !Array.isArray(body.events)) return bad('INVALID_INPUT');
    if (!allow('track:' + clientIP(request), 60) || !allow('track:' + device, 30)) return bad('RATE_LIMITED', 429);
    const events = body.events.slice(0, 40).filter(e => e && typeof e === 'object' && NAME.test(e.name || ''));
    const now = Date.now(), day = taipeiDay(now), cls = deviceClass(request.headers.get('user-agent') || ''), member = await memberOf(request);
    if (events.length) await database.batch(events.map(e => database.prepare('INSERT INTO events (ts, day, device, member, kind, name, detail) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(now, day, device, member, cls, e.name, clip(typeof e.detail === 'number' ? String(e.detail) : e.detail, 60) || null)));
    // Records are kept about 400 days.
    if (Math.random() < .002) await database.prepare('DELETE FROM events WHERE ts < ?').bind(now - 400 * 86400000).run();
    return json({ ok: true, data: { stored: events.length } });
  }
  if (path === 'feedback' && request.method === 'POST') {
    if (!database) return bad('STORAGE_UNAVAILABLE', 503);
    let body; try { body = await readJSON(request, 6000); } catch { return bad('INVALID_JSON'); }
    const text = clip(body.text, 2000), device = clip(body.device, 40);
    if (text.length < 2) return bad('EMPTY');
    const contact = clip(body.contact, 120);
    if (contact && !/^[^\s@<>]{1,64}@[^\s@<>]{1,100}\.[^\s@<>]{2,}$/.test(contact)) return bad('INVALID_CONTACT');
    if (!allow('feedback:' + clientIP(request), 5, 600000)) return bad('RATE_LIMITED', 429);
    const now = Date.now();
    // The same device, or everyone together, can only send so much (shared by all isolates).
    const recent = await database.prepare('SELECT COUNT(*) n, SUM(CASE WHEN device = ? THEN 1 ELSE 0 END) mine FROM feedback WHERE ts > ?').bind(device || '-', now - 600000).first();
    if ((recent?.mine || 0) >= 5 || (recent?.n || 0) >= 60) return bad('RATE_LIMITED', 429);
    const topic = TOPICS.includes(body.topic) ? body.topic : null;
    await database.prepare('INSERT INTO feedback (ts, device, member, page, topic, contact, text) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(now, device || null, await memberOf(request), clip(body.page, 40) || null, topic, contact || null, text).run();
    return json({ ok: true });
  }
  return bad('NOT_FOUND', 404);
}

// ---------- owner only ----------
const RANGES = { 1: 1, 7: 7, 30: 30, 90: 90 };
const since = days => taipeiDay(Date.now() - (days - 1) * 86400000);
async function rows(database, sql, ...args) { return (await database.prepare(sql).bind(...args).all()).results; }
const coin = symbol => String(symbol || '').replace(/USDT$/, '');
const csvCell = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };

export async function adminRoute(request, env, url, readData = async () => null, { fetcher } = {}) {
  const email = (request.headers.get('oai-authenticated-user-email') || '').trim().toLowerCase();
  if (!email) return bad('SIGN_IN_REQUIRED', 401);
  if (!admins(env).has(email)) return bad('NOT_ADMIN', 403);
  const post = request.method === 'POST';
  if (post && (request.headers.get('content-type') || '').split(';')[0].trim() !== 'application/json') return bad('JSON_REQUIRED', 415);
  const database = await db(env), path = url.pathname.slice('/api/v1/admin/'.length), q = url.searchParams;
  if (path === 'me') return json({ ok: true, data: { email, storage: !!database, bitgetCheck: bitgetConfigured(env), googleSignIn: !!(env?.GOOGLE_CLIENT_ID && env?.GOOGLE_CLIENT_SECRET) } });
  if (!database) return bad('STORAGE_UNAVAILABLE', 503);
  let body = {};
  if (post) try { body = await readJSON(request); } catch { return bad('INVALID_JSON'); }
  const days = RANGES[q.get('days')] || 7, from = since(days), now = Date.now();
  const count = async (sql, ...a) => (await database.prepare(sql).bind(...a).first())?.n || 0;

  if (path === 'overview') {
    const visitors = {}, signedIn = {};
    for (const d of [1, 7, 30]) visitors[d] = await count('SELECT COUNT(DISTINCT device) n FROM events WHERE day >= ?', since(d));
    for (const d of [1, 7, 30]) signedIn[d] = await count('SELECT COUNT(DISTINCT member) n FROM events WHERE day >= ? AND member IS NOT NULL', since(d));
    return json({ ok: true, data: {
      visitors, signedIn, online: await count('SELECT COUNT(DISTINCT device) n FROM events WHERE ts >= ?', now - 5 * 60000),
      members: await count('SELECT COUNT(*) n FROM members'), newMembers: await count('SELECT COUNT(*) n FROM members WHERE created_at >= ?', now - 7 * 86400000),
      feedbackNew: await count("SELECT COUNT(*) n FROM feedback WHERE status = 'new'"),
      bitgetPending: await count("SELECT COUNT(*) n FROM bitget_uids WHERE status = 'pending'"),
      daily: await rows(database, 'SELECT day, COUNT(DISTINCT device) visitors, COUNT(*) events FROM events WHERE day >= ? GROUP BY day ORDER BY day', since(30))
    } });
  }
  if (path === 'features') return json({ ok: true, data: await rows(database, 'SELECT name, COUNT(*) uses, COUNT(DISTINCT device) people FROM events WHERE day >= ? GROUP BY name ORDER BY uses DESC LIMIT 80', from) });
  if (path === 'devices') return json({ ok: true, data: await rows(database, 'SELECT kind, COUNT(DISTINCT device) people FROM events WHERE day >= ? GROUP BY kind ORDER BY people DESC', from) });
  if (path === 'popular') {
    const top = (name, limit = 20) => rows(database, 'SELECT detail, COUNT(*) uses, COUNT(DISTINCT device) people FROM events WHERE day >= ? AND name = ? AND detail IS NOT NULL GROUP BY detail ORDER BY people DESC, uses DESC LIMIT ?', from, name, limit);
    const label = (list, pick) => list.map(r => ({ ...r, detail: pick(r.detail) }));
    return json({ ok: true, data: {
      coins: label(await top('coin.view'), coin), watch: label(await top('watch.add'), coin), charts: label(await top('analytics.chart'), coin),
      patterns: label(await top('board.preset'), id => PATTERN_NAMES[id] || id), boardFrames: await top('board.frame'), chartFrames: await top('chart.frame'),
      indicators: label(await top('chart.indicator'), id => INDICATOR_NAMES[id] || id), cards: label(await top('board.card'), coin),
      draws: await count("SELECT COUNT(*) n FROM events WHERE day >= ? AND name = 'board.draw'", from),
      presets: await count("SELECT COUNT(*) n FROM events WHERE day >= ? AND name = 'board.preset'", from),
      rescans: await count("SELECT COUNT(*) n FROM events WHERE day >= ? AND name = 'board.scan'", from)
    } });
  }
  if (path === 'system') {
    const read = async (file, pick) => { try { return pick(await readData(file)) || null; } catch { return null; } };
    return json({ ok: true, data: {
      news: await read('data/news.json', j => j?.generatedAt), macro: await read('data/macro-results.json', j => j?.generatedAt), flow: await read('previews/data/crypto-flow-history.json', j => j?.collectedAt),
      breakouts: await read('data/crypto-breakouts.json', j => j?.updatedAt),
      errors: await rows(database, "SELECT day, COUNT(*) n FROM events WHERE name = 'app.error' AND day >= ? GROUP BY day ORDER BY day", since(7)),
      recentErrors: await rows(database, "SELECT detail, COUNT(*) n FROM events WHERE name = 'app.error' AND day >= ? GROUP BY detail ORDER BY n DESC LIMIT 10", since(7))
    } });
  }

  if (path === 'announcements' && request.method === 'GET') return json({ ok: true, data: await rows(database, 'SELECT id, text, link, starts_at, ends_at, created_at, created_by FROM announcements ORDER BY created_at DESC, id DESC LIMIT 50') });
  if (path === 'announcements' && post) {
    forgetConfig();
    if (body.delete !== undefined) { const id = Number(body.delete); if (!Number.isSafeInteger(id)) return bad('INVALID_INPUT'); await database.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run(); return json({ ok: true }); }
    // 下架: end what is showing now (one announcement, or all of them).
    if (body.clear !== undefined) {
      if (body.clear === 'all') await database.prepare('UPDATE announcements SET ends_at = ? WHERE ends_at IS NULL OR ends_at > ?').bind(now, now).run();
      else { const id = Number(body.clear); if (!Number.isSafeInteger(id)) return bad('INVALID_INPUT'); await database.prepare('UPDATE announcements SET ends_at = ? WHERE id = ? AND (ends_at IS NULL OR ends_at > ?)').bind(now, id, now).run(); }
      return json({ ok: true });
    }
    const text = clip(body.text, 200), link = clip(body.link, 300);
    if (!text) return bad('EMPTY');
    if (link && !/^https:\/\/[^\s<>"']+$/.test(link)) return bad('LINK_MUST_BE_HTTPS');
    const ends = Number.isSafeInteger(Number(body.ends_at)) && Number(body.ends_at) > 0 ? Number(body.ends_at) : null;
    if (ends && ends <= now) return bad('END_IN_PAST');
    // One announcement at a time: a new one replaces the one showing.
    await database.batch([
      database.prepare('UPDATE announcements SET ends_at = ? WHERE ends_at IS NULL OR ends_at > ?').bind(now, now),
      database.prepare('INSERT INTO announcements (text, link, starts_at, ends_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(text, link || null, now, ends, now, email)
    ]);
    return json({ ok: true });
  }

  if (path === 'flags' && request.method === 'GET') return json({ ok: true, data: await rows(database, 'SELECT key, value, message, updated_at, updated_by FROM flags ORDER BY key') });
  if (path === 'flags' && post) {
    const key = clip(body.key, 40);
    if (key !== 'maintenance' && !SWITCH_KEY.test(key)) return bad('INVALID_INPUT');
    const value = key === 'maintenance' ? (body.on ? 'on' : 'off') : (body.off ? 'off' : 'on');
    await database.prepare('INSERT INTO flags (key, value, message, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, message = excluded.message, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .bind(key, value, clip(body.message, 120) || null, now, email).run();
    forgetConfig();
    return json({ ok: true });
  }

  if (path === 'feedback' && request.method === 'GET') {
    const status = q.get('status') === 'new' ? "WHERE f.status = 'new'" : '';
    return json({ ok: true, data: await rows(database, `SELECT f.id, f.ts, f.page, f.topic, f.contact, f.text, f.status, f.handled_at, f.handled_by, m.name member_name, m.email member_email FROM feedback f LEFT JOIN members m ON m.id = f.member ${status} ORDER BY f.ts DESC LIMIT 200`) });
  }
  if (path === 'feedback' && post) {
    const done = body.status === 'done', id = Number(body.id);
    if (!Number.isSafeInteger(id)) return bad('INVALID_INPUT');
    await database.prepare('UPDATE feedback SET status = ?, handled_at = ?, handled_by = ? WHERE id = ?').bind(done ? 'done' : 'new', done ? now : null, done ? email : null, id).run();
    return json({ ok: true });
  }

  if (path === 'members' && request.method === 'GET') {
    // Search text is literal: % and _ match themselves.
    const term = '%' + clip(q.get('q'), 60).replace(/[!%_]/g, c => '!' + c) + '%';
    const list = await rows(database, `SELECT m.id, m.email, m.name, m.created_at, m.last_seen, m.visits, m.status, b.uid bitget_uid, b.status bitget_status
      FROM members m LEFT JOIN bitget_uids b ON b.member = m.id WHERE m.email LIKE ? ESCAPE '!' OR m.name LIKE ? ESCAPE '!' ORDER BY m.last_seen DESC LIMIT 500`, term, term);
    const synced = await rows(database, `SELECT member, key, CASE WHEN json_valid(value) THEN CASE WHEN json_type(value) = 'array' THEN json_array_length(value) END END items FROM member_data WHERE member IN (SELECT id FROM members WHERE email LIKE ? ESCAPE '!' OR name LIKE ? ESCAPE '!' ORDER BY last_seen DESC LIMIT 500)`, term, term);
    const labels = Object.fromEntries(SYNC_KEYS.map(k => [k.key, k.label]));
    const byMember = new Map();
    for (const r of synced) { const list = byMember.get(r.member) || []; list.push(r.items == null ? labels[r.key] || r.key : `${labels[r.key] || r.key} ${r.items}`); byMember.set(r.member, list); }
    return json({ ok: true, data: list.map(m => ({ ...m, synced: byMember.get(m.id) || [] })) });
  }
  if (path === 'members' && post) {
    const id = clip(body.id, 80), status = ['active', 'blocked'].includes(body.status) ? body.status : null;
    if (!id || !status) return bad('INVALID_INPUT');
    await database.prepare('UPDATE members SET status = ? WHERE id = ?').bind(status, id).run();
    if (status === 'blocked') await database.prepare('DELETE FROM sessions WHERE member = ?').bind(id).run();
    return json({ ok: true });
  }
  if (path === 'export' && request.method === 'GET') {
    const kind = q.get('kind') === 'members' ? 'members' : 'features';
    const list = kind === 'members'
      ? await rows(database, 'SELECT m.email, m.name, m.created_at, m.last_seen, m.visits, m.status, b.uid bitget_uid, b.status bitget_status FROM members m LEFT JOIN bitget_uids b ON b.member = m.id ORDER BY m.created_at')
      : await rows(database, 'SELECT name, COUNT(*) uses, COUNT(DISTINCT device) people FROM events WHERE day >= ? GROUP BY name ORDER BY uses DESC', from);
    const cols = list.length ? Object.keys(list[0]) : [];
    return new Response('﻿' + [cols.join(','), ...list.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ox-crypto-${kind}.csv"`, 'Cache-Control': 'no-store' } });
  }

  // Bitget UID review: pending / approved / rejected, each decision kept in bitget_audit.
  if (path === 'bitget' && request.method === 'GET') {
    const status = BITGET_STATUS.includes(q.get('status')) ? q.get('status') : null;
    const list = await rows(database, `SELECT b.member, b.uid, b.status, b.note, b.submitted_at, b.reviewed_at, b.reviewed_by, b.check_result, b.checked_at, m.name, m.email,
      (SELECT COUNT(*) FROM bitget_uids o WHERE o.uid = b.uid AND o.member <> b.member) shared
      FROM bitget_uids b LEFT JOIN members m ON m.id = b.member ${status ? 'WHERE b.status = ?' : ''} ORDER BY b.submitted_at DESC LIMIT 300`, ...(status ? [status] : []));
    const counts = Object.fromEntries((await rows(database, 'SELECT status, COUNT(*) n FROM bitget_uids GROUP BY status')).map(r => [r.status, r.n]));
    // A join instead of a long IN list: D1 allows at most 100 bound values per query.
    const audit = list.length ? await rows(database, `SELECT a.member, a.ts, a.uid, a.action, a.actor, a.status, a.note FROM bitget_audit a JOIN bitget_uids b ON b.member = a.member ${status ? 'WHERE b.status = ?' : ''} ORDER BY a.ts DESC, a.id DESC LIMIT 2000`, ...(status ? [status] : [])) : [];
    return json({ ok: true, data: { checkConfigured: bitgetConfigured(env), counts, list: list.map(r => ({ ...r, check_result: parse(r.check_result), history: audit.filter(a => a.member === r.member).slice(0, 20) })) } });
  }
  if (path === 'bitget' && post) {
    const member = clip(body.member, 80), uid = clip(body.uid, 20), note = clip(body.note, 200) || null;
    const status = { approve: 'approved', reject: 'rejected', reopen: 'pending' }[body.action];
    if (!member || !status) return bad('INVALID_INPUT');
    // The decision is for the UID the admin was looking at; a newer submission needs a new look.
    const current = await database.prepare('SELECT uid FROM bitget_uids WHERE member = ?').bind(member).first();
    if (!current) return bad('NOT_FOUND', 404);
    if (uid && current.uid !== uid) return bad('UID_CHANGED', 409);
    await database.batch([
      database.prepare('UPDATE bitget_uids SET status = ?, note = ?, reviewed_at = ?, reviewed_by = ? WHERE member = ?').bind(status, note, now, email, member),
      database.prepare('INSERT INTO bitget_audit (ts, member, uid, action, actor, status, note) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(now, member, current.uid, body.action, email, status, note)
    ]);
    return json({ ok: true });
  }
  if (path === 'bitget-check' && post) {
    if (!bitgetConfigured(env)) return json({ ok: true, data: { configured: false } });
    const member = clip(body.member, 80);
    const current = member && await database.prepare('SELECT uid FROM bitget_uids WHERE member = ?').bind(member).first();
    if (!current) return bad('NOT_FOUND', 404);
    if (!allow('bitget-check', 30)) return bad('RATE_LIMITED', 429);
    let result;
    try { result = await createBitgetChecker({ env, ...(fetcher ? { fetcher } : {}) }).check(current.uid); }
    catch (error) {
      const known = error instanceof BitgetCheckError;
      return json({ ok: false, error: { code: known ? error.code : 'BITGET_CHECK_FAILED', message: known ? error.message : '暫時無法完成查詢', upstreamCode: known ? error.upstreamCode : null } }, 502);
    }
    const summary = result.referral === 'matched' ? `推薦關係：是；KYC：${result.kyc}` : '推薦關係：查不到';
    await database.batch([
      database.prepare('UPDATE bitget_uids SET check_result = ?, checked_at = ? WHERE member = ? AND uid = ?').bind(JSON.stringify(result), now, member, current.uid),
      database.prepare("INSERT INTO bitget_audit (ts, member, uid, action, actor, status, note) VALUES (?, ?, ?, 'check', ?, NULL, ?)").bind(now, member, current.uid, email, summary)
    ]);
    return json({ ok: true, data: { configured: true, result } });
  }
  return bad('NOT_FOUND', 404);
}
const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

// D1 tables for usage records, members, announcements, feature switches, feedback
// and Bitget UID review. Created on first use (IF NOT EXISTS), once per Worker isolate.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, device TEXT NOT NULL, member TEXT, kind TEXT NOT NULL, name TEXT NOT NULL, detail TEXT)`,
  `CREATE INDEX IF NOT EXISTS events_day ON events(day)`,
  `CREATE INDEX IF NOT EXISTS events_name ON events(name, day)`,
  `CREATE INDEX IF NOT EXISTS events_ts ON events(ts)`,
  `CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, email TEXT, name TEXT, picture TEXT, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, visits INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active', note TEXT)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, member TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_member ON sessions(member)`,
  `CREATE TABLE IF NOT EXISTS member_data (member TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (member, key))`,
  `CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, return_to TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, link TEXT, starts_at INTEGER NOT NULL, ends_at INTEGER, created_at INTEGER NOT NULL, created_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, message TEXT, updated_at INTEGER NOT NULL, updated_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, device TEXT, member TEXT, page TEXT, topic TEXT, contact TEXT, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', handled_at INTEGER, handled_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS feedback_ts ON feedback(ts)`,
  // One Bitget UID per member. Approval only shows a badge; it never unlocks or locks a tool.
  `CREATE TABLE IF NOT EXISTS bitget_uids (member TEXT PRIMARY KEY, uid TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', note TEXT, submitted_at INTEGER NOT NULL, reviewed_at INTEGER, reviewed_by TEXT, check_result TEXT, checked_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS bitget_uids_status ON bitget_uids(status, submitted_at)`,
  `CREATE INDEX IF NOT EXISTS bitget_uids_uid ON bitget_uids(uid)`,
  `CREATE TABLE IF NOT EXISTS bitget_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, member TEXT NOT NULL, uid TEXT, action TEXT NOT NULL, actor TEXT NOT NULL, status TEXT, note TEXT)`,
  `CREATE INDEX IF NOT EXISTS bitget_audit_member ON bitget_audit(member, ts)`
];
const ready = new WeakMap();
export async function db(env) {
  const database = env?.DB;
  if (!database) return null;
  if (!ready.has(database)) ready.set(database, (async () => {
    // One round trip when the binding supports batches (D1 does).
    if (typeof database.batch === 'function') await database.batch(SCHEMA.map(sql => database.prepare(sql)));
    else for (const sql of SCHEMA) await database.prepare(sql).run();
  })().catch(error => { ready.delete(database); throw error; }));
  await ready.get(database);
  return database;
}
export const taipeiDay = (ms = Date.now()) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
export const clip = (value, n) => typeof value === 'string' ? value.trim().slice(0, n) : '';
export const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
export const bad = (code, status = 400) => json({ ok: false, error: { code } }, status);
export async function readJSON(request, max = 16000) {
  const text = await request.text();
  if (text.length > max) throw Error('too large');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('not an object');
  return value;
}
// A small per-isolate limit: enough to stop one script flooding a table.
const recent = new Map();
export function allow(key, max, windowMs = 60000) {
  const now = Date.now(), hits = (recent.get(key) || []).filter(t => now - t < windowMs);
  if (hits.length >= max) { recent.set(key, hits); return false; }
  hits.push(now); recent.delete(key); recent.set(key, hits);
  if (recent.size > 5000) recent.delete(recent.keys().next().value);
  return true;
}
export const clientIP = request => request.headers.get('cf-connecting-ip') || 'local';

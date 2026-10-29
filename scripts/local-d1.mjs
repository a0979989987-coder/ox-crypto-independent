// Local stand-in for a Sites D1 binding, on Node's built-in SQLite. Only the calls
// the Worker uses: prepare().bind().run()/all()/first(), and batch(). The file opens
// on first use, so static-only runs never create it.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function localD1(file) {
  let db = null;
  const open = () => {
    if (!db) { if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true }); db = new DatabaseSync(file); }
    return db;
  };
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async run() { const r = open().prepare(sql).run(...args); return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
    async all() { return { success: true, results: open().prepare(sql).all(...args) }; },
    async first(column) { const row = open().prepare(sql).get(...args) ?? null; return column && row ? row[column] : row; },
    runSync() { return open().prepare(sql).run(...args); }
  });
  return {
    prepare: sql => statement(sql),
    // D1 runs a batch as one transaction: all statements or none.
    async batch(list) {
      const database = open(); database.exec('BEGIN');
      try { const out = list.map(s => { const r = s.runSync(); return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; }); database.exec('COMMIT'); return out; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    close() { db?.close(); db = null; }
  };
}

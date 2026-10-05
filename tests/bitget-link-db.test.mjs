import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Real local PostgreSQL/WASM, synthetic auth identities; never production SQL.
test('pending UID migration enforces RLS, no ownership escalation, and revision-safe rebinding', async t => {
  const db = new PGlite();
  const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`create role authenticated; create role anon; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      grant usage on schema auth, public to authenticated, anon;
      create table public.ox_accounts(id uuid primary key, created_at timestamptz default now());
      insert into public.ox_accounts(id) values ('${a}'), ('${b}');`);
    await db.exec(readFileSync(new URL('../server/account/migrations/001_pending_bitget_links.sql', import.meta.url), 'utf8'));
    async function as(member, role = 'authenticated') {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [member || '']);
      await db.exec('set role ' + role);
    }
    const mutate = async (action, uid, revision) => (await db.query('select public.ox_set_pending_bitget_link($1,$2,$3) as result', [action, uid, revision])).rows[0].result;
    let first, second;
    await t.test('one pending UID per member; repeat save is idempotent', async () => {
      await as(a); first = await mutate('save', '12345678901234567890', null);
      assert.equal(first.code, 'OK'); assert.equal(first.link.ownership_status, 'pending');
      assert.deepEqual(await mutate('save', first.link.uid, first.link.revision), first);
      assert.equal((await mutate('save', '777', null)).code, 'REVISION_CONFLICT');
      assert.equal((await db.query('select count(*)::int as n from public.ox_bitget_links')).rows[0].n, 1);
    });
    await t.test('unverified claims do not reserve a UID globally or disclose other claimants', async () => {
      await as(b); second = await mutate('save', first.link.uid, null); assert.equal(second.code, 'OK');
      const rows = (await db.query('select account_id,uid from public.ox_bitget_links')).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].account_id, b);
      await assert.rejects(db.query('delete from public.ox_bitget_links where account_id = $1', [a]), error => error.code === '42501');
    });
    await t.test('cannot set account ID or verified ownership through direct database writes', async () => {
      await as(b);
      await assert.rejects(db.query('update public.ox_bitget_links set ownership_status = $1', ['verified']), error => error.code === '42501');
      await assert.rejects(db.query('update public.ox_bitget_links set account_id = $1', [a]), error => error.code === '42501');
      await assert.rejects(db.query('insert into public.ox_bitget_links(account_id,uid) values ($1,$2)', [a, '999']), error => error.code === '42501');
      await assert.rejects(db.query('update public.ox_bitget_links set uid = $1', ['999']), error => error.code === '42501');
      await assert.rejects(db.query('insert into public.ox_bitget_links(uid) values ($1)', ['999']), error => error.code === '42501');
    });
    await t.test('rebinding rotates revision; stale tabs cannot overwrite or remove it', async () => {
      await as(a); const updated = await mutate('save', '888', first.link.revision);
      assert.equal(updated.code, 'OK'); assert.notEqual(updated.link.revision, first.link.revision);
      assert.equal((await mutate('save', '999', first.link.revision)).code, 'REVISION_CONFLICT');
      assert.equal((await mutate('remove', null, first.link.revision)).code, 'REVISION_CONFLICT');
      const removed = await mutate('remove', null, updated.link.revision); assert.equal(removed.code, 'OK'); assert.equal(removed.link.uid, null);
      assert.notEqual(removed.link.revision, updated.link.revision);
      assert.equal((await mutate('save', '999', null)).code, 'REVISION_CONFLICT');
      const restored = await mutate('save', '888', removed.link.revision); assert.equal(restored.code, 'OK'); assert.equal(restored.link.uid, '888');
      await as(b); assert.equal((await db.query('select uid from public.ox_bitget_links')).rows[0].uid, second.link.uid);
    });
    await t.test('anonymous role cannot read or call the mutation; missing authenticated identity is rejected', async () => {
      await as(null, 'anon');
      await assert.rejects(db.query('select * from public.ox_bitget_links'), error => error.code === '42501');
      await assert.rejects(mutate('save', '111', null), error => error.code === '42501');
      await as(null); await assert.rejects(mutate('save', '111', null), error => error.code === '42501');
    });
    await t.test('database rejects malformed UID and operation independently of the HTTP layer', async () => {
      await as(a);
      for (const uid of ['0', '001', '1e9', '123456789012345678901', '', null]) await assert.rejects(mutate('save', uid, null), error => error.code === '22023');
      await assert.rejects(mutate('verify', '123', null), error => error.code === '22023');
    });
    await t.test('read-only deployment verification SQL confirms effective privileges and fixed definer scope', async () => {
      const results = await db.exec(readFileSync(new URL('../server/account/migrations/001_pending_bitget_links.verify.sql', import.meta.url), 'utf8'));
      const meta = results[1].rows[0], permissions = results[2].rows[0];
      assert.equal(meta.rls_enabled, true); assert.equal(meta.security_definer, true); assert.equal(meta.trusted_table_owner, meta.trusted_function_owner);
      assert.ok(meta.fixed_search_path.includes('search_path=""'));
      for (const [key, value] of Object.entries(permissions)) assert.equal(value, key.endsWith('_must_be_true'));
      assert.equal(results[3].rows.length, 1); assert.equal(results[3].rows[0].cmd, 'SELECT');
    });
    await t.test('non-destructive rollback disables reads/mutations and preserves records for recovery', async () => {
      await db.exec('reset role');
      const before = (await db.query('select count(*)::int as n from public.ox_bitget_links')).rows[0].n;
      await db.exec(readFileSync(new URL('../server/account/migrations/001_pending_bitget_links.disable.sql', import.meta.url), 'utf8'));
      await as(b);
      await assert.rejects(db.query('select * from public.ox_bitget_links'), error => error.code === '42501');
      await assert.rejects(mutate('save', '111', null), error => error.code === '42501');
      await db.exec('reset role');
      assert.equal((await db.query('select count(*)::int as n from public.ox_bitget_links')).rows[0].n, before);
      await db.exec('grant select on public.ox_bitget_links to authenticated; grant execute on function public.ox_set_pending_bitget_link(text,text,uuid) to authenticated');
      await as(b); assert.equal((await db.query('select uid from public.ox_bitget_links')).rows[0].uid, second.link.uid);
    });
  } finally { await db.close(); }
});

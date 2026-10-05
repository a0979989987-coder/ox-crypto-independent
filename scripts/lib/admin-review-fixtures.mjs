import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
export const fixtureIDs={admin:'00000000-0000-4000-8000-000000000001',a:'00000000-0000-4000-8000-000000000101',b:'00000000-0000-4000-8000-000000000102',c:'00000000-0000-4000-8000-000000000103'};
export async function fixtureDatabase({defaultClientGrants=false}={}) {
  const db=new PGlite();
  await db.exec(`create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,public to authenticated,anon;
    create table public.ox_accounts(id uuid primary key);`);
  for(const id of Object.values(fixtureIDs)) await db.query('insert into public.ox_accounts values($1)',[id]);
  if(defaultClientGrants) await db.exec(`alter default privileges grant all on tables to anon,authenticated;
    alter default privileges grant all on sequences to anon,authenticated;
    alter default privileges grant usage on schemas to anon,authenticated;`);
  await db.exec(readFileSync(new URL('../../server/account/migrations/001_pending_bitget_links.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../../docs/account/admin-review-schema-draft.sql',import.meta.url),'utf8'));
  await db.query('insert into ox_review.administrators values($1,true)',[fixtureIDs.admin]);
  for(const [account,uid] of [['a','9000000001'],['b','9000000002'],['c','9000000002']]) await db.query('insert into public.ox_bitget_links(account_id,uid,revision) values($1,$2,$3)',[fixtureIDs[account],uid,randomUUID()]);
  return db;
}

import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fixtureIDs } from './admin-review-fixtures.mjs';
const migration=new URL('../../supabase/migrations/20261002033814_ox_admin_review_candidate.sql',import.meta.url);
export async function initializeCandidate(db,{ordinaryFixture=false,seedAdmin=false,candidateSQL}={}) {
  await db.exec(`do $$begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;end;$$;
    create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,public to authenticated,anon;create table auth.users(id uuid primary key);`);
  for(const id of Object.values(fixtureIDs)) await db.query('insert into auth.users(id) values($1)',[id]);
  await db.exec(readFileSync(new URL('../../server/account/schema.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../../server/account/migrations/001_pending_bitget_links.sql',import.meta.url),'utf8'));
  await db.exec(candidateSQL??readFileSync(migration,'utf8'));
  if(seedAdmin) await db.query('insert into ox_review_live.administrators(account_id,active) values($1,true)',[fixtureIDs.admin]);
  if(ordinaryFixture) await db.query("update ox_review_live.policy set ordinary_configured=true,capability_catalog='{all_member_features,fixture_partial_feature}',ordinary_capabilities='{fixture_partial_feature}'");
  for(const [account,uid] of [['a','9000000001'],['b','9000000002'],['c','9000000002']]) await db.query('insert into public.ox_bitget_links(account_id,uid) values($1,$2)',[fixtureIDs[account],uid]);
}
export async function candidateFixtureDatabase(options) {
  const db=new PGlite();await initializeCandidate(db,options);let tail=Promise.resolve();
  db.memberRPC=(id,action,payload)=>{const result=tail.then(()=>db.transaction(async tx=>{
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);await tx.exec('set local role authenticated');
    return (await tx.query('select public.ox_admin_review_rpc($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).rows[0].result;
  }));tail=result.catch(()=>{});return result;};
  return db;
}
export function candidateService(db,validateIdentity) {
  const run=async(req,action,payload={})=>{
    const identity=await validateIdentity(req);if(!identity?.id) throw Object.assign(Error('SIGN_IN_REQUIRED'),{code:'SIGN_IN_REQUIRED',status:401});
    let result;try{result=await db.memberRPC(identity.id,action,payload);}catch(error){throw Object.assign(Error(error.code==='42501'?'ADMIN_REQUIRED':'REVIEW_UNAVAILABLE'),{code:error.code==='42501'?'ADMIN_REQUIRED':'REVIEW_UNAVAILABLE',status:error.code==='42501'?403:503});}
    if(!result.ok) throw Object.assign(Error(result.code),{code:result.code,status:/CONFLICT|CHANGED/.test(result.code)?409:400});return result;
  };
  return {lookup:(req,uids)=>run(req,'lookup',{uids}),approve:(req,body)=>run(req,'approve',body),revoke:(req,body)=>run(req,'revoke',body),list:req=>run(req,'records'),effective:req=>run(req,'effective')};
}

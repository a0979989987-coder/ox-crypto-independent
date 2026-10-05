import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';import {Client} from 'pg';
import {initializeCandidate} from '../scripts/lib/admin-review-candidate-fixtures.mjs';
import {initializeFeatureFixture} from '../scripts/lib/feature-access-fixtures.mjs';import {fixtureIDs as ids} from '../scripts/lib/admin-review-fixtures.mjs';
const config={host:'127.0.0.1',port:Number(process.env.OX_NATIVE_PG_PORT||55439),user:'ox_fixture_owner',database:'postgres'};
test('native PostgreSQL product access migration and independent concurrent admin updates',async t=>{
 const root=new Client(config);await root.connect();const directory=(await root.query('show data_directory')).rows[0].data_directory.replaceAll('\\','/').toLowerCase();
 assert.ok(directory.endsWith('/task-2/imports/postgres-tools/candidate-data'),'Owned synthetic database only');
 const database='ox_features_'+randomUUID().replaceAll('-','');await root.query('create database '+database);
 const owner=new Client({...config,database}),a=new Client({...config,database}),b=new Client({...config,database});await Promise.all([owner.connect(),a.connect(),b.connect()]);
 const db={exec:s=>owner.query(s),query:(s,p)=>owner.query(s,p)};
 async function rpc(client,id,action,payload={}){await client.query('begin');try{await client.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);await client.query('set local role '+(id?'authenticated':'anon'));const r=(await client.query('select public.ox_feature_access_rpc($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).rows[0].result;await client.query('commit');return r;}catch(e){await client.query('rollback');throw e;}}
 try{
  await initializeCandidate(db,{seedAdmin:true});await initializeFeatureFixture(db);
  await t.test('no auth schema usage: private claims compatibility restores access without auth table rights',async()=>{
   await owner.query('revoke usage on schema auth from ox_review_executor');
   assert.equal((await rpc(a,null,'catalog')).features.length,18);
   await assert.rejects(rpc(a,null,'access',{feature:'tw.etf'}),e=>e.code==='42501'&&/schema auth/.test(e.message));
   await assert.rejects(rpc(a,ids.admin,'records'),e=>e.code==='42501'&&/schema auth/.test(e.message));
   const repair=readFileSync(new URL('../docs/account/review-claims-compatibility.sql',import.meta.url),'utf8');
   await owner.query('begin');
   await owner.query(repair.replace(/^begin;\r?\n/m,'').replace(/^commit;\r?$/m,''));
   await owner.query('rollback');
   await assert.rejects(rpc(a,null,'access',{feature:'tw.etf'}),e=>e.code==='42501');
   await owner.query(repair);
   await assert.rejects(rpc(a,null,'records'),e=>e.code==='42501'&&/SIGN_IN_REQUIRED/.test(e.message));
   await assert.rejects(rpc(a,ids.a,'records'),e=>e.code==='42501'&&/ADMIN_REQUIRED/.test(e.message));
   assert.equal((await rpc(a,null,'access',{feature:'tw.etf'})).allowed,true);
   assert.equal((await rpc(a,ids.admin,'records')).features.length,18);
   const acl=(await owner.query("select has_schema_privilege('ox_review_executor','auth','USAGE') usage,has_schema_privilege('ox_review_executor','auth','CREATE') create_schema,has_table_privilege('ox_review_executor','auth.users','SELECT') auth_users")).rows[0];
   assert.deepEqual(acl,{usage:false,create_schema:false,auth_users:false});
   const creates=(await owner.query("select has_schema_privilege('ox_review_executor','public','CREATE') public_create,has_schema_privilege('ox_review_executor','ox_review_live','CREATE') private_create,has_function_privilege('anon','ox_review_live.claim_uid()','EXECUTE') anon_helper,has_function_privilege('authenticated','ox_review_live.claim_jwt()','EXECUTE') member_helper")).rows[0];assert.ok(Object.values(creates).every(v=>v===false));
   const remaining=(await owner.query("select count(*)::int n from pg_proc where oid in ('ox_review_live.require_admin()'::regprocedure,'ox_review_live.claim_changed()'::regprocedure,'public.ox_admin_review_rpc(text,jsonb)'::regprocedure,'public.ox_feature_access_rpc(text,jsonb)'::regprocedure) and prosrc like '%auth.%'")).rows[0];assert.equal(remaining.n,0);
   const role=(await owner.query("select rolcanlogin,rolinherit,rolsuper,rolbypassrls from pg_roles where rolname='ox_review_executor'")).rows[0];assert.ok(Object.values(role).every(v=>v===false));
  });
  await t.test('private helpers preserve Supabase claims precedence and fail closed on malformed claims',async()=>{
   async function claims(sub='',claim='',claims='') {await owner.query('begin');try{for(const [k,v] of Object.entries({'request.jwt.claim.sub':sub,'request.jwt.claim':claim,'request.jwt.claims':claims}))await owner.query('select set_config($1,$2,true)',[k,v]);return (await owner.query('select ox_review_live.claim_uid() uid,ox_review_live.claim_jwt() jwt')).rows[0];}finally{await owner.query('rollback');}}
   assert.deepEqual(await claims(),{uid:null,jwt:null});
   assert.deepEqual(await claims('', '',JSON.stringify({sub:ids.a,is_anonymous:true})),{uid:ids.a,jwt:{sub:ids.a,is_anonymous:true}});
   assert.deepEqual(await claims(ids.admin,JSON.stringify({sub:ids.admin}),JSON.stringify({sub:ids.a})),{uid:ids.admin,jwt:{sub:ids.admin}});
   await assert.rejects(claims('invalid-uuid'),e=>e.code==='22P02');await assert.rejects(claims('','','invalid-json'),e=>e.code==='22P02');
   await a.query('begin');try{await a.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[ids.admin,JSON.stringify({sub:ids.admin,user_metadata:{administrator:true}})]);await a.query('set local role authenticated');assert.equal((await a.query("select public.ox_admin_review_rpc('status','{}') result")).rows[0].result.administrator,true);}finally{await a.query('rollback');}
   await a.query('begin');try{await a.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[ids.a,JSON.stringify({sub:ids.a,user_metadata:{administrator:true}})]);await a.query('set local role authenticated');await assert.rejects(a.query("select public.ox_admin_review_rpc('status','{}')"),e=>e.code==='42501');}finally{await a.query('rollback');}
  });
  const catalog=await rpc(a,null,'catalog'),row=catalog.features.find(f=>f.id==='tw.etf');
  await t.test('draft applies to native engine; catalog default public, audit private',async()=>{assert.equal(catalog.features.length,18);assert.ok(catalog.features.every(f=>f.mode==='public'));await assert.rejects(rpc(a,ids.a,'records'),e=>e.code==='42501');});
  await t.test('concurrent version checks allow one winner and one immutable audit only',async()=>{
   const body={feature:row.id,version:row.version,mode:'login',reason:'Native synthetic lock'};
   const results=await Promise.all([rpc(a,ids.admin,'update',{...body,idempotencyKey:randomUUID()}),rpc(b,ids.admin,'update',{...body,idempotencyKey:randomUUID()})]);
   assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).code,'VERSION_CONFLICT');assert.equal((await rpc(a,ids.admin,'records')).audit.length,1);
  });
  await t.test('guest denied, ordinary registered member allowed without Bitget/admin',async()=>{assert.equal((await rpc(a,null,'access',{feature:row.id})).allowed,false);assert.equal((await rpc(b,ids.a,'access',{feature:row.id})).allowed,true);});
  await t.test('protected identities cannot become product features and audit is append-only',async()=>{
   assert.equal((await rpc(a,null,'access',{feature:'admin-review'})).ok,false);
   await assert.rejects(owner.query("update ox_review_live.feature_audit set new_mode='public'"),/AUDIT_APPEND_ONLY/);
   const rights=(await owner.query("select has_table_privilege('authenticated','ox_review_live.feature_audit','SELECT') as member_audit,has_function_privilege('anon','public.ox_feature_access_rpc(text,jsonb)','EXECUTE') as catalog_rpc")).rows[0];assert.deepEqual(rights,{member_audit:false,catalog_rpc:true});
  });
 }finally{await Promise.all([owner.end(),a.end(),b.end()]);await root.query('drop database '+database);await root.end();}
});

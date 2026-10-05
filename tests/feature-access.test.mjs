import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {candidateFixtureDatabase} from '../scripts/lib/admin-review-candidate-fixtures.mjs';
import {initializeFeatureFixture} from '../scripts/lib/feature-access-fixtures.mjs';
import {fixtureIDs as ids} from '../scripts/lib/admin-review-fixtures.mjs';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
test('product access SQL persists independent public/login policy with admin-only immutable audit',async t=>{
 const db=await initializeFeatureFixture(await candidateFixtureDatabase({seedAdmin:true}));
 const rpc=(id,action,payload)=>db.featureRPC(id,action,payload);
 const catalog=await rpc(null,'catalog',{}),row=catalog.features.find(f=>f.id==='tw.radar');
 const payload={feature:row.id,version:row.version,mode:'login',reason:'Synthetic product release',idempotencyKey:randomUUID()};
 try{
  await t.test('every product starts public; identity/admin/UID controls cannot be added',async()=>{
   assert.deepEqual(catalog.features.map(f=>f.id).sort(),FEATURE_CATALOG.map(f=>f.id).sort());assert.ok(catalog.features.every(f=>f.mode==='public'));
   for(const feature of ['admin','account','bitget-link','member-records'])assert.equal((await rpc(ids.admin,'update',{...payload,feature})).code,'INVALID_FEATURE_REQUEST');
   assert.equal((await rpc(null,'access',{feature:'admin'})).ok,false);
   const rights=await db.query("select has_table_privilege('anon','ox_review_live.features','SELECT,UPDATE') as exposed,has_table_privilege('authenticated','ox_review_live.feature_audit','SELECT') as audit");assert.deepEqual(rights.rows[0],{exposed:false,audit:false});
  });
  await t.test('guest/member cannot read private audit or modify settings',async()=>{
   for(const id of [null,ids.a])for(const action of ['records','update'])await assert.rejects(rpc(id,action,action==='update'?payload:{}),e=>e.code==='42501');
   assert.equal((await rpc(null,'catalog',{})).audit,undefined);
  });
  await t.test('admin change requires valid reason/CAS and is idempotent with one audit',async()=>{
   for(const altered of [{...payload,reason:''},{...payload,mode:'admin'},{...payload,accountId:ids.a},{...payload,version:null}])assert.equal((await rpc(ids.admin,'update',altered)).ok,false);
   const changed=await rpc(ids.admin,'update',payload);assert.equal(changed.mode,'login');assert.notEqual(changed.version,row.version);
   assert.deepEqual(await rpc(ids.admin,'update',payload),changed);
   assert.equal((await rpc(ids.admin,'update',{...payload,mode:'public'})).code,'IDEMPOTENCY_CONFLICT');
   assert.equal((await rpc(ids.admin,'update',{...payload,idempotencyKey:randomUUID()})).code,'VERSION_CONFLICT');
   const records=await rpc(ids.admin,'records',{});assert.equal(records.audit.length,1);assert.equal(records.audit[0].old_mode,'public');
  });
  await t.test('login requires registered account only; ordinary/core/Bitget play no role',async()=>{
   assert.equal((await rpc(null,'access',{feature:'tw.radar'})).allowed,false);
   assert.equal((await rpc(ids.a,'access',{feature:'tw.radar'})).allowed,true);
   assert.equal((await db.featureRPC(ids.a,'access',{feature:'tw.radar'},true)).allowed,false);
   assert.equal((await rpc(null,'access',{feature:'tw.home'})).allowed,true);
   assert.equal((await rpc(null,'access',{feature:'crypto.radar'})).allowed,true);
  });
  await t.test('return to public is audited; disabled admin cannot retry; audit cannot mutate',async()=>{
   const records=await rpc(ids.admin,'records',{}),target=records.features.find(f=>f.id===row.id);
   await rpc(ids.admin,'update',{...payload,version:target.version,mode:'public',idempotencyKey:randomUUID()});
   assert.equal((await rpc(null,'access',{feature:row.id})).allowed,true);assert.equal((await rpc(ids.admin,'records',{})).audit.length,2);
   await assert.rejects(db.exec("update ox_review_live.feature_audit set reason='tamper'"),/AUDIT_APPEND_ONLY/);
   await db.query('update ox_review_live.administrators set active=false where account_id=$1',[ids.admin]);await assert.rejects(rpc(ids.admin,'update',payload),e=>e.code==='42501');
  });
 }finally{await db.close();}
});

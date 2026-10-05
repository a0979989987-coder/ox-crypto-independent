import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {initializeFeatureFixture} from '../scripts/lib/feature-access-fixtures.mjs';
import {initializeCandidate} from '../scripts/lib/admin-review-candidate-fixtures.mjs';
import {fixtureIDs as ids} from '../scripts/lib/admin-review-fixtures.mjs';
const config={host:'127.0.0.1',port:Number(process.env.OX_NATIVE_PG_PORT||55439),user:'ox_fixture_owner',database:'postgres'};
test('native PostgreSQL candidate RPC with independent connections and real database locks',async t=>{
  const root=new Client(config);await root.connect();
  const directory=(await root.query('show data_directory')).rows[0].data_directory.replaceAll('\\','/').toLowerCase();
  assert.ok(directory.endsWith('/task-2/imports/postgres-tools/candidate-data'),'Only the owned synthetic test cluster is allowed');
  const database='ox_review_test_'+randomUUID().replaceAll('-','');await root.query('create database '+database);
  const owner=new Client({...config,database}),a=new Client({...config,database}),b=new Client({...config,database});
  await Promise.all([owner.connect(),a.connect(),b.connect()]);
  const db={exec:sql=>owner.query(sql),query:(sql,params)=>owner.query(sql,params)};
  async function begin(client,id=ids.admin,role='authenticated') {await client.query('begin');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);await client.query('set local role '+role);}
  const call=(client,action,payload={})=>client.query('select public.ox_admin_review_rpc($1,$2::jsonb) as result',[action,JSON.stringify(payload)]).then(r=>r.rows[0].result);
  async function rpc(client,action,payload={},id=ids.admin) {await begin(client,id);try{const r=await call(client,action,payload);await client.query('commit');return r;}catch(e){await client.query('rollback');throw e;}}
  const batch=(entry,version,key=randomUUID())=>({idempotencyKey:key,policyVersion:version,reason:'Native synthetic review',entries:[{uid:entry.uid,accountId:entry.accountId,revision:entry.revision,level:'core'}]});
  async function waiting(client) {
    const pid=(await client.query('select pg_backend_pid() as pid')).rows[0].pid;return pid;
  }
  async function lockWait(pid) {
    const deadline=Date.now()+5000;while(Date.now()<deadline){const rows=(await owner.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows;if(rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,15));}throw Error('Expected a real DB lock wait');
  }
  try {
    await initializeCandidate(db);await initializeFeatureFixture(db);await owner.query('revoke usage on schema auth from ox_review_executor');await owner.query(readFileSync(new URL('../docs/account/review-claims-compatibility.sql',import.meta.url),'utf8'));
    await t.test('unsafe existing executor attributes and transitive membership fail closed',async()=>{
      const guard=readFileSync(new URL('../supabase/migrations/20261002033814_ox_admin_review_candidate.sql',import.meta.url),'utf8').match(/do \$\$begin[\s\S]*?end;\$\$;/)[0];
      for(const attribute of ['SUPERUSER','LOGIN','INHERIT','CREATEROLE','CREATEDB','REPLICATION','BYPASSRLS']) {
        await owner.query('begin');try {await owner.query('alter role ox_review_executor '+attribute);await assert.rejects(owner.query(guard),/UNSAFE_EXISTING_REVIEW_EXECUTOR/);}finally{await owner.query('rollback');}
      }
      await owner.query('begin');try {await owner.query('create role ox_fixture_review_chain nologin');await owner.query('grant ox_review_executor to ox_fixture_review_chain');await owner.query('grant ox_fixture_review_chain to authenticated');await assert.rejects(owner.query(guard),/UNSAFE_EXISTING_REVIEW_EXECUTOR_MEMBERSHIP/);}finally{await owner.query('rollback');}
    });
    await t.test('empty admin list and default ordinary policy fail closed',async()=>{
      await assert.rejects(rpc(a,'status'),e=>e.code==='42501');
      await owner.query('insert into ox_review_live.administrators(account_id,active) values($1,true)',[ids.admin]);
      const lookup=await rpc(a,'lookup',{uids:['9000000001']});assert.deepEqual(lookup.ordinaryCapabilities,[]);
      const payload=batch(lookup.claims[0],lookup.policyVersion);payload.entries[0].level='ordinary';
      assert.equal((await rpc(a,'approve',payload)).results[0].code,'ORDINARY_POLICY_UNCONFIGURED');
      assert.equal((await owner.query('select count(*)::int n from ox_review_live.approvals')).rows[0].n,0);
    });
    await t.test('nonadmin/anon isolation and non-owner audit privileges are effective',async()=>{
      await assert.rejects(rpc(a,'records',{},ids.a),e=>e.code==='42501');
      await begin(a,null,'anon');await assert.rejects(call(a,'status'),e=>e.code==='42501');await a.query('rollback');
      for(const table of ['administrators','policy','approvals','audit','batches']) {
        const p=(await owner.query("select has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE') as allowed",['ox_review_live.'+table])).rows[0];assert.equal(p.allowed,false);
      }
      const privilege=(await owner.query("select has_table_privilege('ox_review_executor','ox_review_live.audit','UPDATE,DELETE,TRUNCATE') as mutable,pg_get_userbyid(relowner) as owner from pg_class where oid='ox_review_live.audit'::regclass")).rows[0];
      assert.equal(privilege.mutable,false);assert.notEqual(privilege.owner,'ox_review_executor');
    });
    await t.test('popular UID fails explicitly without truncating candidates',async()=>{
      await owner.query('begin');try {
        await owner.query("insert into auth.users(id) select md5('popular-fixture-'||g)::uuid from generate_series(1,1001) g");
        await owner.query("insert into public.ox_bitget_links(account_id,uid) select md5('popular-fixture-'||g)::uuid,'9999999999' from generate_series(1,1001) g");
        await owner.query("select set_config('request.jwt.claim.sub',$1,true)",[ids.admin]);await owner.query('set local role authenticated');
        assert.deepEqual(await call(owner,'lookup',{uids:['9999999999']}),{ok:false,code:'TOO_MANY_MATCHES'});
      }finally{await owner.query('rollback');}
    });
    await t.test('explicitly configured ordinary approval records zero extra rights',async()=>{
      await owner.query('begin');try {await owner.query('update ox_review_live.policy set ordinary_configured=true');
        await owner.query("select set_config('request.jwt.claim.sub',$1,true)",[ids.admin]);await owner.query('set local role authenticated');
        const l=await call(owner,'lookup',{uids:['9000000001']}),payload=batch(l.claims[0],l.policyVersion);payload.entries[0].level='ordinary';
        const r=await call(owner,'approve',payload);assert.equal(r.results[0].code,'APPROVED');assert.deepEqual(r.results[0].approval.capabilities,[]);assert.equal(r.adminRightsIncluded,false);
      }finally{await owner.query('rollback');}
    });
    let first,lookup;
    await t.test('two independent connections racing the same UID select exactly one claimant',async()=>{
      lookup=await rpc(a,'lookup',{uids:['9000000002']});assert.equal(lookup.claims.length,2);
      const pa=batch(lookup.claims[0],lookup.policyVersion),pb=batch(lookup.claims[1],lookup.policyVersion);
      await begin(a);first=await call(a,'approve',pa);assert.equal(first.results[0].code,'APPROVED');
      const pid=await waiting(b);let settled=false;const competing=rpc(b,'approve',pb).then(r=>{settled=true;return r;});
      await lockWait(pid);assert.equal(settled,false);await a.query('commit');const loser=await competing;
      assert.equal(loser.results[0].code,'ACTIVE_APPROVAL_EXISTS');assert.equal((await owner.query("select count(*)::int n from ox_review_live.approvals where uid='9000000002' and status='active'")).rows[0].n,1);
      await assert.rejects(owner.query('update ox_review_live.audit set reason=reason'),e=>e.code==='42501');
      await assert.rejects(owner.query('delete from ox_review_live.audit'),e=>e.code==='42501');
    });
    await t.test('same-key concurrent replay creates exactly one grant and audit record',async()=>{
      const l=await rpc(a,'lookup',{uids:['9000000001']}),payload=batch(l.claims[0],l.policyVersion);
      await begin(a);const original=await call(a,'approve',payload),pid=await waiting(b),pending=rpc(b,'approve',payload);await lockWait(pid);await a.query('commit');
      const replay=await pending;assert.equal(replay.results[0].approval.id,original.results[0].approval.id);
      assert.equal((await owner.query("select count(*)::int n from ox_review_live.audit where approval_id=$1 and action='approve'",[original.results[0].approval.id])).rows[0].n,1);
      assert.equal((await rpc(a,'approve',{...payload,reason:'different'})).code,'IDEMPOTENCY_CONFLICT');
    });
    await t.test('approval and pending UID rebinding serialize; trigger invalidation is atomic',async()=>{
      const l=await rpc(a,'lookup',{uids:['9000000001']}),claim=l.claims[0];
      await begin(a,claim.accountId);const changed=await a.query('select public.ox_set_pending_bitget_link($1,$2,$3) as result',['save','9000000004',claim.revision]);assert.equal(changed.rows[0].result.code,'OK');
      const pid=await waiting(b),stale=rpc(b,'approve',batch(claim,l.policyVersion));await lockWait(pid);await a.query('commit');assert.equal((await stale).results[0].code,'CLAIM_CHANGED');
      assert.equal((await rpc(a,'effective',{},claim.accountId)).approval,null);
      assert.equal((await owner.query("select count(*)::int n from ox_review_live.audit where action='invalidate'")).rows[0].n,1);
    });
    await t.test('stale revoke cannot revoke a reissued approval; ordinary and core do not grant admin',async()=>{
      const approval=first.results[0].approval;
      const result=await rpc(a,'revoke',{idempotencyKey:randomUUID(),approvalId:approval.id,version:randomUUID(),reason:'stale'});assert.equal(result.code,'APPROVAL_CHANGED');
      const revoked=await rpc(a,'revoke',{idempotencyKey:randomUUID(),approvalId:approval.id,version:approval.version,reason:'Native revoke'});assert.equal(revoked.code,'REVOKED');
      await assert.rejects(rpc(a,'status',{},approval.account_id),e=>e.code==='42501');
    });
    await t.test('removing admin waits for in-flight mutation; subsequent replay is rejected',async()=>{
      const l=await rpc(a,'lookup',{uids:['9000000004']}),payload=batch(l.claims[0],l.policyVersion);
      await begin(a);const r=await call(a,'approve',payload);assert.equal(r.results[0].code,'APPROVED');
      const pid=await waiting(b);const removed=b.query('update ox_review_live.administrators set active=false where account_id=$1',[ids.admin]);await lockWait(pid);await a.query('commit');await removed;
      await assert.rejects(rpc(a,'approve',payload),e=>e.code==='42501');await owner.query('update ox_review_live.administrators set active=true where account_id=$1',[ids.admin]);
    });
    await t.test('audit insertion failure rolls back both grant and receipt',async()=>{
      const l=await rpc(a,'lookup',{uids:['9000000002']}),payload=batch(l.claims[0],l.policyVersion);
      await owner.query(`create function ox_review_live.audit_fail() returns trigger language plpgsql as $$begin raise exception 'Synthetic audit failure';end;$$;
        create trigger synthetic_fail before insert on ox_review_live.audit for each row execute function ox_review_live.audit_fail();`);
      await assert.rejects(rpc(a,'approve',payload));
      assert.equal((await owner.query('select count(*)::int n from ox_review_live.batches where idempotency_key=$1',[payload.idempotencyKey])).rows[0].n,0);
      assert.equal((await owner.query("select count(*)::int n from ox_review_live.approvals where uid='9000000002' and status='active'")).rows[0].n,0);
      await owner.query('drop trigger synthetic_fail on ox_review_live.audit');
    });
    await t.test('policy update immediately invalidates effective reads and stale review payloads',async()=>{
      const old=await rpc(a,'lookup',{uids:['9000000004']});
      await owner.query("update ox_review_live.policy set ordinary_capabilities='{}'");
      assert.equal((await rpc(a,'effective',{},ids.a)).approval,null);
      assert.equal((await rpc(a,'approve',batch(old.claims[0],old.policyVersion))).code,'POLICY_CHANGED');
      const records=await rpc(a,'records');assert.equal(records.approvals.find(r=>r.account_id===ids.a&&r.status==='active').effective,false);
    });
    await t.test('malformed/null actions and attempted ownership/scopes/actor injection are rejected in DB',async()=>{
      assert.equal((await rpc(a,null,{})).code,'INVALID_ACTION');
      const l=await rpc(a,'lookup',{uids:['9000000004']}),payload=batch(l.claims[0],l.policyVersion);
      for(const entries of [[null],[[]],[{...payload.entries[0],ownershipVerified:true}],[{...payload.entries[0],accountId:[ids.a]}]]) assert.equal((await rpc(a,'approve',{...payload,idempotencyKey:randomUUID(),entries})).code,'INVALID_ENTRY');
      assert.equal((await rpc(a,'approve',{...payload,actorId:ids.admin})).code,'INVALID_BATCH');
    });
    await t.test('approval-first ordering blocks concurrent member rebind and invalidates in that same commit',async()=>{
      const l=await rpc(a,'lookup',{uids:['9000000002']}),claim=l.claims.find(c=>c.accountId===ids.b);
      await begin(a);const granted=await call(a,'approve',batch(claim,l.policyVersion));assert.equal(granted.results[0].code,'APPROVED');
      const pid=await waiting(b);const mutation=(async()=>{await begin(b,ids.b);const r=await b.query("select public.ox_set_pending_bitget_link('save',$1,$2) as result",['9000000005',claim.revision]);await b.query('commit');return r.rows[0].result;})();
      await lockWait(pid);await a.query('commit');assert.equal((await mutation).code,'OK');
      assert.equal((await rpc(a,'effective',{},ids.b)).approval,null);
      assert.equal((await owner.query('select status from ox_review_live.approvals where id=$1',[granted.results[0].approval.id])).rows[0].status,'invalidated');
    });
    await t.test('native partial success preserves per-row failures and does not grant unselected matches',async()=>{
      const l=await rpc(a,'lookup',{uids:['9000000002','9000000005']}),selected=l.claims.find(c=>c.accountId===ids.c),stale=l.claims.find(c=>c.accountId===ids.b);
      const payload=batch(selected,l.policyVersion);payload.entries.push({uid:stale.uid,accountId:stale.accountId,revision:randomUUID(),level:'core'});
      const result=await rpc(a,'approve',payload);assert.deepEqual(result.results.map(r=>r.code),['APPROVED','CLAIM_CHANGED']);
      assert.equal((await rpc(a,'effective',{},ids.b)).approval,null);assert.equal((await rpc(a,'effective',{},ids.c)).approval.level,'core');
    });
  }finally{
    await Promise.all([a.query('rollback').catch(()=>{}),b.query('rollback').catch(()=>{})]);await Promise.all([a.end(),b.end(),owner.end()]);
    await root.query('drop database '+database);await root.end();
  }
});

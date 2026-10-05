import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseUIDs,matchClaims,confirmation } from '../previews/account-admin/model.js';
import { fixtureDatabase,fixtureIDs as ids } from '../scripts/lib/admin-review-fixtures.mjs';
import { createReviewService } from '../server/account/admin-review-preview.js';

test('batch parser preserves UID precision, order and separator handling',()=>{
  assert.deepEqual(parseUIDs('9000000001,9000000002\n9000000001，12345678901234567890\t9000000002'),{uids:['9000000001','9000000002','12345678901234567890'],invalid:[],duplicates:2});
});
test('parser rejects malformed, numeric, oversized and excessive input',()=>{
  assert.deepEqual(parseUIDs('0 01 -2 1.5 1e4 <script> １２３ 123456789012345678901').invalid,['0','01','-2','1.5','1e4','<script>','１２３','123456789012345678901']);
  assert.throws(()=>parseUIDs(123));assert.throws(()=>parseUIDs('1'.repeat(16001)));
  assert.throws(()=>parseUIDs(Array.from({length:101},(_,i)=>String(i+1)).join(' ')));
  assert.throws(()=>parseUIDs(Array(201).fill('1').join(' ')));
});
test('review requires explicit member, level and exclusion; no first-claim winner',()=>{
  const rows=matchClaims(['1','2','3'],[{uid:'1',accountId:'a',revision:'r'},{uid:'2',accountId:'b',revision:'s'},{uid:'2',accountId:'c',revision:'t'}]);
  assert.deepEqual(rows.map(r=>r.status),['matched','ambiguous','unmatched']);assert.throws(()=>confirmation(rows));
  Object.assign(rows[0],{accountId:'a',level:'ordinary'});Object.assign(rows[1],{accountId:'c',level:'core'});rows[2].excluded=true;
  const result=confirmation(rows);assert.equal(result.entries[1].accountId,'c');assert.equal(result.entries[0].ownershipVerified,false);assert.deepEqual(result.excluded,['3']);
  rows[1].accountId='foreign';assert.throws(()=>confirmation(rows));rows.forEach(r=>r.excluded=true);assert.throws(()=>confirmation(rows));
});

test('local PostgreSQL admin approval, audit, revocation and claim boundaries',async t=>{
  const db=await fixtureDatabase({defaultClientGrants:true});
  const actor={id:ids.admin},member={id:ids.a};
  const service=createReviewService({db,validateIdentity:async req=>req.identity||null,ordinaryCapabilities:['fixture_partial_feature']});
  const admin={identity:actor},user={identity:member};
  const lookup=()=>service.lookup(admin,['9000000001','9000000002','9000000003']);
  const body=entries=>({idempotencyKey:randomUUID(),policyVersion:'synthetic-policy-v1',reason:'Synthetic review only',entries});
  const entry=c=>({uid:c.uid,accountId:c.accountId,revision:c.revision,level:'ordinary'});
  try {
    await t.test('anonymous and nonadmin cannot search, approve, list or revoke',async()=>{
      for(const request of [{},user,{identity:{id:ids.a,user_metadata:{admin:true},app_metadata:{role:'admin'}}}]) {
        for(const invoke of [()=>service.lookup(request,['9000000001']),()=>service.approve(request,{}),()=>service.list(request),()=>service.revoke(request,{})])
          await assert.rejects(invoke(),e=>['SIGN_IN_REQUIRED','ADMIN_REQUIRED'].includes(e.code));
      }
    });
    await t.test('all claimants are shown, unknown UID has no member and grants nothing',async()=>{
      const result=await lookup();assert.equal(result.claims.filter(c=>c.uid==='9000000002').length,2);assert.equal(result.claims.some(c=>c.uid==='9000000003'),false);
      const invalid=entry({...result.claims[0],uid:'9000000003'});const response=await service.approve(admin,body([invalid]));assert.equal(response.results[0].code,'CLAIM_CHANGED');
      assert.equal((await service.list(admin)).audit.length,0);
    });
    await t.test('reject client scopes/admin elevation/duplicate targets and unconfirmed policy version',async()=>{
      const claims=(await lookup()).claims,first=entry(claims[0]);
      for(const payload of [body([{...first,capabilities:['admin']}]),body([first,first]),{...body([first]),actorId:ids.admin},{...body([first]),policyVersion:'old'}])
        await assert.rejects(service.approve(admin,payload));
    });
    let ordinary,core,original;
    await t.test('manual levels are explicit; chosen claimant alone gets synthetic rights',async()=>{
      const claims=(await lookup()).claims;const a=entry(claims.find(c=>c.accountId===ids.a)),c={...entry(claims.find(c=>c.accountId===ids.c)),level:'core'};
      original=body([a,c]);const response=await service.approve(admin,original);ordinary=response.results[0].approval;core=response.results[1].approval;
      assert.equal(ordinary.source,'manual_approval');assert.equal(ordinary.ownership_verified,false);assert.deepEqual(ordinary.capabilities,['fixture_partial_feature']);
      assert.deepEqual(core.capabilities,['all_member_features']);assert.equal((await service.effective({identity:{id:ids.b}})).approval,null);
      assert.equal((await service.effective({identity:{id:ids.c}})).adminRightsIncluded,false);
      await assert.rejects(service.list({identity:{id:ids.c}}),e=>e.code==='ADMIN_REQUIRED');
      const stored=(await db.query('select distinct ownership_status from public.ox_bitget_links')).rows;assert.deepEqual(stored,[{ownership_status:'pending'}]);
    });
    await t.test('repeat batch is idempotent; changed payload under same key conflicts',async()=>{
      assert.equal((await service.approve(admin,original)).results[0].approval.id,ordinary.id);assert.equal((await service.list(admin)).audit.length,2);
      await assert.rejects(service.approve(admin,{...original,reason:'changed'}),e=>e.code==='IDEMPOTENCY_CONFLICT');
    });
    await t.test('partial failure is explicit and cannot grant a second claimant of an approved UID',async()=>{
      const claims=(await lookup()).claims;const b=entry(claims.find(c=>c.accountId===ids.b));
      const response=await service.approve(admin,body([b,{...entry(claims.find(c=>c.accountId===ids.a)),revision:randomUUID()}]));
      assert.deepEqual(response.results.map(r=>r.code),['ACTIVE_APPROVAL_EXISTS','CLAIM_CHANGED']);assert.equal((await service.list(admin)).audit.length,2);
    });
    await t.test('revoke checks revision, logs exactly once, and removes only that manual approval',async()=>{
      const payload={idempotencyKey:randomUUID(),approvalId:ordinary.id,version:ordinary.version,reason:'Synthetic revoke'};
      await assert.rejects(service.revoke(admin,{...payload,version:randomUUID()}),e=>e.code==='APPROVAL_CHANGED');
      const result=await service.revoke(admin,payload);assert.equal(result.code,'REVOKED_PREVIEW');assert.equal((await service.revoke(admin,payload)).code,'REVOKED_PREVIEW');
      assert.equal((await service.effective(user)).approval,null);assert.equal((await service.effective({identity:{id:ids.c}})).approval.level,'core');assert.equal((await service.list(admin)).audit.length,3);
    });
    await t.test('rebinding/removal immediately invalidates effective rights; stale confirmation cannot approve',async()=>{
      const before=(await lookup()).claims.find(c=>c.accountId===ids.c);
      await db.query('update public.ox_bitget_links set uid=null,revision=$2 where account_id=$1',[ids.c,randomUUID()]);
      assert.equal((await service.effective({identity:{id:ids.c}})).approval,null);
      const response=await service.approve(admin,body([{...entry(before),level:'core'}]));assert.equal(response.results[0].code,'CLAIM_CHANGED');
      const records=await service.list(admin);assert.equal(records.approvals.find(a=>a.id===core.id).status,'invalidated');assert.equal(records.audit.filter(a=>a.action==='invalidate').length,1);
    });
    await t.test('concurrent local requests preserve one active approval and one replay result',async()=>{
      const c=(await lookup()).claims.find(c=>c.accountId===ids.a);const payload=body([entry(c)]);
      const results=await Promise.all([service.approve(admin,payload),service.approve(admin,payload),service.approve(admin,body([entry(c)]))]);
      assert.equal(results[0].results[0].approval.id,results[1].results[0].approval.id);assert.equal(results[2].results[0].code,'ACTIVE_APPROVAL_EXISTS');
    });
    await t.test('admin removal applies on next request, including replay',async()=>{
      await db.query('update ox_review.administrators set active=false where account_id=$1',[ids.admin]);
      await assert.rejects(service.approve(admin,original),e=>e.code==='ADMIN_REQUIRED');await db.query('update ox_review.administrators set active=true where account_id=$1',[ids.admin]);
    });
    await t.test('private tables cannot be read or changed by direct authenticated/anonymous access',async()=>{
      for(const role of ['authenticated','anon']) for(const table of ['administrators','approvals','audit','batches']) {
        const result=(await db.query('select has_schema_privilege($1,$2,\'USAGE\') as schema_access,has_table_privilege($1,$3,\'SELECT,INSERT,UPDATE,DELETE,TRUNCATE\') as table_access',[role,'ox_review','ox_review.'+table])).rows[0];
        assert.deepEqual(result,{schema_access:false,table_access:false});
      }
      for(const role of ['authenticated','anon']) {
        await db.exec('set role '+role);
        for(const sql of ['select * from ox_review.administrators','update ox_review.administrators set active=true','delete from ox_review.audit','select * from ox_review.approvals','select * from ox_review.batches']) await assert.rejects(db.query(sql),e=>e.code==='42501');
        await db.exec('reset role');
      }
    });
    await t.test('audit failure rolls back approval and idempotency receipt',async()=>{
      const c=(await lookup()).claims.find(c=>c.accountId===ids.b),payload=body([entry(c)]);
      await db.exec(`create function ox_review.reject_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure'; end;$$;
        create trigger fail_audit before insert on ox_review.audit for each row execute function ox_review.reject_audit();`);
      await assert.rejects(service.approve(admin,payload));
      assert.equal((await db.query("select count(*)::int as n from ox_review.approvals where account_id=$1 and status='active'",[ids.b])).rows[0].n,0);
      assert.equal((await db.query('select count(*)::int as n from ox_review.batches where idempotency_key=$1',[payload.idempotencyKey])).rows[0].n,0);
      await db.exec('drop trigger fail_audit on ox_review.audit');
    });
    await t.test('mixed batch reports success and stale failure separately without silently retrying failures',async()=>{
      const claims=(await lookup()).claims,b=entry(claims.find(c=>c.accountId===ids.b));
      const result=await service.approve(admin,body([b,{uid:'9000000003',accountId:ids.c,revision:randomUUID(),level:'core'}]));
      assert.deepEqual(result.results.map(r=>r.code),['APPROVED_PREVIEW','CLAIM_CHANGED']);
      assert.equal((await service.effective({identity:{id:ids.b}})).approval.level,'ordinary');
    });
    await t.test('ordinary rights remain unavailable when no server policy is configured',async()=>{
      await db.query('update public.ox_bitget_links set uid=$2,revision=$3 where account_id=$1',[ids.c,'9000000004',randomUUID()]);
      const emptyPolicy=createReviewService({db,validateIdentity:async req=>req.identity});
      const c=(await emptyPolicy.lookup(admin,['9000000004'])).claims[0];
      const result=await emptyPolicy.approve(admin,body([entry(c)]));assert.equal(result.results[0].code,'ORDINARY_POLICY_UNCONFIGURED');
      assert.equal((await emptyPolicy.effective({identity:{id:ids.c}})).approval,null);
    });
  }finally{await db.close();}
});

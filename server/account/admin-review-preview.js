// Local prototype only: not imported by the production Account dispatcher.
import { createHash, randomUUID } from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUUID=value=>typeof value==='string' && UUID.test(value);
const UID=/^[1-9][0-9]{0,19}$/;
export class ReviewError extends Error { constructor(code,status=400){super(code);this.code=code;this.status=status;} }
const fail=(code,status)=>{throw new ReviewError(code,status);};
const fields=(object,allowed)=>object && !Array.isArray(object) && typeof object==='object' && Object.keys(object).every(k=>allowed.includes(k));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createReviewService({db,validateIdentity,ordinaryCapabilities=[],policyVersion='synthetic-policy-v1'}) {
  if(!Array.isArray(ordinaryCapabilities)||ordinaryCapabilities.length>40||ordinaryCapabilities.some(v=>typeof v!=='string'||!/^fixture_(?!admin)[a-z0-9_]{1,80}$/.test(v))) throw Error('Only synthetic ordinary capabilities are accepted by this local prototype');
  ordinaryCapabilities=Object.freeze([...new Set(ordinaryCapabilities)]);
  // Serialize transactions on the local WASM connection. This is not a proof
  // of production multi-connection locking; production must use DB locks/RPCs.
  let tail=Promise.resolve();
  const serial=fn=>{const result=tail.then(fn);tail=result.catch(()=>{});return result;};
  const one=async(tx,sql,params=[])=>(await tx.query(sql,params)).rows[0];
  async function admin(tx,request) {
    const identity=await validateIdentity(request);
    if(!identity || !isUUID(identity.id)) fail('SIGN_IN_REQUIRED',401);
    const role=await one(tx,'select active from ox_review.administrators where account_id=$1',[identity.id]);
    if(!role?.active) fail('ADMIN_REQUIRED',403);
    return identity.id;
  }
  async function event(tx,actor,action,approval,reason) {
    await tx.query('insert into ox_review.audit(actor_id,action,approval_id,reason,detail) values($1,$2,$3,$4,$5)',[actor,action,approval.id,reason,JSON.stringify(approval)]);
  }
  async function invalidate(tx,actor) {
    const stale=(await tx.query(`select a.* from ox_review.approvals a left join public.ox_bitget_links l on l.account_id=a.account_id
      where a.status='active' and (l.uid is distinct from a.uid or l.revision is distinct from a.claim_revision) for update of a`)).rows;
    for(const row of stale) {
      const updated=await one(tx,"update ox_review.approvals set status='invalidated',version=$2,updated_at=now() where id=$1 returning *",[row.id,randomUUID()]);
      await event(tx,actor,'invalidate',updated,'UID claim changed; prior manual grant no longer effective');
    }
  }
  async function batch(tx,actor,key,payload,run) {
    if(!isUUID(key)) fail('IDEMPOTENCY_KEY_REQUIRED');
    const fingerprint=digest(payload);
    const previous=await one(tx,'select fingerprint,result from ox_review.batches where actor_id=$1 and idempotency_key=$2',[actor,key]);
    if(previous) {if(previous.fingerprint!==fingerprint) fail('IDEMPOTENCY_CONFLICT',409);return previous.result;}
    const result=await run();
    await tx.query('insert into ox_review.batches values($1,$2,$3,$4,now())',[actor,key,fingerprint,JSON.stringify(result)]);
    return result;
  }
  return Object.freeze({
    lookup:(request,uids)=>serial(()=>db.transaction(async tx=>{
      await admin(tx,request);
      if(!Array.isArray(uids)||!uids.length||uids.length>100||uids.some(uid=>typeof uid!=='string'||!UID.test(uid))) fail('INVALID_UIDS');
      const unique=[...new Set(uids)];
      const claims=(await tx.query('select account_id as "accountId", uid, revision from public.ox_bitget_links where uid=any($1::text[]) order by account_id',[unique])).rows;
      return {claims:claims.map(c=>({...c,name:'OX 會員'})),policyVersion,ordinaryCapabilities,coreCapabilities:['all_member_features'],adminRightsIncluded:false};
    })),
    approve:(request,body)=>serial(()=>db.transaction(async tx=>{
      const actor=await admin(tx,request);
      if(!fields(body,['idempotencyKey','policyVersion','reason','entries']) || !Array.isArray(body.entries) || !body.entries.length || body.entries.length>100 || typeof body.reason!=='string' || !body.reason.trim() || body.reason.length>500) fail('INVALID_BATCH');
      if(body.policyVersion!==policyVersion) fail('POLICY_CHANGED',409);
      const usedUID=new Set(),usedMember=new Set();
      for(const e of body.entries) {
        if(!fields(e,['uid','accountId','revision','level'])||!UID.test(e.uid||'')||typeof e.uid!=='string'||!isUUID(e.accountId)||!isUUID(e.revision)||!['ordinary','core'].includes(e.level)) fail('INVALID_ENTRY');
        if(usedUID.has(e.uid)||usedMember.has(e.accountId)) fail('DUPLICATE_TARGET'); usedUID.add(e.uid);usedMember.add(e.accountId);
      }
      return batch(tx,actor,body.idempotencyKey,{action:'approve',...body},async()=>{
        await invalidate(tx,actor); const results=[];
        for(const e of body.entries) {
          const claim=await one(tx,'select uid,revision from public.ox_bitget_links where account_id=$1 for update',[e.accountId]);
          if(!claim||claim.uid!==e.uid||claim.revision!==e.revision) {results.push({uid:e.uid,accountId:e.accountId,code:'CLAIM_CHANGED'});continue;}
          const occupied=await one(tx,"select * from ox_review.approvals where status='active' and (uid=$1 or account_id=$2) for update",[e.uid,e.accountId]);
          if(occupied) {results.push({uid:e.uid,accountId:e.accountId,code:'ACTIVE_APPROVAL_EXISTS'});continue;}
          const caps=e.level==='core'?['all_member_features']:ordinaryCapabilities;
          if(!caps.length) {results.push({uid:e.uid,accountId:e.accountId,code:'ORDINARY_POLICY_UNCONFIGURED'});continue;}
          const approval=await one(tx,`insert into ox_review.approvals(id,account_id,uid,claim_revision,version,level,capabilities,policy_version,status)
            values($1,$2,$3,$4,$5,$6,$7,$8,'active') returning *`,[randomUUID(),e.accountId,e.uid,e.revision,randomUUID(),e.level,JSON.stringify(caps),policyVersion]);
          await event(tx,actor,'approve',approval,body.reason.trim());
          results.push({uid:e.uid,accountId:e.accountId,code:'APPROVED_PREVIEW',approval});
        }
        return {results,approvalSource:'manual_approval',productionRightsChanged:false};
      });
    })),
    list:request=>serial(()=>db.transaction(async tx=>{
      const actor=await admin(tx,request);await invalidate(tx,actor);
      return {approvals:(await tx.query('select * from ox_review.approvals order by created_at,id')).rows,
        audit:(await tx.query('select * from ox_review.audit order by sequence')).rows};
    })),
    revoke:(request,body)=>serial(()=>db.transaction(async tx=>{
      const actor=await admin(tx,request);
      if(!fields(body,['idempotencyKey','approvalId','version','reason'])||!isUUID(body.approvalId)||!isUUID(body.version)||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>500) fail('INVALID_REVOKE');
      return batch(tx,actor,body.idempotencyKey,{action:'revoke',...body},async()=>{
        await invalidate(tx,actor);
        const row=await one(tx,'select * from ox_review.approvals where id=$1 for update',[body.approvalId]);
        if(!row) fail('APPROVAL_NOT_FOUND',404);
        if(row.version!==body.version) fail('APPROVAL_CHANGED',409);
        if(row.status!=='active') return {code:'ALREADY_INACTIVE',productionRightsChanged:false};
        const updated=await one(tx,"update ox_review.approvals set status='revoked',version=$2,updated_at=now() where id=$1 returning *",[row.id,randomUUID()]);
        await event(tx,actor,'revoke',updated,body.reason.trim());return {code:'REVOKED_PREVIEW',approval:updated,productionRightsChanged:false};
      });
    })),
    effective:request=>serial(()=>db.transaction(async tx=>{
      const identity=await validateIdentity(request); if(!identity||!isUUID(identity.id)) fail('SIGN_IN_REQUIRED',401);
      // Never trust approval status alone: compare the live claim on every read.
      const row=await one(tx,`select a.level,a.capabilities,a.source from ox_review.approvals a join public.ox_bitget_links l on l.account_id=a.account_id
        where a.account_id=$1 and a.status='active' and a.uid=l.uid and a.claim_revision=l.revision`,[identity.id]);
      return {approval:row||null,ownershipVerified:false,adminRightsIncluded:false,productionRightsChanged:false};
    }))
  });
}

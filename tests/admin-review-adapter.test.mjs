import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createAccountHandler} from '../server/account/handler.js';
import {seal,cookieName} from '../server/account/cookies.js';
import {candidateFixtureDatabase} from '../scripts/lib/admin-review-candidate-fixtures.mjs';
import {fixtureIDs as ids} from '../scripts/lib/admin-review-fixtures.mjs';
const env={OX_ACCOUNT_ORIGIN:'https://ox.example',OX_SUPABASE_URL:'https://fixture.supabase.co',OX_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable',OX_AUTH_SESSION_SECRET:'synthetic-opaque-cookie-key-32-characters'};
const response=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(v){this.body=v;},end(){}});
test('real Supabase SDK + provider-validated JWT + RLS RPC candidate adapter',async t=>{
 const db=await candidateFixtureDatabase({seedAdmin:true,ordinaryFixture:true}),signing=randomBytes(32);let rpcCalls=0,userCalls=0,refreshes=0,denyUser=false,failRPC=false,denyRPC=false;
 const jwt=id=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return `${h}.${p}.${createHmac('sha256',signing).update(h+'.'+p).digest('base64url')}`;};
 const adminToken=jwt(ids.admin),memberToken=jwt(ids.a);
 const identity=token=>{try{const[h,p,s]=token.split('.');if(createHmac('sha256',signing).update(h+'.'+p).digest('base64url')!==s)return null;return JSON.parse(Buffer.from(p,'base64url').toString()).sub;}catch{return null;}};
 const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 const fetcher=async(input,options={})=>{
   const url=new URL(typeof input==='string'?input:input.url),headers=new Headers(options.headers),token=(headers.get('authorization')||'').replace(/^Bearer /,'');
   if(url.pathname==='/auth/v1/user') {userCalls++;const id=identity(token);return id&&!denyUser?json({id,email:'fixture@example.com',created_at:'2026-10-01T00:00:00Z',user_metadata:{admin:true},app_metadata:{role:'admin'},identities:[]}):json({message:'invalid fixture JWT',code:'bad_jwt'},401);}
   if(url.pathname==='/auth/v1/token') {refreshes++;return json({access_token:adminToken,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user:{id:ids.admin}});}
   if(url.pathname==='/rest/v1/rpc/ox_admin_review_rpc') {
     rpcCalls++;const id=identity(token);assert.ok(id,'RPC bearer must be the provider-valid JWT, never a publishable/service-role key');
     if(failRPC)return json({code:'PGRST202',message:'raw synthetic SQL details must not leak'},404);
     if(denyRPC)return json({code:'42501',message:'raw forbidden SQL details must not leak'},403);
     const body=JSON.parse(options.body);assert.deepEqual(Object.keys(body).sort(),['p_action','p_payload']);
     try{return json(await db.memberRPC(id,body.p_action,body.p_payload));}catch(e){return json({code:e.code,message:'raw SQL detail'},403);}
   }
   throw Error('Unexpected fixture-only request: '+url.pathname);
 };
 const clientFactory=(url,key,options)=>createClient(url,key,{...options,global:{...options.global,fetch:fetcher}});
 const handler=createAccountHandler({env,clientFactory,limiter:()=>true});
 const cookie=token=>[`${cookieName('access')}=${seal(token,env.OX_AUTH_SESSION_SECRET,'access',600)}`,`${cookieName('refresh')}=${seal('fixture-refresh',env.OX_AUTH_SESSION_SECRET,'refresh',600)}`].join('; ');
 const request=(token,action,payload={})=>({method:action?'POST':'GET',query:{endpoint:'admin-review'},headers:{origin:env.OX_ACCOUNT_ORIGIN,'content-type':'application/json',...(token?{cookie:cookie(token)}:{})},body:action?{action,payload}:{}});
 const run=async req=>{const r=response();await handler(req,r);return r;};
 try {
   await t.test('no cookies, forged sealed cookies, invalid provider JWT and cross-origin fail before RPC',async()=>{
     assert.equal((await run(request(null))).statusCode,401);
     const forged=request(adminToken);forged.headers.cookie=`${cookieName('access')}=forged`;assert.equal((await run(forged)).statusCode,401);
     const cross=request(adminToken,'records');cross.headers.origin='https://evil.test';assert.equal((await run(cross)).statusCode,403);
     denyUser=true;assert.equal((await run(request(adminToken))).statusCode,401);denyUser=false;assert.equal(rpcCalls,0);
   });
   await t.test('user/app metadata cannot promote a nonadmin; private DB rechecks every call',async()=>{
     const r=await run(request(memberToken,'lookup',{uids:['9000000001']}));assert.equal(r.statusCode,403);assert.equal(r.body.code,'ADMIN_REQUIRED');
     await db.query('update ox_review_live.administrators set active=false where account_id=$1',[ids.admin]);
     assert.equal((await run(request(adminToken))).statusCode,403);await db.query('update ox_review_live.administrators set active=true where account_id=$1',[ids.admin]);
   });
   await t.test('expired access is refreshed then getUser-validated; exact fresh bearer reaches RPC',async()=>{
     const before=userCalls;const r=await run(request('invalid-fixture-token'));assert.equal(r.statusCode,200);assert.equal(r.body.administrator,true);assert.equal(userCalls-before,2);assert.ok(refreshes>0);assert.ok(r.headers['Set-Cookie']);
   });
   await t.test('lookup → approve → effective → records → revoke traverses candidate RPC with SDK',async()=>{
     const lookup=await run(request(adminToken,'lookup',{uids:['9000000001']})),claim=lookup.body.claims[0];
     const payload={idempotencyKey:randomUUID(),policyVersion:lookup.body.policyVersion,reason:'SDK fixture approval',entries:[{uid:claim.uid,accountId:claim.accountId,revision:claim.revision,level:'core'}]};
     const approved=await run(request(adminToken,'approve',payload));assert.equal(approved.body.results[0].code,'APPROVED');assert.equal(approved.body.ownershipVerified,false);
     const effective=await run(request(memberToken,'effective'));assert.equal(effective.body.approval.level,'core');assert.equal(effective.body.adminRightsIncluded,false);
     const records=await run(request(adminToken,'records'));assert.equal(records.body.audit.length,1);const approval=approved.body.results[0].approval;
     const revoked=await run(request(adminToken,'revoke',{idempotencyKey:randomUUID(),approvalId:approval.id,version:approval.version,reason:'SDK fixture revoke'}));assert.equal(revoked.body.code,'REVOKED');
     assert.equal((await run(request(memberToken,'effective'))).body.approval,null);
   });
   await t.test('unconfigured/permission DB errors expose fixed categories, never raw SQL or tokens',async()=>{
     failRPC=true;const missing=await run(request(adminToken));assert.deepEqual(missing.body,{ok:false,code:'REVIEW_NOT_CONFIGURED'});assert.equal(missing.statusCode,503);failRPC=false;
     denyRPC=true;const forbidden=await run(request(adminToken));assert.deepEqual(forbidden.body,{ok:false,code:'ADMIN_REQUIRED'});denyRPC=false;
     assert.equal(JSON.stringify([missing.body,forbidden.body]).includes('raw'),false);assert.equal(JSON.stringify(forbidden.body).includes(adminToken),false);
   });
   await t.test('100-row body limit is supported; malformed action/identity injection stays rejected',async()=>{
     const r=await run(request(adminToken,'lookup',{uids:Array.from({length:100},(_,i)=>String(9000000000+i))}));assert.equal(r.statusCode,200);
     const serialized=request(adminToken,'lookup',{uids:['9000000001']});serialized.body=JSON.stringify(serialized.body);assert.equal((await run(serialized)).statusCode,200);
     const bad=request(adminToken,'lookup',{uids:['9000000001']});bad.body.actorId=ids.admin;assert.equal((await run(bad)).statusCode,400);
   });
 }finally{await db.close();}
});

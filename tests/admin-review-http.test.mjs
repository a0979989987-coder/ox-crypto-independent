import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer,request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fixtureDatabase,fixtureIDs } from '../scripts/lib/admin-review-fixtures.mjs';
import { createPreviewHTTP } from '../server/account/admin-review-preview-http.js';
test('loopback preview HTTP validates session, origin, body, methods and no elevated client claims',async t=>{
  const db=await fixtureDatabase();let handler;
  const server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;handler=createPreviewHTTP({db,origin,fixtureIDs});
  const post=(endpoint,body,headers={})=>fetch(origin+'/preview-api/'+endpoint,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
  try {
    await t.test('anonymous/admin-session token forgery and client role flags cannot approve',async()=>{
      assert.equal((await post('lookup',{uids:['9000000001']})).status,401);
      assert.equal((await post('lookup',{uids:['9000000001']},{cookie:'ox-review-fixture=forged'})).status,401);
      assert.equal((await post('fixture-session',{mode:'admin',role:'admin'})).status,400);
      const login=await post('fixture-session',{mode:'member'}),cookie=login.headers.get('set-cookie').split(';')[0];
      assert.equal((await post('lookup',{uids:['9000000001']},{cookie})).status,403);
      assert.equal((await post('approve',{role:'admin'},{cookie})).status,403);
    });
    await t.test('CSRF/cross-origin, host rebinding and wrong methods are blocked',async()=>{
      assert.equal((await post('fixture-session',{mode:'admin'},{origin:'https://evil.test'})).status,403);
      const badHost=await new Promise((resolve,reject)=>{const request=httpRequest(origin+'/preview-api/records',{headers:{host:'evil.test'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});
      assert.equal(badHost,403);
      assert.equal((await fetch(origin+'/preview-api/records',{method:'DELETE'})).status,405);
      assert.equal((await post('fixture-session',{mode:'admin'},{'content-type':'text/plain'})).status,403);
    });
    await t.test('malformed requests and coercible UUIDs never reach a privileged mutation',async()=>{
      const login=await post('fixture-session',{mode:'admin'}),cookie=login.headers.get('set-cookie').split(';')[0];
      for(const body of [null,[],{}, {uids:[]}, {uids:['1'],accountId:fixtureIDs.admin}]) assert.equal((await post('lookup',body,{cookie})).status,400);
      assert.equal((await post('approve',{idempotencyKey:[],policyVersion:'synthetic-policy-v1',reason:'test',entries:[{uid:'9000000001',accountId:[fixtureIDs.a],revision:fixtureIDs.a,level:'core'}]},{cookie})).status,400);
      assert.equal((await post('lookup',{uids:['9'.repeat(65536)]},{cookie})).status,413);
      const result=await fetch(origin+'/preview-api/records',{headers:{cookie}});assert.equal(result.status,200);assert.equal((await result.json()).audit.length,0);
      await post('fixture-session',{mode:'guest'},{cookie});assert.equal((await post('lookup',{uids:['1']},{cookie})).status,401);
    });
    await t.test('production environment and nonloopback setup are refused',()=>{
      assert.throws(()=>createPreviewHTTP({db,fixtureIDs,origin:'http://0.0.0.0:4199'}));
      const previous=process.env.VERCEL;process.env.VERCEL='1';
      try{assert.throws(()=>createPreviewHTTP({db,fixtureIDs,origin}));}finally{if(previous===undefined)delete process.env.VERCEL;else process.env.VERCEL=previous;}
    });
    await t.test('ordinary policy is unconfigured by default and cannot silently grant rights',async()=>{
      const login=await post('fixture-session',{mode:'admin'}),cookie=login.headers.get('set-cookie').split(';')[0];
      const lookup=await (await post('lookup',{uids:['9000000001']},{cookie})).json();assert.deepEqual(lookup.ordinaryCapabilities,[]);
      const claim=lookup.claims[0];
      const result=await (await post('approve',{idempotencyKey:randomUUID(),policyVersion:lookup.policyVersion,reason:'Default unconfigured test',entries:[{uid:claim.uid,accountId:claim.accountId,revision:claim.revision,level:'ordinary'}]},{cookie})).json();
      assert.equal(result.results[0].code,'ORDINARY_POLICY_UNCONFIGURED');
      const records=await (await fetch(origin+'/preview-api/records',{headers:{cookie}})).json();assert.deepEqual(records.approvals,[]);assert.deepEqual(records.audit,[]);
    });
  }finally{await new Promise(r=>server.close(r));await db.close();}
});

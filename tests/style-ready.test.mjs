import test from 'node:test';
import assert from 'node:assert/strict';
import { createStyleLoader } from '../src/components/style-resource.js';
test('cached styles are complete CSS text, without waiting for a second load event',async()=>{
 let calls=0;const load=createStyleLoader(async()=>{calls++;return {ok:true,text:async()=>'.controls{display:flex}'};});
 const first=await load('https://example.test/tool.css');const second=await load('https://example.test/tool.css');assert.equal(first,second);assert.equal(calls,1);
});
test('HTML fallback pages cannot release an unstyled tool',async()=>{
 const load=createStyleLoader(async()=>({ok:true,text:async()=>'<html>not found</html>'}));
 await assert.rejects(load('https://example.test/tool.css'),/無效/);
});

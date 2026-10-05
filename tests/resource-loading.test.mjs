import test from 'node:test';import assert from 'node:assert/strict';
import {createStyleLoader} from '../src/components/style-resource.js';
import {withDeadline} from '../src/components/resource-deadline.js';
const keep=async fn=>{const timer=setTimeout(()=>{},1000);try{return await fn();}finally{clearTimeout(timer);}};
test('stylesheet text is shared, relative assets retain their base, and failures can retry',async()=>{
 let calls=0;const load=createStyleLoader(async()=>{calls++;if(calls===1)throw Error('offline');return {ok:true,text:async()=>'.icon{background:url(./icon.svg)}'};});
 await assert.rejects(load('https://test.invalid/styles/tool.css'));const [a,b]=await Promise.all([load('https://test.invalid/styles/tool.css'),load('https://test.invalid/styles/tool.css')]);assert.equal(calls,2);assert.equal(a,b);assert.match(a,/https:\/\/test.invalid\/styles\/icon.svg/);
});
test('stuck stylesheet response bodies expire and do not poison later mounts',()=>keep(async()=>{
 let calls=0;const load=createStyleLoader(async()=>({ok:true,text:()=>++calls===1?new Promise(()=>{}):Promise.resolve('body{color:white}')}),20);await assert.rejects(load('https://test.invalid/tool.css'),{name:'TimeoutError'});assert.equal(await load('https://test.invalid/tool.css'),'body{color:white}');
}));
test('a stuck module operation is bounded even when it ignores abort',()=>keep(()=>assert.rejects(withDeadline(()=>new Promise(()=>{}),20),{name:'TimeoutError'})));

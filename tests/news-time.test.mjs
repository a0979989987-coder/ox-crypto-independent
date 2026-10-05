import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newsBase } from '../src/components/news/model.js';
const news = ['2026-10-04T15:59:59Z','2026-10-04T16:00:00Z','2026-10-05T15:59:59Z','2026-10-05T16:00:00Z'].map((publishedAt,i)=>({id:String(i),title:'Time boundary '+i,link:`https://example.com/${i}`,markets:['crypto'],sourceId:'test',publishedAt}));
test('default current week begins Monday midnight in Taipei',()=>{
 const state=defaultState();assert.deepEqual(state.times,['week']);
 assert.deepEqual(newsBase({news},'crypto',state,{},Date.parse('2026-10-06T08:00:00Z')).map(x=>x.id),['3','2','1']);
 assert.deepEqual(newsBase({news},'crypto',state,{},Date.parse('2026-10-05T00:00:00Z')).map(x=>x.id),['1']);
});
test('custom dates include both Taipei days and compose with rolling windows',()=>{
 const state={...defaultState(),times:['custom'],customTime:{from:'2026-10-05',to:'2026-10-05'}};
 const now=Date.parse('2026-10-06T08:00:00Z');
 assert.deepEqual(newsBase({news},'crypto',state,{},now).map(x=>x.id),['2','1']);
 state.customTime.to='2026-10-04';assert.deepEqual(newsBase({news},'crypto',state,{},now),[]);
 state.customTime.to='2026-02-30';assert.deepEqual(newsBase({news},'crypto',state,{},now),[]);
 state.times=['custom','24'];assert.deepEqual(newsBase({news},'crypto',state,{},now).map(x=>x.id),['3','2']);
});

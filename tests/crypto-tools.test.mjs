import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildRotation,heatmapRows,orderFlow,normalizeTrades,derivativeRows} from '../src/markets/crypto/analytics/tools-model.js';
import {partition} from '../src/markets/crypto/analytics/tools-charts.js';
const recorded=JSON.parse(readFileSync(new URL('../previews/data/crypto-tools-snapshot.json',import.meta.url)));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('rotation compares BTC returns with a fixed non-overlapping cohort through replay',()=>{
 for(const period of ['15m','1h','4h']){
  const {frames}=buildRotation(recorded,period);assert.equal(frames.length,8);
  const cohort=f=>f.rows.flatMap(r=>r.members.map(m=>m.symbol)).sort();
  for(const f of frames){assert.deepEqual(cohort(f),cohort(frames[0]));assert.equal(new Set(cohort(f)).size,24);near(f.rows.reduce((s,r)=>s+r.share,0),100);near(f.rows.reduce((s,r)=>s+r.shareChange,0),0);
   for(const r of f.rows){near(r.x,r.returnPct-f.benchmark);near(r.y,r.x-r.previous);near(r.turnover,r.members.reduce((s,m)=>s+m.volume,0));}
  }
 }
});
test('a missing bar excludes an asset from every replay frame instead of creating a false rotation',()=>{
 const d=structuredClone(recorded);d.candles.ETHUSDT.response.data=[];
 const {frames}=buildRotation(d,'1h');assert.ok(frames.length);for(const f of frames){const l=f.rows.find(r=>r.members.some(m=>m.base==='SOL'));assert.equal(l.members.length,4);assert.equal(l.expectedMembers,5);assert.ok(!f.rows.some(r=>r.members.some(m=>m.base==='ETH')));near(f.rows.reduce((s,r)=>s+r.share,0),100);}
});
test('treemap tile areas match weights exactly and do not overlap',()=>{
 const tiles=partition([{v:50},{v:30},{v:20}],[0,0,400,250],r=>r.v);
 for(const t of tiles)near(t.rect[2]*t.rect[3],t.v*1000);
 for(let i=0;i<tiles.length;i++)for(let j=i+1;j<tiles.length;j++){const [x,y,w,h]=tiles[i].rect,[a,b,c,d]=tiles[j].rect;assert.ok(x+w<=a||a+c<=x||y+h<=b||b+d<=y);}
 assert.equal(heatmapRows(recorded,'24h').length,25);
});
test('Footprint, CVD and profile reconcile to deduplicated real trades and keep partial edges visible',()=>{
 for(const symbol of ['BTCUSDT','ETHUSDT','SOLUSDT']){const f=orderFlow(recorded.trades[symbol],{step:symbol==='BTCUSDT'?10:symbol==='ETHUSDT'?1:.01});assert.equal(f.trades.length,3000);near(f.buy-f.sell,f.delta);near(f.cvd.at(-1).value,f.delta);near(f.bars.reduce((s,b)=>s+b.total,0),f.total);near(f.profile.reduce((s,p)=>s+p.total,0),f.total);assert.ok(f.bars[0].partial&&f.bars.at(-1).partial);
 for(const b of f.bars){near(b.levels.reduce((s,l)=>s+l.ask,0),b.buy);near(b.levels.reduce((s,l)=>s+l.bid,0),b.sell);}
 const dupe={records:[...recorded.trades[symbol].records,...recorded.trades[symbol].records]};assert.equal(normalizeTrades(dupe).length,3000);
 }
});
test('OI changes use base units and premium uses mark/index without invented maturity',()=>{
 const data={instruments:[],tickers:[{symbol:'BTCUSDT',holdingAmount:'110',markPrice:'200',indexPrice:'198',lastPr:'202',ts:'2'}],previousTickers:[{symbol:'BTCUSDT',holdingAmount:'100',lastPr:'100',ts:'1'}]};const r=derivativeRows(data)[0];near(r.oiChange,10);near(r.notional,22000);near(r.premium,100*(200/198-1));assert.equal(r.funding,null);assert.equal(r.ratio,null);
});

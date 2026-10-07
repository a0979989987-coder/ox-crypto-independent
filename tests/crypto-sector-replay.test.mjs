import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_GROUPS, verifiedSectorUniverse, withSectorCatalog } from '../src/markets/crypto/analytics/sector-taxonomy.js';
import { replayVisualRows, createFlowReplayPlayer } from '../src/markets/crypto/analytics/replay-motion.js';
import { buildRotation } from '../src/markets/crypto/analytics/tools-model.js';
import { readFileSync } from 'node:fs';

const recorded=JSON.parse(readFileSync(new URL('../previews/data/crypto-tools-snapshot.json',import.meta.url)));
test('24 overlapping groups retain all requested candidates; only online crypto USDT contracts enter a group',()=>{
 assert.equal(SECTOR_GROUPS.length,24);
 assert.deepEqual(SECTOR_GROUPS.find(g=>g.id==='pow').bases,['BTC','LTC','BCH','DOGE','KAS','ETC']);
 const instrument=(base,status='online')=>({symbol:base+'USDT',baseCoin:base,quoteCoin:'USDT',symbolType:'crypto',type:'perpetual',status});
 const quote=base=>({symbol:base+'USDT',usdtVolume:'5000'});
 const pool=verifiedSectorUniverse(['BTC','DOGE','ETH','UNI','FET','LINK','XRP','ZK'].map(base=>instrument(base)).concat(instrument('MORPHO','offline')),
  ['BTC','DOGE','ETH','UNI','FET','LINK','XRP','ZK','MORPHO'].map(quote));
 assert.equal(pool.sectors.length,24);
 assert.deepEqual(pool.sectors.find(s=>s.id==='ai').members,['FETUSDT']);
 assert.ok(pool.sectors.find(s=>s.id==='meme').members.includes('DOGEUSDT'));
 assert.ok(pool.sectors.find(s=>s.id==='pow').members.includes('DOGEUSDT'));
 assert.ok(pool.sectors.find(s=>s.id==='lending').requestedBases.includes('MORPHO'));
 assert.ok(!pool.symbols.includes('MORPHOUSDT'));
 assert.equal(new Set(pool.symbols).size,pool.symbols.length);
});
test('old recorded snapshot gains a full selectable catalog without inventing unrecorded market data',()=>{
 const expanded=withSectorCatalog(recorded);
 assert.equal(expanded.sectors.length,24);
 assert.equal(expanded.tickers.length,recorded.tickers.length);
 assert.equal(Object.keys(expanded.candles).length,Object.keys(recorded.candles).length);
 const {frames}=buildRotation(expanded,'1h');
 assert.ok(frames.length);
 for(const frame of frames){const symbols=new Set(frame.rows.flatMap(row=>row.members.map(member=>member.symbol)));
  assert.ok([...symbols].every(symbol=>expanded.candles[symbol]?.response?.data?.length));
  assert.ok(frame.rows.every(row=>row.members.length>=2));
 }
});
test('visual playback interpolates position, radius input and color without mutating closed frames',()=>{
 const row=(x,y,turnover,color)=>({symbol:'A',x,y,turnover,state:{id:'leading',color}});
 const frames=[{rows:[row(0,4,100,'#000000')]},{rows:[row(10,14,300,'#ffffff')]}];
 const visual=replayVisualRows(frames,.5,frames[0].rows)[0];
 assert.deepEqual([visual.x,visual.y,visual.turnover,visual.state.color],[5,9,200,'#808080']);
 assert.equal(frames[0].rows[0].turnover,100);
 assert.equal(replayVisualRows(frames,0,frames[0].rows)[0],frames[0].rows[0]);
});
test('one playback clock pauses and resumes fractionally, seeks, and cancels on teardown',()=>{
 let clock=0,handle=0;const pending=new Map(),rendered=[];
 const player=createFlowReplayPlayer({length:3,render:p=>rendered.push(p),requestFrame:callback=>{pending.set(++handle,callback);return handle;},cancelFrame:id=>pending.delete(id)});
 const advance=ms=>{clock+=ms;const [id,callback]=pending.entries().next().value;pending.delete(id);callback(clock);};
 player.play();advance(10);advance(130);assert.ok(player.position>0&&player.position<1);
 player.pause();const saved=player.position;assert.equal(pending.size,0);
 player.play();advance(30);assert.equal(player.position,saved);
 advance(100);assert.ok(player.position>saved);
 player.seek(1.5);assert.equal(player.position,1.5);assert.equal(player.playing,false);
 player.play();advance(20);player.destroy();assert.equal(pending.size,0);assert.ok(rendered.some(x=>x>1&&x<2));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_GROUPS, verifiedSectorUniverse, withSectorCatalog } from '../src/markets/crypto/analytics/sector-taxonomy.js';
import { replayVisualRows, createFlowReplayPlayer } from '../src/markets/crypto/analytics/replay-motion.js';
import { buildRotation } from '../src/markets/crypto/analytics/tools-model.js';
import { createMarketRefreshCache } from '../src/markets/crypto/analytics/market-cache.js';
import { readFileSync } from 'node:fs';

const recorded=JSON.parse(readFileSync(new URL('../previews/data/crypto-tools-snapshot.json',import.meta.url)));
test('31 overlapping groups and 226 topics retain candidates; only online crypto USDT contracts enter a group',()=>{
 assert.equal(SECTOR_GROUPS.length,31);
 assert.equal(SECTOR_GROUPS.reduce((count,group)=>count+group.topics.length,0),226);
 assert.ok(['BTC','LTC','BCH','DOGE','KAS','ETC'].every(base=>SECTOR_GROUPS.find(g=>g.id==='pow').bases.includes(base)));
 assert.ok(SECTOR_GROUPS.find(g=>g.id==='meme').topics.find(t=>t.name==='青蛙系').candidates.includes('PEPE'));
 const instrument=(base,status='online')=>({symbol:base+'USDT',baseCoin:base,quoteCoin:'USDT',symbolType:'crypto',type:'perpetual',status});
 const quote=base=>({symbol:base+'USDT',usdtVolume:'5000'});
 const pool=verifiedSectorUniverse(['BTC','DOGE','ETH','UNI','FET','LINK','XRP','ZK','BEAM','RIF','HONEY','VELO'].map(base=>instrument(base)).concat(instrument('MORPHO','offline')),
  ['BTC','DOGE','ETH','UNI','FET','LINK','XRP','ZK','MORPHO','BEAM','RIF','HONEY','VELO'].map(quote));
 assert.equal(pool.sectors.length,31);
 assert.ok(pool.sectors.find(s=>s.id==='ai').members.includes('FETUSDT'));
 assert.equal(pool.sectors.find(s=>s.id==='meme').topics.find(t=>t.name==='狗系').members.includes('DOGEUSDT'),true);
 assert.ok(pool.sectors.find(s=>s.id==='meme').members.includes('DOGEUSDT'));
 assert.ok(pool.sectors.find(s=>s.id==='pow').members.includes('DOGEUSDT'));
 assert.ok(pool.sectors.find(s=>s.id==='defi').requestedBases.includes('MORPHO'));
 assert.ok(!pool.symbols.includes('MORPHOUSDT'));
 for(const ticker of ['BEAM','RIF','HONEY','VELO'])assert.ok(!pool.symbols.includes(ticker+'USDT'),'unresolved homonyms cannot be misclassified');
 assert.ok(pool.sectors.find(s=>s.id==='privacy').topics.find(t=>t.name==='隱私貨幣').candidates.includes('BEAM'));
 assert.ok(pool.sectors.find(s=>s.id==='gamefi').topics.find(t=>t.name==='遊戲公鏈／基礎設施').candidates.includes('BEAM'));
 assert.equal(new Set(pool.symbols).size,pool.symbols.length);
});
test('old recorded snapshot gains a full selectable catalog without inventing unrecorded market data',()=>{
 const expanded=withSectorCatalog(recorded);
 assert.equal(expanded.sectors.length,31);
 assert.equal(expanded.tickers.length,recorded.tickers.length);
 assert.equal(Object.keys(expanded.candles).length,Object.keys(recorded.candles).length);
 const {frames}=buildRotation(expanded,'1h');
 assert.ok(frames.length);
 for(const frame of frames){const symbols=new Set(frame.rows.flatMap(row=>row.members.map(member=>member.symbol)));
  assert.ok([...symbols].every(symbol=>expanded.candles[symbol]?.response?.data?.length));
  assert.ok(frame.rows.every(row=>row.members.length>=2));
 }
});
test('complete captured coverage can be reused while fresh instead of starting another market scan',async()=>{
 let fetches=0;const cache=createMarketRefreshCache(async()=>{fetches++;throw Error('Unnecessary refresh');},{now:()=>Number(recorded.requestTime)+1000});
 const restored=withSectorCatalog(recorded);
 assert.equal(restored.scan?.done,restored.tickers.length);
 assert.equal(await cache.refresh(restored),restored);
 assert.equal(fetches,0);
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

test('explicit multiplier contracts are verified without suffix-matching unrelated projects',()=>{
 const bases=['BTC','1000BONK','1MBABYDOGE','1MCHEEMS','1000000MOG','1000XEC','1000SATS','1000RATS','CHIP','1000CAT'];
 const instruments=bases.map(base=>({symbol:base+'USDT',baseCoin:base,quoteCoin:'USDT',symbolType:'crypto',type:'perpetual',status:'online'}));
 const tickers=bases.map(base=>({symbol:base+'USDT',usdtVolume:100}));
 const pool=verifiedSectorUniverse(instruments,tickers);
 for(const base of bases.slice(1,8))assert.ok(pool.symbols.includes(base+'USDT'));
 assert.ok(!pool.sectors.find(s=>s.id==='meme').members.includes('1000CATUSDT'));
 assert.ok(!pool.symbols.includes('IPUSDT'));
 instruments.find(i=>i.symbol==='1000BONKUSDT').baseCoin='OTHER';
 assert.ok(!verifiedSectorUniverse(instruments,tickers).symbols.includes('1000BONKUSDT'));
});

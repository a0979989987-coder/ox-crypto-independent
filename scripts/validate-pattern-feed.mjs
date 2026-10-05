// Read-only production-feed smoke check. Artifacts are evidence, not a website fallback.
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { selectUniverse,parseCandles,fetchSeries } from '../src/markets/crypto/patterns/source.js';
import { matchCandles } from '../src/markets/crypto/patterns/matcher.js';
import { TIMEFRAMES } from '../src/markets/crypto/patterns/catalog.js';
const origin='https://a0979989987-coder.github.io';
async function get(path){
 const response=await fetch('https://api.bitget.com'+path,{signal:AbortSignal.timeout(20000),headers:{Origin:origin}});
 assert.equal(response.status,200);const cors=response.headers.get('access-control-allow-origin');assert.ok(cors==='*'||cors===origin,'Bitget must allow the deployed browser origin');
 const json=await response.json();assert.equal(json.code,'00000');assert.ok(Array.isArray(json.data));assert.ok(Math.abs(Date.now()-Number(json.requestTime))<300000);return json;
}
const quotes=await get('/api/v2/mix/market/tickers?productType=USDT-FUTURES'),metadata=await get('/api/v3/market/instruments?category=USDT-FUTURES');
const pool=selectUniverse(quotes.data,metadata.data,80);assert.ok(pool.length>3);
const evidence={capturedAt:new Date().toISOString(),source:'Bitget',universe:pool.length,checks:[],responses:{}};
for(const [i,ticker] of pool.slice(0,4).entries())for(const frame of i===0?Object.keys(TIMEFRAMES):['1H','4H']){
 const granularity=['6H','12H','1D','1W'].includes(frame)?frame+'utc':frame;
 const path=`/api/v2/mix/market/candles?symbol=${ticker.symbol}&productType=USDT-FUTURES&granularity=${granularity}&limit=200`;
 const body=await get(path),candles=frame==='1W'?(await fetchSeries(ticker.symbol,frame,new AbortController().signal)).candles:parseCandles(body.data,frame,Number(body.requestTime));assert.ok(candles.length>=35,`${ticker.symbol} ${frame} candles`);
 const match=matchCandles(candles,{id:'w'});evidence.checks.push({symbol:ticker.symbol,frame,candles:candles.length,provisional:!!candles.at(-1).provisional,lastOpenTime:candles.at(-1).time,wSimilarity:match?.similarity??null});evidence.responses[ticker.symbol+':'+frame]=body;
 console.log('PASS',ticker.symbol,frame,candles.length,'candles; CORS allowed; W',match?.similarity??'no match');
 await new Promise(r=>setTimeout(r,350));
}
await mkdir('artifacts/pattern-feed',{recursive:true});await writeFile('artifacts/pattern-feed/verified.json',JSON.stringify(evidence,null,2));
console.log('PASS live Bitget API validation; source timestamps preserved');

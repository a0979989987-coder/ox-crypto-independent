// Explicit synthetic market fixtures; never imported by production modules.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
export function fixtureBody(url,now=Date.now()){
 const u=new URL(url),body=require('./e2e-check.cjs').bitgetBody(u);
 if(u.pathname.endsWith('/taker-buy-sell')){const step=({'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'2h':7200000,'4h':14400000,'6h':21600000,'12h':43200000,'1d':86400000})[u.searchParams.get('period')]||3600000,offset=(16*3600000)%step,boundary=Math.floor((now-offset)/step)*step+offset;return {code:'00000',requestTime:now,data:Array.from({length:20},(_,i)=>({ts:String(boundary-(20-i)*step),buyVolume:String(20+i),sellVolume:'15'}))};}
 let data=body.data.map(row=>Array.isArray(row)?row:{...row,baseCoin:row.symbol?.replace('USDT',''),ts:String(now)});
 // The base fixture is created once when the test server starts. Advance its
 // closed candle timestamps with the requested clock, rather than stamping an
 // old minute series as fresh during a later retry.
 if(u.pathname.endsWith('/candles')&&data.length){const match=/^(\d+)(m|H|D|W)(?:utc)?$/.exec(u.searchParams.get('granularity')||'1H');if(match){const step=Number(match[1])*({m:60000,H:3600000,D:86400000,W:604800000})[match[2]],last=Math.floor(now/step)*step-step,shift=last-Number(data.at(-1)[0]);data=data.map(row=>[String(Number(row[0])+shift),...row.slice(1)]);}}
 if(u.pathname.endsWith('/candles')&&u.searchParams.get('limit')==='32'&&data.length){const match=/^(\d+)(m|H|D)(?:utc)?$/.exec(u.searchParams.get('granularity'));if(match){const step=Number(match[1])*({m:60000,H:3600000,D:86400000})[match[2]],end=Math.floor(now/step)*step;data=data.slice(-32).map((row,i,a)=>[String(end-(a.length-i)*step),...row.slice(1)]);}}
 if(u.searchParams.get('granularity')==='1Dutc'&&data.length){const base=Number(data.at(-1)[4]),boundary=Math.floor(now/86400000)*86400000;data=Array.from({length:32},(_,i)=>{const open=base*(1+(i-16)*.003),close=open*(1+Math.sin(i/3)*.008);return [String(boundary-(32-i)*86400000),String(open),String(Math.max(open,close)*1.01),String(Math.min(open,close)*.99),String(close),'1000',String(close*1000)];});}
 if(u.searchParams.get('granularity')==='15m'&&data.length){const first=data[0];data=[...Array.from({length:200-data.length},(_,i)=>[String(Number(first[0])-(200-data.length-i)*900000),...first.slice(1)]),...data];}
 return {...body,requestTime:now,data};
}
export function fixtureSnapshots(now=Date.now()){
 const raw=JSON.parse(readFileSync(new URL('../previews/data/crypto-tools-snapshot.json',import.meta.url)));
 const tickers=fixtureBody('https://api.bitget.com/api/v2/mix/market/tickers',now).data,instruments=fixtureBody('https://api.bitget.com/api/v3/market/instruments',now).data;
 const symbols=tickers.map(t=>t.symbol),candles=Object.fromEntries(symbols.map(s=>[s,{response:fixtureBody('https://api.bitget.com/api/v2/mix/market/candles?symbol='+s+'&granularity=15m',now)}]));
 const market={...raw,instruments,tickers,previousTickers:tickers,candles,requestTime:now-600000,kind:'recorded',sectors:[{id:'fixture',name:'測試觀察池',categoryId:'fixture',source:'https://example.test/fixture',members:symbols.filter(s=>s!=='BTCUSDT')}]};
 const flow={schemaVersion:1,kind:'recorded',capturedAt:new Date(now-600000).toISOString(),captureCompletedAt:new Date(now-600000).toISOString(),tickerRequestTime:now-600000,instruments,tickers,flows:Object.fromEntries(['15m','1h','4h'].map(p=>[p,Object.fromEntries(symbols.map(s=>[s,{response:fixtureBody('https://api.bitget.com/api/v2/mix/market/taker-buy-sell?symbol='+s+'&period='+p,now-600000)}]))]))};
 return {market,flow};
}
export async function routeSnapshots(page){const {market,flow}=fixtureSnapshots();await page.route('**/previews/data/crypto-tools-snapshot.json',r=>r.fulfill({json:market}));await page.route('**/previews/data/crypto-flow-snapshot.json',r=>r.fulfill({json:flow}));}

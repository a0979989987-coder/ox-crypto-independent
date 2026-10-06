// Explicit synthetic market fixtures; never imported by production modules.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
export function fixtureBody(url,now=Date.now()){
 const u=new URL(url),body=require('./e2e-check.cjs').bitgetBody(u);
 if(u.pathname.endsWith('/taker-buy-sell')){const step=({'15m':900000,'1h':3600000,'4h':14400000})[u.searchParams.get('period')]||3600000,boundary=Math.floor(now/step)*step;return {code:'00000',requestTime:now,data:Array.from({length:20},(_,i)=>({ts:String(boundary-(20-i)*step),buyVolume:String(20+i),sellVolume:'15'}))};}
 let data=body.data.map(row=>Array.isArray(row)?row:{...row,baseCoin:row.symbol?.replace('USDT',''),ts:String(now)});
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

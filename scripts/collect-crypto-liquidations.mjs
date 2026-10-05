// Public Bybit observed liquidations. Run continuously behind a production collector;
// this bounded review capture never claims a full exchange-wide historical window.
import { writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
const out=resolve(import.meta.dirname,'../previews/data/crypto-liquidations-snapshot.json');
const duration=Number(process.env.OX_LIQ_CAPTURE_MS)||180000;
const result={source:'Bybit allLiquidation',kind:'observed-snapshot',symbols:['BTCUSDT','ETHUSDT','SOLUSDT'],startedAt:Date.now(),endedAt:null,connectedAt:null,acknowledged:false,status:'connecting',events:[],gaps:[],priceBasis:'Bankruptcy price × executed size, in USDT; not actual execution notional.'};
const seen=new Set();let dirty=true;
const ws=new WebSocket('wss://stream.bybit.com/v5/public/linear');
ws.addEventListener('open',()=>{result.connectedAt=Date.now();result.status='connected';ws.send(JSON.stringify({op:'subscribe',args:result.symbols.map(s=>'allLiquidation.'+s)}));dirty=true;console.log('CONNECTED');});
ws.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.op==='subscribe'){result.acknowledged=!!m.success;dirty=true;}if(!m.topic?.startsWith('allLiquidation.'))return;for(const d of m.data||[]){const key=[d.T,d.s,d.S,d.v,d.p].join(':');if(seen.has(key))continue;seen.add(key);const p=Number(d.p),q=Number(d.v);if(!(p>0&&q>0))continue;result.events.push({ts:Number(d.T),symbol:d.s,side:d.S==='Buy'?'long':d.S==='Sell'?'short':null,size:q,bankruptcyPrice:p,amount:p*q});dirty=true;}}catch{}});
ws.addEventListener('error',()=>{result.status='error';result.gaps.push({time:Date.now(),reason:'WebSocket connection error'});dirty=true;});
ws.addEventListener('close',()=>{if(!result.endedAt){result.status='disconnected';result.gaps.push({time:Date.now(),reason:'Disconnected before capture end'});}dirty=true;});
async function save(){if(!dirty)return;dirty=false;await writeFile(out+'.tmp',JSON.stringify(result,null,2));await rename(out+'.tmp',out);}
const flush=setInterval(save,1000),ping=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({op:'ping'}));},20000);
setTimeout(async()=>{result.endedAt=Date.now();if(result.status==='connected')result.status='recorded';dirty=true;clearInterval(flush);clearInterval(ping);await save();ws.close();console.log('SAVED',result.events.length,result.status);setTimeout(()=>process.exit(0),500);},duration);

// One public quote connection serves visible cards. Quotes never reclassify
// candidates, alter candle history, or replace the complete scan universe.
globalThis.OXCryptoQuotes = (() => {
  const subscribers=new Set(),cache=new Map(),dirty=new Set();
  let socket=null,subscribed=new Set(),retry=null,watchdog=null,raf=null,attempts=0,lastMessage=0,lastPing=0,channelTimer=null,lastSync=-Infinity;
  const blocked=()=>!!document.body?.classList.contains('ox-feature-blocked');
  const validSymbol=s=>typeof s==='string'&&/^[A-Z0-9]{2,32}USDT$/.test(s);
  const desired=()=>new Set([...new Set([...subscribers].flatMap(s=>[...s.symbols]))].slice(0,100));
  const fresh=s=>{const q=cache.get(s);return q&&Math.max(Date.now()-q.ts,Date.now()-q.received)<=15000?q:null;};
  function flush(){raf=null;if(document.hidden||blocked())return;const changed=new Set(dirty);dirty.clear();for(const s of subscribers){const quotes=[...s.symbols].filter(k=>changed.has(k)).map(fresh).filter(Boolean);if(quotes.length)try{s.callback(quotes);}catch(e){console.error('Quote rendering failed',e);}}}
  function notify(symbols=cache.keys()){for(const symbol of symbols)if(cache.has(symbol))dirty.add(symbol);if(dirty.size&&raf===null&&!document.hidden&&!blocked()&&subscribers.size)raf=requestAnimationFrame(flush);}
  function seed(rows,ts){
    const changed=[],active=desired();
    for(const row of rows){const symbol=row.symbol||row.instId,at=Number(row.ts||ts),price=Number(row.lastPr),change=Number(row.change24h),volume=Number(row.usdtVolume??row.quoteVolume);
      if(!validSymbol(symbol)||!Number.isFinite(at)||at<=0||at>Date.now()+60000||!Number.isFinite(price)||price<=0||!Number.isFinite(change)||!Number.isFinite(volume)||volume<0||at<=(cache.get(symbol)?.ts||0))continue;
      changed.push(symbol);cache.delete(symbol);cache.set(symbol,{symbol,lastPr:price,change24h:change,usdtVolume:volume,ts:at,received:Date.now()});
      while(cache.size>240){const oldest=[...cache.keys()].find(k=>!active.has(k));cache.delete(oldest);dirty.delete(oldest);}
    }notify(changed);
  }
  function close(){clearTimeout(channelTimer);channelTimer=null;lastSync=-Infinity;const old=socket;socket=null;subscribed.clear();if(old){old.onopen=old.onclose=old.onerror=old.onmessage=null;old.close();}clearInterval(watchdog);watchdog=null;}
  function send(op,symbols){if(symbols.length&&socket?.readyState===1)socket.send(JSON.stringify({op,args:symbols.map(instId=>({instType:'USDT-FUTURES',channel:'ticker',instId}))}));}
  function sync(){
    const symbols=desired();
    if(document.hidden||blocked()||!symbols.size){close();clearTimeout(retry);retry=null;if(!symbols.size)attempts=0;return;}
    if(!socket){if(!retry&&attempts<5)connect();return;}
    if(socket.readyState!==1)return;
    const delay=500-(Date.now()-lastSync);if(delay>0){if(!channelTimer)channelTimer=setTimeout(()=>{channelTimer=null;sync();},delay);return;}lastSync=Date.now();
    send('unsubscribe',[...subscribed].filter(s=>!symbols.has(s)));send('subscribe',[...symbols].filter(s=>!subscribed.has(s)));subscribed=symbols;
  }
  function failed(ws){if(socket!==ws)return;close();if(!document.hidden&&desired().size&&attempts<5){retry=setTimeout(()=>{retry=null;sync();},Math.min(30000,1000*2**Math.max(0,attempts-1)));}}
  function connect(){
    if(typeof WebSocket!=='function')return;attempts++;
    let ws;try{ws=new WebSocket('wss://ws.bitget.com/v2/ws/public');}catch{retry=setTimeout(()=>{retry=null;sync();},1000*attempts);return;}
    socket=ws;lastMessage=lastPing=Date.now();
    ws.onopen=()=>{if(socket===ws)sync();};
    ws.onclose=ws.onerror=()=>failed(ws);
    ws.onmessage=e=>{if(socket!==ws||document.hidden)return;if(e.data==='pong'){lastMessage=Date.now();return;}
      let m;try{m=JSON.parse(e.data);}catch{return;}
      if(m.event==='error'){failed(ws);return;}
      if(m.arg?.channel!=='ticker'||m.arg.instType!=='USDT-FUTURES'||!subscribed.has(m.arg.instId)||!Array.isArray(m.data))return;
      lastMessage=Date.now();attempts=0;
      seed(m.data.filter(r=>(r.symbol||r.instId)===m.arg.instId),m.ts);
    };
    watchdog=setInterval(()=>{if(socket!==ws)return;const now=Date.now();if(now-lastMessage>45000){failed(ws);return;}if(ws.readyState===1&&now-lastPing>=20000){lastPing=now;ws.send('ping');}},5000);
  }
  function wake(){clearTimeout(retry);retry=null;attempts=0;sync();notify();}
  document.addEventListener('visibilitychange',()=>document.hidden?sync():wake());
  window.addEventListener('online',wake);
  if(document.body){let wasBlocked=blocked();new MutationObserver(()=>{const next=blocked();if(next!==wasBlocked){wasBlocked=next;next?sync():wake();}}).observe(document.body,{attributes:true,attributeFilter:['class']});}
  return {seed,get:fresh,subscribe(symbols,callback){const s={symbols:new Set(symbols.filter(validSymbol).slice(0,100)),callback};subscribers.add(s);sync();notify(s.symbols);return {update(symbols){if(!subscribers.has(s))return;s.symbols=new Set(symbols.filter(validSymbol).slice(0,100));sync();notify(s.symbols);},stop(){subscribers.delete(s);sync();if(!subscribers.size&&raf!==null){cancelAnimationFrame(raf);raf=null;}if(!subscribers.size)dirty.clear();}};}};
})();

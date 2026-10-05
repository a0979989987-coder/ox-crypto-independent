/* Bitget's authoritative OHLC stream. REST fills gaps and backs up unavailable streams. */
const CryptoLiveCandles = (() => {
  const streamPeriods = new Set(['1m','5m','15m','30m','1H','4H','6H','12H','1D','3D','1W','1M']);
  function closeTime(candle, period) {
    if (period === '1M') {
      // Classic 1M bars open at midnight UTC+8 (the previous UTC month's last day).
      const date = new Date(candle.time * 1000 + 8 * 3600000);
      date.setUTCMonth(date.getUTCMonth() + 1);
      return date.getTime() / 1000 - 8 * 3600;
    }
    return candle.time + (periods[period] || 60);
  }
  function parse(row) {
    if (!Array.isArray(row)) return null;
    const [ms,open,high,low,close,volume,quoteVolume] = row.map(Number);
    if (![ms,open,high,low,close,volume].every(Number.isFinite) || ms <= 0 || low <= 0 || high < low || high < Math.max(open,close) || low > Math.min(open,close) || volume < 0) return null;
    return {time:Math.floor(ms / 1000),open,high,low,close,volume,quoteVolume:Number.isFinite(quoteVolume) ? quoteVolume : 0};
  }
  function subscribe(symbol, period, onCandles, options = {}) {
    const fetchCandles = options.fetchCandles || ((...args) => BitgetAPI.fetchCandles(...args));
    const useSocket = options.websocket !== false && streamPeriods.has(period) && typeof WebSocket !== 'undefined';
    const arg = {instType:'USDT-FUTURES',channel:`candle${period}`,instId:symbol};
    let stopped=false, ready=false, socket=null, retry=null, attempts=0, heartbeat=0, lastPush=0, lastSync=0, lastTs=0, revision=0, loading=null;
    let cache=new Map();
    const rows = () => [...cache.values()].map(v=>v.candle).sort((a,b)=>a.time-b.time);
    const emit = data => { if (ready && !stopped && data.length) onCandles(data); };
    async function sync(limit=160) {
      if (stopped) return [];
      if (loading) return loading;
      const startRevision=revision;
      lastSync=Date.now();
      loading=(async()=>{
        try {
          const data=await fetchCandles(symbol,period,limit);
          if (stopped) return [];
          // A REST response must never roll back a push received while it was in flight.
          const first=ready ? rows()[0]?.time || 0 : 0;
          const latest=rows().at(-1)?.time;
          for (const candle of data.filter(c=>c.time>=first)) {
            const entry=cache.get(candle.time);
            const liveCurrent=entry?.live && candle.time===latest && Date.now()-lastPush<15000;
            if (!liveCurrent && (entry?.revision || 0) <= startRevision) cache.set(candle.time,{candle,revision:startRevision,live:false});
          }
          const merged=rows();
          emit(merged);
          return merged;
        } finally { loading=null; }
      })();
      return loading;
    }
    function reconnect() {
      if (stopped || retry) return;
      retry=setTimeout(()=>{retry=null;connect();},Math.min(30000,1000 * 2 ** attempts++));
    }
    function connect() {
      if (stopped || !useSocket) return;
      let connection;
      try { connection=socket=new WebSocket('wss://ws.bitget.com/v2/ws/public'); }
      catch (_) {reconnect();return;}
      heartbeat=Date.now();
      connection.onopen=()=>{
        if (stopped || socket!==connection) return;
        attempts=0;heartbeat=Date.now();
        connection.send(JSON.stringify({op:'subscribe',args:[arg]}));
        if (ready) sync().catch(()=>{});
      };
      connection.onmessage=event=>{
        if (stopped || socket!==connection) return;
        heartbeat=Date.now();
        if (event.data==='pong') return;
        let message;
        try { message=JSON.parse(event.data); } catch (_) { return; }
        if (message.arg?.instId!==symbol || message.arg?.channel!==arg.channel || message.arg?.instType!==arg.instType || !Array.isArray(message.data)) return;
        const timestamp=Number(message.ts)||Date.now();
        if (timestamp<lastTs) return;
        const data=message.data.map(parse).filter(Boolean).sort((a,b)=>a.time-b.time);
        if (!data.length) return;
        const previousTime=rows().at(-1)?.time;
        lastTs=timestamp;lastPush=Date.now();
        for (const candle of data) cache.set(candle.time,{candle,revision:++revision,live:true});
        emit(data);
        // Reconcile the completed bar's final OHLC/volume and any missed bars at rollover.
        if (ready && previousTime && data.at(-1).time>previousTime) sync().catch(()=>{});
      };
      connection.onerror=()=>connection.close();
      connection.onclose=()=>{if(socket===connection){socket=null;reconnect();}};
    }
    const poll=setInterval(()=>{
      if (stopped || document.hidden) return;
      const now=Date.now(), last=rows().at(-1);
      if (now-lastSync>=5000 && (!lastPush || now-lastPush>5000 || (last && now/1000>=closeTime(last,period)))) sync().catch(()=>{});
    },1000);
    const ping=setInterval(()=>{
      if (!socket) return;
      if (Date.now()-heartbeat>45000) { socket.close(); return; }
      if (socket.readyState===1) socket.send('ping');
    },20000);
    const resume=()=>{
      if (stopped || document.hidden) return;
      // Expire old sockets after suspension; an apparently OPEN mobile socket may be dead.
      if (socket && Date.now()-heartbeat>45000) socket.close();
      if (!socket && useSocket) {clearTimeout(retry);retry=null;connect();}
      sync().catch(()=>{});
    };
    document.addEventListener('visibilitychange',resume);
    window.addEventListener('online',resume);
    connect();
    return {
      async load(limit=160) {
        try {return await sync(limit);}
        catch (error) {if(cache.size)return rows();throw error;}
        finally {ready=true;}
      },
      resync:()=>sync(),
      stop() {
        stopped=true;clearTimeout(retry);clearInterval(poll);clearInterval(ping);
        document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);
        socket?.close();cache.clear();
      }
    };
  }
  return {subscribe,closeTime};
})();

// Reuse for main, home and preview charts; updating a live bar preserves the user's viewport.
function mergeCryptoLiveCandles(previous, incoming) {
  const map=new Map(previous.map(c=>[c.time,c]));
  for (const candle of incoming) map.set(candle.time,candle);
  return [...map.values()].sort((a,b)=>a.time-b.time);
}
function updateCryptoLiveSeries(series, volumeSeries, previous, incoming) {
  incoming=incoming.filter(c=>!previous.length || c.time>=previous[0].time);
  const combined=mergeCryptoLiveCandles(previous,incoming);
  const last=previous.at(-1)?.time || 0;
  const changed=incoming.filter(c=>{
    const old=previous.find(p=>p.time===c.time);
    return !old || ['open','high','low','close','volume','quoteVolume'].some(k=>old[k]!==c[k]);
  }).sort((a,b)=>a.time-b.time);
  const volume=c=>({time:c.time,value:c.quoteVolume || c.volume,color:c.close>=c.open?'#00b8d440':'#ff307840'});
  if (changed.some(c=>c.time<last)) {
    series.setData(combined);volumeSeries?.setData(combined.map(volume));
  } else {
    for (const candle of changed) {series.update(candle);volumeSeries?.update(volume(candle));}
  }
  return combined;
}

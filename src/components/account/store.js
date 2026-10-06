function currentLocalAccountEmail() { return window.OXAuth?.user?.email || ""; }
function watchStorageKey() { const id=window.OXAuth?.user?.id;return id?"ox-watchlist:user:"+encodeURIComponent(id):"ox-watchlist"; }
function getWatchlistRecords() { try { const v = JSON.parse(localStorage.getItem(watchStorageKey()) || "[]"); return Array.isArray(v) ? v.filter(x => x && x.symbol) : []; } catch { return []; } }
function isWatchlisted(symbol) { return getWatchlistRecords().some(x => x.symbol === symbol); }
function syncWatchBadge() { const el = document.getElementById("badge-watch"); if (el) el.textContent = getWatchlistRecords().length; }
function saveWatchlistRecords(list) { localStorage.setItem(watchStorageKey(), JSON.stringify(list)); syncWatchBadge(); AccountStore.capturePrefs(); }
function watchSnapshot(symbol) {
  const c = state.analyzedCache.get(symbol) || {};
  const t = state.tickers.find(x => x.symbol === symbol) || {};
  return { symbol, side:c.side || "—", tier:c.displayTier || c.tier || "t3", displayTier:c.displayTier || c.tier || "t3", oxScore:c.oxScore ?? null, change24h:t.change24h ?? c.change24h ?? 0, lastPr:t.lastPr ?? c.lastPr ?? 0, savedAt:Date.now() };
}
function toggleWatchSymbol(symbol) {
  const list = getWatchlistRecords();
  const i = list.findIndex(x => x.symbol === symbol);
  if (i >= 0) { list.splice(i,1); showToast(`☆ 已從觀察移除 ${symbol.replace(/USDT$/,'')}`); }
  else { list.unshift(watchSnapshot(symbol)); showToast(`★ 已加入觀察 ${symbol.replace(/USDT$/,'')}`); }
  saveWatchlistRecords(list.slice(0,100));
  renderCurrentTab();
}

// Identity is owned by OXAuth. Preserve legacy UI hooks without duplicating sessions.
// Guest watchlists stay local; signed-in accounts never inherit another account's list.
document.addEventListener("ox:accountchange",()=>{syncWatchBadge();renderCurrentTab();});
const AccountStore = Object.freeze({
  loadUsers: () => ({}), collectPrefs: () => ({}), applyPrefs: () => {}, capturePrefs: () => {},
  register: async () => { throw new Error("OX Account 驗證服務尚未連接"); },
  login: async () => { throw new Error("OX Account 驗證服務尚未連接"); },
  logout: () => {}, currentEmail: currentLocalAccountEmail
});
function updateAccountUI() {
  const title=document.getElementById("ox-account-title"), sub=document.getElementById("ox-account-sub"), tag=document.getElementById("ox-account-action-tag");
  if(title) title.textContent="登入 / 註冊";
  if(sub) sub.textContent="建立你的 OX 統一帳號。";
  if(tag) tag.textContent="OX ACCOUNT";
}

const MarketController = (() => {
  const labels={crypto:"加密貨幣"};
  const setMarket = (market,{toast=true,kick=true}={}) => {
    if(!labels[market]) return;
    if (state.activeMarket === market && document.body.dataset.market === market) return;
    if(market!=="crypto"){state.chartLiveFeed?.stop();state.chartLiveFeed=null;state.chartLiveQuote=null;}
    state.activeMarket=market; localStorage.setItem("ox-active-market",market); document.body.dataset.market=market;
    document.querySelectorAll("[data-terminal-view]").forEach(el => { el.textContent = {crypto:"Crypto"}[market]; });
    document.dispatchEvent(new CustomEvent("ox:marketchange",{detail:{market}}));
    document.querySelectorAll("[data-market-choice]").forEach(b=>b.classList.toggle("active",b.dataset.marketChoice===market));
    const st=document.getElementById("ox-market-status-text"); if(st) st.textContent = "加密市場行情已連線";
    syncPlaceholder();
    renderOxLive();
    if (market === "crypto" && kick) { refreshMarketTickers(); if(state.activeView==="radar") loadSymbolCandles(true); if(state.activeView==="home") HomeMiniChart.ensureAndLoad(true); }
    if(toast) showMarketToast(`已切換至${labels[market]}`);
    try { AccountStore.capturePrefs(); } catch (e) {}
  };
  const syncPlaceholder = () => {
    const marketView = ["home","strength","radar"].includes(state.activeView);
    const nonCrypto = state.activeMarket !== "crypto" && marketView;
    const unsupported = false;
    document.body.classList.toggle("market-data-unavailable", unsupported);
    document.querySelectorAll("[data-app-view]").forEach(v => { if(["home","strength","radar"].includes(v.dataset.appView)) v.style.display = nonCrypto ? "none" : ""; });
    const card=document.getElementById("market-unavailable-card"); if(card) { card.hidden=!unsupported; if(unsupported){ const name=labels[state.activeMarket]; const title=card.querySelector("#market-unavailable-title"), copy=card.querySelector("#market-unavailable-copy"); if(title) title.textContent=`${name}市場`; if(copy) copy.textContent=`正在讀取${name}市場資料…`; } }
  };
  const cycle = () => { const order=["crypto"]; const i=order.indexOf(state.activeMarket); setMarket(order[(i+1)%order.length]); };
  const init=()=>{ state.activeMarket="crypto"; setMarket("crypto",{toast:false,kick:false}); };
  return {setMarket,syncPlaceholder,cycle,init,labels};
})();
window.OXMarketController = MarketController;

function showMarketToast(msg){ let el=document.getElementById("market-switch-toast"); if(!el){ el=document.createElement("div"); el.id="market-switch-toast"; el.className="market-switch-toast"; document.body.appendChild(el); } el.textContent=msg; el.classList.add("show"); clearTimeout(showMarketToast._t); showMarketToast._t=setTimeout(()=>el.classList.remove("show"),1500); }

const HomeChartVariant = (()=>{
  let chart=null, series=null, volumeSeries=null, period="1H", liveFeed=null, candles=[], request=0, ro=null;
  const theme=()=>document.body.classList.contains("theme-light");
  const chartColors=()=> theme() ? {
    bg:"rgba(255,255,255,0)", text:"#616d7c",
    grid:"rgba(65,72,68,.10)", cross:"rgba(65,72,68,.24)"
  } : {
    bg:"rgba(0,0,0,0)", text:"#a2a8a3",
    grid:"rgba(195,201,191,.085)", cross:"rgba(211,213,202,.22)"
  };

  const ensure=()=>{
    const el=document.getElementById("home-btc-mini-chart"); if(!el||chart) return !!chart;
    const c=chartColors();
    chart=LightweightCharts.createChart(el,{
      width:el.clientWidth||640,
      height:el.clientHeight||175,
      layout:{background:{type:"solid",color:c.bg},textColor:c.text,fontSize:9},
      grid:{vertLines:{color:c.grid},horzLines:{color:c.grid}},
      rightPriceScale:{
        visible:true,borderVisible:false,
        scaleMargins:{top:.08,bottom:.24},
        minimumWidth:52
      },
      timeScale:{
        visible:true,borderVisible:false,timeVisible:true,secondsVisible:false,
        rightOffset:1,fixRightEdge:false,barSpacing:window.matchMedia("(max-width:720px)").matches?4.15:5.8,minBarSpacing:window.matchMedia("(max-width:720px)").matches?2:2.6,lockVisibleTimeRangeOnResize:true
      },
      crosshair:{
        mode:LightweightCharts.CrosshairMode.Normal,
        vertLine:{color:c.cross,width:1,style:2,labelVisible:false},
        horzLine:{color:c.cross,width:1,style:2,labelVisible:false}
      },
      handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
      handleScale:{axisPressedMouseMove:false,mouseWheel:true,pinch:true}
    });
    series=chart.addCandlestickSeries({
      upColor:theme()?"#176ed0":"#00b8d4",downColor:theme()?"#d13c5b":"#ff3078",
      borderVisible:false,wickUpColor:theme()?"#176ed0":"#00b8d4",wickDownColor:theme()?"#d13c5b":"#ff3078",
      priceLineVisible:true,lastValueVisible:true
    });
    volumeSeries=chart.addHistogramSeries({
      priceFormat:{type:"volume"},
      priceScaleId:"",
      lastValueVisible:false,
      priceLineVisible:false
    });
    volumeSeries.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0}});
    ro=new ResizeObserver(()=>{
      if(el.clientWidth&&el.clientHeight) chart.applyOptions({width:el.clientWidth,height:el.clientHeight});
    });
    ro.observe(el);
    return true;
  };

  const applyThemeHome=()=>{
    if(!chart) return;
    const c=chartColors();
    const up=theme()?"#176ed0":"#00b8d4",down=theme()?"#d13c5b":"#ff3078";
    series?.applyOptions({upColor:up,downColor:down,wickUpColor:up,wickDownColor:down});
    chart.applyOptions({
      layout:{background:{type:"solid",color:c.bg},textColor:c.text,fontSize:9},
      grid:{vertLines:{color:c.grid},horzLines:{color:c.grid}},
      crosshair:{
        vertLine:{color:c.cross,width:1,style:2,labelVisible:false},
        horzLine:{color:c.cross,width:1,style:2,labelVisible:false}
      }
    });
  };

  const load=async(force=false)=>{
    if(state.activeMarket!=="crypto"||!ensure()) return;
    if(liveFeed && !force)return;
    const id=++request,selectedPeriod=period;
    liveFeed?.stop();candles=[];
    const feed=liveFeed=CryptoLiveCandles.subscribe("BTCUSDT",selectedPeriod,incoming=>{
      if(id!==request || state.activeMarket!=="crypto")return;
      candles=updateCryptoLiveSeries(series,volumeSeries,candles,incoming);
    });
    try{
      const data=await feed.load(200);
      if(id!==request || !data.length)return;
      candles=data;series.setData(data);
      volumeSeries?.setData(data.map(c=>({time:c.time,value:num(c.quoteVolume || c.volume),color:c.close>=c.open ? "rgba(0,184,212,.29)" : "rgba(255,48,120,.27)"})));
      const mobile=window.matchMedia("(max-width:720px)").matches;
      const compact=window.matchMedia("(max-width:430px)").matches;
      const visibleBars=compact?112:mobile?126:136,rightOffset=1;
      chart.timeScale().applyOptions({rightOffset,barSpacing:mobile?4.15:5.8,minBarSpacing:mobile?2:2.6,fixRightEdge:false,lockVisibleTimeRangeOnResize:true});
      chart.timeScale().setVisibleLogicalRange({from:Math.max(0,data.length-visibleBars),to:Math.max(0,data.length-1+rightOffset)});
    }catch(e){}
  };
  document.addEventListener('ox:marketchange',()=>{
    if(state.activeMarket!=="crypto"){request++;liveFeed?.stop();liveFeed=null;}
  });

  const setPeriod=p=>{
    if(!["1H","4H","1D","1W"].includes(p)) return;
    period=p;
    document.querySelectorAll("[data-home-mini-tf]").forEach(b=>b.classList.toggle("active",b.dataset.homeMiniTf===p));
    load(true);
  };

  document.addEventListener("ox:themechange",applyThemeHome);
  return {ensureAndLoad:load,setPeriod,applyTheme:applyThemeHome};
})();
const HomeMiniChart = HomeChartVariant;

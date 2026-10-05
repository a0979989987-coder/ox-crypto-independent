(() => {
  "use strict";
  const q=s=>document.querySelector(s);
  const compact=v=>{try{return new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:2}).format(Number(v)||0)}catch{return String(v||"—")}};
  const closeControl=()=>document.getElementById("ox-control-close")?.click();

  function flashTarget(selector){
    if(!selector)return;
    const el=document.querySelector(selector);
    if(!el)return;
    el.scrollIntoView({behavior:"smooth",block:"center"});
    el.classList.add("ox-feature-highlight");
    setTimeout(()=>el.classList.remove("ox-feature-highlight"),1550);
  }

  const glyphs={account:'<circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',theme:'<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>',market:'<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c5 5 5 11 0 16-5-5-5-11 0-16"/>',chart:'<path d="M4 4v16h16M7 14l4-5 4 3 5-7"/>',calendar:'<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4m8-4v4M4 10h16"/>',watch:'<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>',bubbles:'<circle cx="8" cy="10" r="5"/><circle cx="17" cy="15" r="4"/>'};
  const glyph=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(glyphs[name]||glyphs.chart)+'</svg>';
  const registryRows=[
    {id:"account",title:"帳號與登入",keywords:["帳號","登入","註冊","會員","account","login"],category:"OX Account",icon:glyph('account'),action:"account"},
    {id:"theme",title:"主題外觀",keywords:["主題","白金","深色","黑色","白色","淺色","自動","dark","light","theme"],category:"深色 · 白金 · 跟隨系統",icon:glyph('theme'),target:".theme-buttons",view:"settings"},
    {id:"patterns",title:"型態畫板",keywords:["型態","畫板","搜尋","掃描","patterns"],category:"目前市場 · 指標",icon:glyph('chart'),view:"strength",tool:"patterns"},
    {id:"bubbles",title:"泡泡圖",keywords:["泡泡","板塊","bubbles"],category:"目前市場 · 指標",icon:glyph('bubbles'),view:"strength",tool:"bubbles"},
    {id:"news",title:"行事曆與新聞",keywords:["新聞","資訊","行事曆","calendar","news"],category:"目前市場 · 資訊",icon:glyph('calendar'),view:"data"},
    {id:"crypto",title:"加密貨幣",keywords:["加密","crypto","幣"],category:"市場 · 雷達",icon:glyph('market'),view:"radar",market:"crypto"},
    {id:"notifications",title:"通知設定",keywords:["通知","提醒","notification","前高前低"],category:"設定",icon:glyph('settings'),target:"#notification-permission-state",view:"settings"},
    {id:"sound",title:"通知鈴聲",keywords:["鈴聲","聲音","sound","alert"],category:"設定",icon:glyph('settings'),target:"#btn-test-sound",view:"settings"},
    {id:"exchange",title:"交易所與資料源",keywords:["交易所","合約","bitget","binance","bybit","provider"],category:"加密 · 雷達",icon:glyph('market'),view:"radar",market:"crypto",action:"provider"},
    {id:"watch",title:"收藏與觀察列表",keywords:["收藏","觀察","watchlist","watch"],category:"目前市場 · 雷達",icon:glyph('watch'),view:"radar",action:"watch"}
  ];
  function findDeep(selector,root=document){const found=root.querySelector(selector);if(found)return found;for(const node of root.querySelectorAll('*')){if(node.shadowRoot){const found=findDeep(selector,node.shadowRoot);if(found)return found;}}return null;}
  async function waitTarget(selector){for(let i=0;i<40;i++){const node=findDeep(selector);if(node)return node;await new Promise(r=>setTimeout(r,50));}return null;}

  try{
    if(typeof OXFeatureRegistry!=="undefined"&&Array.isArray(OXFeatureRegistry)){
      OXFeatureRegistry.splice(0,OXFeatureRegistry.length,...registryRows);
    }
  }catch(e){}
  function registry(){
    try{return(typeof OXFeatureRegistry!=="undefined"&&Array.isArray(OXFeatureRegistry))?OXFeatureRegistry:registryRows}
    catch{return registryRows}
  }

  function insertFeatureSearch(){
    const main=q('.ox-control-view[data-control-view="main"]');
    if(!main||q("#ox-feature-search-v38"))return;
    const wrap=document.createElement("div");
    wrap.className="ox-feature-search-wrap";
    wrap.id="ox-feature-search-v38";
    wrap.innerHTML='<div class="ox-feature-search-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.4-3.4"></path></svg><input id="ox-feature-search-input-v38" type="search" autocomplete="off" placeholder="搜尋功能或工具…" aria-label="搜尋 OX 功能或工具"></div><div class="ox-feature-results" id="ox-feature-results-v38"></div>';
    main.insertBefore(wrap,main.firstChild);
    const input=q("#ox-feature-search-input-v38"),results=q("#ox-feature-results-v38");
    const render=()=>{
      const needle=String(input.value||"").trim().toLowerCase();
      const rows=registry().filter(x=>{
        if(!needle)return["patterns","bubbles","news","theme","account"].includes(x.id);
        return[x.title,x.category,...(x.keywords||[])].join(" ").toLowerCase().includes(needle);
      }).slice(0,9);
      results.innerHTML=rows.length?rows.map(x=>
        '<button type="button" class="ox-feature-result" data-feature-id="'+x.id+'"><span class="ox-feature-result-icon">'+x.icon+'</span><span class="ox-feature-result-copy"><b>'+x.title+'</b><small>'+x.category+'</small></span><span class="ox-feature-result-state'+(x.available===false?' unavailable':'')+'">'+'›'+'</span></button>'
      ).join(""):'<div class="ox-feature-empty">找不到符合的功能</div>';
      results.classList.add("show");input.setAttribute("aria-expanded","true");
    };
    input.setAttribute('aria-controls','ox-feature-results-v38');input.setAttribute('aria-expanded','false');
    results.setAttribute('aria-label','功能搜尋結果');
    input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();results.querySelector('button')?.focus();}else if(e.key==='Escape'&&results.classList.contains('show')){e.preventDefault();e.stopPropagation();results.classList.remove('show');input.setAttribute('aria-expanded','false');}});
    results.addEventListener('keydown',e=>{const buttons=[...results.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();input.focus();results.classList.remove('show');input.setAttribute('aria-expanded','false');}});
    input.addEventListener("input",render);
    input.addEventListener("focus",render);
    wrap.addEventListener("click",async e=>{
      const btn=e.target.closest("[data-feature-id]");if(!btn)return;
      const item=registry().find(x=>x.id===btn.dataset.featureId);if(!item)return;
      if(item.available===false){closeControl();setTimeout(()=>showToast(item.title+" 尚未開放"),180);return}
      if(item.action==="account"){q("#ox-control-account-open")?.click();return}
      closeControl();
      setTimeout(async()=>{
        if(item.market)window.OXMarketController?.setMarket(item.market,{toast:false});
        if(item.view&&typeof switchAppView==="function")switchAppView(item.view);
        await new Promise(r=>setTimeout(r,110));
        if(item.action==="provider"){ProviderController.openPicker();return}
        if(item.tool){
          const market=document.body.dataset.market||'crypto';
          const attr='data-crypto-tool';
          const target=await waitTarget(`button[${attr}="${item.tool}"]`);target?.click();
        }
        if(item.action==='watch'){
          const market=document.body.dataset.market||'crypto';
          const selector='.tab-btn[data-tab="watch"]';
          (await waitTarget(selector))?.click();
        }
        if(item.action==="feedback"){
          document.getElementById("ox-control-open")?.click();
          setTimeout(()=>document.getElementById("ox-control-feedback-open")?.click(),120);
          return;
        }
        flashTarget(item.target);
      },190);
    });
    document.addEventListener("click",e=>{if(!wrap.contains(e.target)){results.classList.remove("show");input.setAttribute("aria-expanded","false");}});
  }

  const OXChartDataAdapters={
    bitget:{
      id:"bitget",name:"Bitget",contractType:"USDT Perpetual",
      async ticker(symbol){
        const r=await fetch("https://api.bitget.com/api/v2/mix/market/ticker?symbol="+encodeURIComponent(symbol)+"&productType=USDT-FUTURES",{cache:"no-store"});
        const j=await r.json(),d=Array.isArray(j.data)?j.data[0]:null;
        if(j.code!=="00000"||!d)throw new Error("Bitget unavailable");
        return{price:+d.lastPr,change24h:+d.change24h,quoteVolume:+(d.usdtVolume||0),baseVolume:+(d.baseVolume||0)};
      },
      async candles(symbol,period,limit=160,endTime=null){
        let url="https://api.bitget.com/api/v2/mix/market/candles?symbol="+encodeURIComponent(symbol)+"&productType=USDT-FUTURES&granularity="+encodeURIComponent(period)+"&limit="+limit;
        if(endTime)url+="&endTime="+endTime;
        const r=await fetch(url,{cache:"no-store"}),j=await r.json();
        if(j.code!=="00000"||!Array.isArray(j.data)||!j.data.length)throw new Error("Bitget candles unavailable");
        return j.data.map(d=>({time:Math.floor(+d[0]/1000),open:+d[1],high:+d[2],low:+d[3],close:+d[4],volume:+d[5],quoteVolume:+(d[6]||0)})).filter(x=>Number.isFinite(x.open)&&x.open>0).sort((a,b)=>a.time-b.time);
      }
    },
    binance:{
      id:"binance",name:"Binance",contractType:"USDT Perpetual",
      map:{"1m":"1m","5m":"5m","15m":"15m","1H":"1h","4H":"4h","1D":"1d","1W":"1w"},
      async ticker(symbol){
        const r=await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr?symbol="+encodeURIComponent(symbol),{cache:"no-store"});
        if(!r.ok)throw new Error("Binance unavailable");
        const d=await r.json();
        if(!d||!d.symbol||!Number.isFinite(+d.lastPrice))throw new Error("Binance ticker unavailable");
        return{price:+d.lastPrice,change24h:+d.priceChangePercent/100,quoteVolume:+d.quoteVolume,baseVolume:+d.volume};
      },
      async candles(symbol,period,limit=160,endTime=null){
        const iv=this.map[period];if(!iv)throw new Error("Unsupported timeframe");
        let url="https://fapi.binance.com/fapi/v1/klines?symbol="+encodeURIComponent(symbol)+"&interval="+iv+"&limit="+limit;
        if(endTime)url+="&endTime="+endTime;
        const r=await fetch(url,{cache:"no-store"});if(!r.ok)throw new Error("Binance candles unavailable");
        const a=await r.json();if(!Array.isArray(a)||!a.length)throw new Error("Binance candles unavailable");
        return a.map(d=>({time:Math.floor(+d[0]/1000),open:+d[1],high:+d[2],low:+d[3],close:+d[4],volume:+d[5],quoteVolume:+(d[7]||0)})).filter(x=>Number.isFinite(x.open)&&x.open>0).sort((a,b)=>a.time-b.time);
      }
    },
    bybit:{
      id:"bybit",name:"Bybit",contractType:"USDT Perpetual",
      map:{"1m":"1","5m":"5","15m":"15","1H":"60","4H":"240","1D":"D","1W":"W"},
      async ticker(symbol){
        const r=await fetch("https://api.bybit.com/v5/market/tickers?category=linear&symbol="+encodeURIComponent(symbol),{cache:"no-store"});
        if(!r.ok)throw new Error("Bybit unavailable");
        const j=await r.json(),d=j?.result?.list?.[0];
        if(j?.retCode!==0||!d||!Number.isFinite(+d.lastPrice))throw new Error("Bybit ticker unavailable");
        return{price:+d.lastPrice,change24h:+d.price24hPcnt,quoteVolume:+d.turnover24h,baseVolume:+d.volume24h};
      },
      async candles(symbol,period,limit=160,endTime=null){
        const iv=this.map[period];if(!iv)throw new Error("Unsupported timeframe");
        let url="https://api.bybit.com/v5/market/kline?category=linear&symbol="+encodeURIComponent(symbol)+"&interval="+iv+"&limit="+limit;
        if(endTime)url+="&end="+endTime;
        const r=await fetch(url,{cache:"no-store"});if(!r.ok)throw new Error("Bybit candles unavailable");
        const j=await r.json(),a=j?.result?.list;
        if(j?.retCode!==0||!Array.isArray(a)||!a.length)throw new Error("Bybit candles unavailable");
        return a.map(d=>({time:Math.floor(+d[0]/1000),open:+d[1],high:+d[2],low:+d[3],close:+d[4],volume:+d[5],quoteVolume:+(d[6]||0)})).filter(x=>Number.isFinite(x.open)&&x.open>0).sort((a,b)=>a.time-b.time);
      }
    }
  };
  window.OXChartDataAdapters=OXChartDataAdapters;

  const originalLoadSymbolCandles=typeof loadSymbolCandles==="function"?loadSymbolCandles:null;
  const originalLoadMoreHistoricalCandles=typeof loadMoreHistoricalCandles==="function"?loadMoreHistoricalCandles:null;
  const originalRefreshKeyLevels=typeof refreshKeyLevels==="function"?refreshKeyLevels:null;
  const originalUpdateHeaderHUD=typeof updateHeaderHUD==="function"?updateHeaderHUD:null;

  const ProviderController={
    active:(localStorage.getItem("ox-chart-data-provider")||"bitget").toLowerCase(),
    ticker:null,timer:0,requestId:0,tickerClickTimer:0,lastTickerClick:0,lastExternalOpen:0,
    adapter(){return OXChartDataAdapters[this.active]||OXChartDataAdapters.bitget},
    label(){return this.adapter().name},
    openContract(){
      // Contract web URLs do not guarantee an app handoff. An exchange's
      // verified native deep-link format is required before navigation.
      this.lastExternalOpen=performance.now();
      let notice=q("#ox-contract-app-status");
      if(!notice){
        notice=document.createElement("div");
        notice.id="ox-contract-app-status";
        notice.className="ox-contract-app-status";
        notice.setAttribute("role","status");
        document.body.append(notice);
      }
      notice.textContent=`${this.label()} · ${state.symbol} 尚無可用的 App 合約連結`;
      const card=q("#ticker-pair")?.closest(".market-line-card")?.getBoundingClientRect();
      notice.style.top=`${Math.min((card?.bottom||80)+8,window.innerHeight-64)}px`;
      notice.classList.add("show");
      clearTimeout(this.contractNoticeTimer);
      this.contractNoticeTimer=setTimeout(()=>notice.classList.remove("show"),3600);
    },
    onTickerClick(){
      const now=performance.now();
      if(this.tickerClickTimer && now-this.lastTickerClick<=360){
        clearTimeout(this.tickerClickTimer);this.tickerClickTimer=0;this.lastTickerClick=0;
        this.closePicker();this.openContract();return;
      }
      clearTimeout(this.tickerClickTimer);
      this.lastTickerClick=now;
      this.tickerClickTimer=setTimeout(()=>{
        this.tickerClickTimer=0;this.lastTickerClick=0;this.openPicker();
      },360);
    },
    applyLabels(){
      const p=this.adapter(),pair=q("#ticker-pair");
      if(pair){
        pair.textContent=state.symbol+" · "+p.name;
        pair.setAttribute("aria-label",`${state.symbol} · ${p.name}；單點切換交易所`);
        pair.title="單點切換交易所";
      }
      const trigger=q("#chart-provider-trigger");
      if(trigger)trigger.textContent=state.symbol+" · "+p.name+" 永續合約";
    },
    applyTicker(t){
      if(!t)return;this.ticker=t;
      updateRadarMarketGlow();
      const price=q("#price"),chg=q("#change"),quote=q("#quote"),meta=q("#ticker-meta"),rank=q("#quote-rank");
      if(price)price.textContent=fmtPrice(t.price);
      if(chg){chg.textContent=fmtPct(t.change24h);chg.classList.toggle("positive",t.change24h>=0);chg.classList.toggle("negative",t.change24h<0)}
      if(quote)quote.textContent=Number.isFinite(t.quoteVolume)?compact(t.quoteVolume)+" USDT":"—";
      if(meta)meta.textContent=this.label()+" · "+this.adapter().contractType;
      if(rank&&this.active!=="bitget")rank.textContent="目前 Data Provider";
      this.applyLabels();
    },
    async refreshTicker({quiet=false}={}){
      const id=++this.requestId;
      try{
        const t=await this.adapter().ticker(state.symbol);
        if(id!==this.requestId)return null;
        this.applyTicker(t);return t;
      }catch(e){if(!quiet)showToast(this.label()+" 行情目前 unavailable");return null}
    },
    restartTicker(){
      clearInterval(this.timer);this.timer=0;
      this.refreshTicker({quiet:true});
      this.timer=setInterval(()=>{if(state.activeView==="radar")this.refreshTicker({quiet:true})},6000);
    },
    async select(id){
      id=String(id||"").toLowerCase();
      const ad=OXChartDataAdapters[id];if(!ad)return;
      const picker=q("#ox-provider-picker"),option=picker?.querySelector('[data-provider-id="'+id+'"]');
      option?.classList.add("is-selecting");
      const started=performance.now();
      try{await ad.ticker(state.symbol)}catch(e){option?.classList.remove("is-selecting");showToast(ad.name+" 此標的目前 unavailable");return}
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,240-(performance.now()-started))));
      this.active=id;
      localStorage.setItem("ox-chart-data-provider",id);
      this.closePicker();
      this.applyLabels();
      state.currentLevels={high:0,low:0,sourcePeriod:getKeyLevelPeriod(),highTime:0,lowTime:0};
      state.secondaryLevels=null;
      await loadSymbolCandles(true);
      await this.refreshTicker({quiet:false});
      this.restartTicker();
      showToast("已切換至 "+ad.name+" · "+state.symbol);
    },
    ensureTitleTrigger(){
      const head=q("#chart-head-title");if(!head)return;
      const pair=q("#ticker-pair");
      if(pair&&!pair.dataset.providerBound){
        pair.dataset.providerBound="true";
        pair.setAttribute("role","button");pair.tabIndex=0;
        pair.addEventListener("click",()=>this.onTickerClick());
        pair.addEventListener("dblclick",event=>{
          event.preventDefault();
          if(performance.now()-this.lastExternalOpen<600)return;
          clearTimeout(this.tickerClickTimer);this.tickerClickTimer=0;this.lastTickerClick=0;
          this.closePicker();this.openContract();
        });
        pair.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();this.openPicker()}});
      }
      let trigger=q("#chart-provider-trigger");
      if(!trigger){
        const first=head.querySelector("span:first-child");if(!first)return;
        trigger=document.createElement("button");
        trigger.type="button";trigger.id="chart-provider-trigger";trigger.setAttribute("aria-label","切換交易所與合約資料源");
        first.replaceWith(trigger);
        trigger.addEventListener("click",()=>this.openPicker());
      }
      this.applyLabels();
    },
    ensurePicker(){
      if(q("#ox-provider-picker"))return;
      const backdrop=document.createElement("div");
      backdrop.className="ox-provider-backdrop";backdrop.id="ox-provider-backdrop";
      const picker=document.createElement("div");
      picker.className="ox-provider-picker";picker.id="ox-provider-picker";
      picker.setAttribute("role","group");picker.setAttribute("aria-label","選擇交易所");
      picker.innerHTML='<div class="ox-provider-list" id="ox-provider-list"><div class="ox-provider-loading">正在確認交易所…</div></div>';
      document.body.append(backdrop,picker);
      backdrop.addEventListener("click",()=>this.closePicker());
      picker.addEventListener("click",e=>{const b=e.target.closest("[data-provider-id]");if(b&&!b.disabled)this.select(b.dataset.providerId)});
    },
    positionPicker(){
      const picker=q("#ox-provider-picker"),trigger=q("#ticker-pair")||q("#chart-provider-trigger");
      if(!picker||!trigger)return;
      const r=trigger.getBoundingClientRect(),card=trigger.closest(".market-line-card")?.getBoundingClientRect();
      const width=Math.min(232,window.innerWidth-24),left=Math.max(12,Math.min(window.innerWidth-width-12,r.left));
      picker.style.left=left+"px";picker.style.top=((card?.bottom||r.bottom)+6)+"px";
    },
    async openPicker(){
      q("#ox-contract-app-status")?.classList.remove("show");
      this.ensurePicker();this.ensureTitleTrigger();
      const picker=q("#ox-provider-picker"),backdrop=q("#ox-provider-backdrop"),list=q("#ox-provider-list");
      if(!picker||!list)return;
      this.positionPicker();picker.classList.add("show");
      backdrop.classList.add("show");
      q("#ticker-pair")?.setAttribute("aria-expanded","true");
      list.innerHTML='<div class="ox-provider-loading">正在讀取交易所…</div>';
      const ids=["bitget","binance","bybit"];
      const checks=await Promise.all(ids.map(async id=>{
        const ad=OXChartDataAdapters[id];
        try{return{id,ok:true,t:await ad.ticker(state.symbol)}}catch(e){return{id,ok:false,t:null}}
      }));
      if(!picker.classList.contains("show"))return;
      list.innerHTML=checks.map(x=>{
        const ad=OXChartDataAdapters[x.id];
        return '<button type="button" class="ox-provider-option'+(this.active===x.id?' active':'')+'" data-provider-id="'+x.id+'" aria-pressed="'+(this.active===x.id)+'" '+(!x.ok?'disabled title="此幣種目前無可用資料"':'')+'><span class="ox-provider-name">'+ad.name+'</span></button>';
      }).join("");
    },
    closePicker(){
      q("#ox-provider-picker")?.classList.remove("show");
      q("#ox-provider-backdrop")?.classList.remove("show");
      q("#ticker-pair")?.setAttribute("aria-expanded","false");
    },
    boot(){
      this.ensureTitleTrigger();
      this.ensurePicker();
      this.restartTicker();
      window.addEventListener("resize",()=>this.positionPicker(),{passive:true});
    }
  };
  window.OXProviderController=ProviderController;

  if(originalLoadSymbolCandles){
    loadSymbolCandles=async function(isInitial=true){
      if(ProviderController.active==="bitget")return originalLoadSymbolCandles(isInitial);
      if(state.activeMarket&&state.activeMarket!=="crypto")return;
      state.abortCtrl?.abort();state.abortCtrl=new AbortController();
      const symbol=state.symbol,period=state.period,provider=ProviderController.active;
      const adapter=ProviderController.adapter();
      const feed=startChartLiveCandles(symbol,period,{websocket:false,fetchCandles:(...args)=>adapter.candles(...args)});
      const overlay=q("#chart-loading");if(isInitial)overlay?.classList.add("show");
      try{
        const raw=await feed.load(window.matchMedia("(max-width:720px)").matches?160:100);
        if(state.chartLiveFeed!==feed || state.symbol!==symbol || state.period!==period || ProviderController.active!==provider)return;
        if(!raw.length)throw new Error("無可用 K 線");
        state.candleData=raw;state.oldestCandleTime=raw[0].time;state.hasMoreHistory=true;
        renderChartData(raw,isInitial);
        await ProviderController.refreshTicker({quiet:true});
      }catch(e){showToast(ProviderController.label()+" K 線 unavailable")}
      finally{overlay?.classList.remove("show")}
    };
  }

  if(originalLoadMoreHistoricalCandles){
    loadMoreHistoricalCandles=async function(){
      if(ProviderController.active==="bitget")return originalLoadMoreHistoricalCandles();
      if(state.isLoadingOlder||!state.hasMoreHistory)return;
      state.isLoadingOlder=true;
      const overlay=q("#chart-loading");overlay?.classList.add("show");
      try{
        const older=await ProviderController.adapter().candles(state.symbol,state.period,100,(state.oldestCandleTime-1)*1000);
        if(!older.length){state.hasMoreHistory=false;return}
        state.oldestCandleTime=older[0].time;
        const combined=[...older,...state.candleData].filter((c,i,a)=>!i||c.time!==a[i-1].time);
        state.candleData=combined;renderChartData(combined,false);
      }catch(e){state.hasMoreHistory=false}
      finally{state.isLoadingOlder=false;overlay?.classList.remove("show")}
    };
  }

  if(originalRefreshKeyLevels){
    refreshKeyLevels=async function(chartCandles){
      if(ProviderController.active==="bitget")return originalRefreshKeyLevels(chartCandles);
      if(!state.candleSeries)return;
      const symbolAtRequest=state.symbol,sourcePeriods=getKeyLevelPeriods();
      clearKeyLevelPriceLines();
      state.currentLevels={high:0,low:0,sourcePeriod:sourcePeriods[0],highTime:0,lowTime:0};
      state.secondaryLevels=null;
      updateAlertButtons();updateQuickStats();
      try{
        const results=[];
        for(const sourcePeriod of sourcePeriods){
          const sourceCandles=state.period===sourcePeriod?chartCandles:await ProviderController.adapter().candles(symbolAtRequest,sourcePeriod,100);
          if(state.symbol!==symbolAtRequest||!getKeyLevelPeriods().includes(sourcePeriod))return;
          results.push({sourcePeriod,levels:findStructuralPivotLevels(sourceCandles,sourcePeriod)});
        }
        const primary=results[0];
        state.currentLevels={...primary.levels,sourcePeriod:primary.sourcePeriod};
        if(results[1])state.secondaryLevels={...results[1].levels,sourcePeriod:results[1].sourcePeriod};
        renderKeyLevelPriceLinesFromState();updateAlertButtons();updateQuickStats();renderOxDetail();requestAnimationFrame(updateKeyLevelVisualLabels);
      }catch(e){console.warn("Provider key levels unavailable",ProviderController.active,e)}
    };
  }

  if(originalUpdateHeaderHUD){
    updateHeaderHUD=function(...args){
      const r=originalUpdateHeaderHUD.apply(this,args);
      ProviderController.ensureTitleTrigger();
      ProviderController.applyLabels();
      if(ProviderController.active!=="bitget"){
        if(ProviderController.ticker) ProviderController.applyTicker(ProviderController.ticker);
        ProviderController.refreshTicker({quiet:true});
      }
      return r;
    };
  }

  function boot(){
    insertFeatureSearch();
    ProviderController.boot();
    const observer=new MutationObserver(()=>{insertFeatureSearch();ProviderController.ensureTitleTrigger()});
    const control=q("#ox-control-panel");
    if(control)observer.observe(control,{childList:true,subtree:true});
    document.addEventListener("ox:viewchange",()=>{
      if(state.activeView==="radar"){
        ProviderController.ensureTitleTrigger();
        ProviderController.refreshTicker({quiet:true});
      }
    });
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
})();

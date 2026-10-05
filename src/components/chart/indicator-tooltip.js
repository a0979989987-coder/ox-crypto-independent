(() => {
  "use strict";
  function signalAt(time){
    const candles=state?.candleData||[];
    const i=candles.findIndex(c=>c.time===time);
    if(i<20||i>=candles.length-1)return null;
    const c=candles[i],prev20=candles.slice(i-20,i);
    const prevHigh=Math.max(...prev20.map(x=>x.high));
    const prevLow=Math.min(...prev20.map(x=>x.low));
    const avgVol=prev20.reduce((s,x)=>s+x.volume,0)/prev20.length||1;
    const ratio=c.volume/avgVol;
    if(c.close>prevHigh&&ratio>=1.45)return{icon:"▲",label:"放量突破",tone:"up"};
    if(c.close<prevLow&&ratio>=1.45)return{icon:"▼",label:"放量下跌",tone:"down"};
    return null;
  }
  function ensureTip(){
    const chartEl=document.getElementById("chart"); if(!chartEl)return null;
    let tip=document.getElementById("ox-indicator-tooltip");
    if(!tip){tip=document.createElement("div");tip.id="ox-indicator-tooltip";tip.className="ox-indicator-tooltip";chartEl.appendChild(tip);}
    return tip;
  }
  function showTip(param,info,sticky=false){
    const tip=ensureTip(),chartEl=document.getElementById("chart");
    if(!tip||!chartEl||!info||!param?.point)return;
    tip.className=`ox-indicator-tooltip is-${info.tone} show`;tip.textContent=`${info.icon} ${info.label}`;
    const x=Math.max(8,Math.min(chartEl.clientWidth-126,param.point.x+10));
    const y=Math.max(8,Math.min(chartEl.clientHeight-34,param.point.y-30));
    tip.style.transform=`translate3d(${x}px,${y}px,0)`;
    if(sticky){clearTimeout(showTip._timer);showTip._timer=setTimeout(()=>tip.classList.remove("show"),1450);}
  }
  function hideTip(){document.getElementById("ox-indicator-tooltip")?.classList.remove("show")}
  function bind(){
    if(!state?.chart||state.chart.__oxIndicatorTooltipBound)return;
    state.chart.__oxIndicatorTooltipBound=true;
    state.chart.subscribeCrosshairMove(param=>{
      if(window.matchMedia("(hover:hover) and (pointer:fine)").matches){
        const info=param?.time?signalAt(param.time):null; if(info)showTip(param,info,false);else hideTip();
      }
    });
    state.chart.subscribeClick(param=>{
      if(!window.matchMedia("(max-width:720px)").matches)return;
      const info=param?.time?signalAt(param.time):null;if(info)showTip(param,info,true);
    });
  }
  document.addEventListener("DOMContentLoaded",()=>setTimeout(bind,40),{once:true});
})();

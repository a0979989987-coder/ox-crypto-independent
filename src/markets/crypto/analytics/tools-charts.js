import { compact, signed } from './flow-model.js';
export function partition(items,rect,value) {
 if(!items.length)return [];if(items.length===1)return [{...items[0],rect}];
 const weights=items.map(value),total=weights.reduce((s,v)=>s+v,0);let part=weights[0],split=1;
 while(split<items.length-1 && Math.abs(part+weights[split]-total/2)<Math.abs(part-total/2)){part+=weights[split++];}
 const ratio=part/total,[x,y,w,h]=rect;
 return w>=h ? [...partition(items.slice(0,split),[x,y,w*ratio,h],value),...partition(items.slice(split),[x+w*ratio,y,w*(1-ratio),h],value)] : [...partition(items.slice(0,split),[x,y,w,h*ratio],value),...partition(items.slice(split),[x,y+h*ratio,w,h*(1-ratio)],value)];
}
const volumeLabel=v=>Math.abs(v)>=1000?compact(v):Number(v.toPrecision(3)).toString();
const timeLabel=t=>new Date(t).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false});
export function createToolChart(canvas,{onSelect=()=>{},signal,heatColors=['116,174,147','188,114,123']}={}) {
 const ctx=canvas.getContext('2d'),life=new AbortController();let current={type:'empty'},hits=[],raf=0,w=0,h=0,scale=1,panX=0,panY=0,suppressClickUntil=0;
 const pointers=new Map();let gesture=null,movement=0;
 const clampPan=()=>{panX=Math.max(w*(1-scale),Math.min(0,panX));panY=Math.max(h*(1-scale),Math.min(0,panY));};
 const position=e=>{const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
 function zoomAt(next,x=w/2,y=h/2){next=Math.max(1,Math.min(20,next));const ratio=next/scale;panX=x-(x-panX)*ratio;panY=y-(y-panY)*ratio;scale=next;canvas.dataset.zoom=String(scale);clampPan();schedule();}
 function seedGesture(){const ps=[...pointers.values()];gesture=ps.length>=2?{x:(ps[0].x+ps[1].x)/2,y:(ps[0].y+ps[1].y)/2,d:Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y)}:ps.length?{...ps[0]}:null;}
 const text=(s,x,y,{align='left',size=11,color='#a4b0b4'}={})=>{ctx.font=`${size}px Inter,-apple-system,"Noto Sans CJK TC",sans-serif`;ctx.fillStyle=document.body.classList.contains('theme-light')?(color==='#a4b0b4'?'#616d7c':['#eee','#cdd2ce','#d4d8d1','#c6cbc5','#b2babd'].includes(color)?'#374151':['#f2b0b8','#cd9399'].includes(color)?'#d13c5b':['#b8ebcb','#91c7b1'].includes(color)?'#168366':color==='#ddd7bf'?'#8d712e':color):color;ctx.textAlign=align;ctx.fillText(String(s),x,y);};
 const line=(x1,y1,x2,y2,color='#2a373e')=>{ctx.strokeStyle=document.body.classList.contains('theme-light')&&['#2a373e','#202c32'].includes(color)?'#d7dee7':document.body.classList.contains('theme-light')&&color==='#ddd7bf'?'#8d712e':color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();};
 function draw(){raf=0;if(!w||!h)return;const d=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);hits=[];
  const {type}=current;
  if(type==='heatmap'){
   ctx.translate(panX,panY);
   const value=r=>current.weight==='cap'?r.cap:current.weight==='equal'?1:r.volume;
   const valid=current.rows.filter(r=>value(r)>0).sort((a,b)=>value(b)-value(a));
   let tiles=[];
   if(current.grouped){const groups=[...new Set(valid.map(r=>r.sector))].map(sector=>({sector,rows:valid.filter(r=>r.sector===sector)}));for(const g of partition(groups,[0,0,w*scale,h*scale],g=>g.rows.reduce((s,r)=>s+value(r),0))){const [x,y,ww,hh]=g.rect;ctx.fillStyle=document.body.classList.contains('theme-light')?'#f1f4f7':'#202c31';ctx.fillRect(x+1,y+1,ww-2,hh-2);if(ww>70&&hh>45)text(g.sector,x+9,y+18,{size:11,color:'#cdd2ce'});tiles.push(...partition(g.rows,[x+2,y+25,Math.max(0,ww-4),Math.max(0,hh-27)],value));}}
   else tiles=partition(valid,[0,0,w*scale,h*scale],value);
   for(const r of tiles){const [x,y,ww,hh]=r.rect;if(ww<2||hh<2)continue;const intensity=Math.min(.68,.18+Math.abs(r.returnPct)/10);ctx.fillStyle=`rgba(${heatColors[r.returnPct>=0?0:1]},${intensity})`;ctx.fillRect(x+1,y+1,ww-2,hh-2);if(current.selected===r.symbol){ctx.strokeStyle=document.body.classList.contains('theme-light')?'#8d712e':'#eeeadd';ctx.strokeRect(x+2,y+2,ww-4,hh-4);}const cx=x+ww/2,cy=y+hh/2;
    if(ww>48&&hh>25){text(r.base,cx,cy-(hh>65?12:0),{align:'center',size:Math.min(27,Math.max(12,ww/10)),color:'#eee'});if(hh>45)text(signed(r.returnPct,2)+'%',cx,cy+(hh>65?9:16),{align:'center',size:12,color:'#eee'});if(hh>95&&ww>85)text(r.price.toLocaleString('en-US',{maximumFractionDigits:r.price<1?5:2}),cx,cy+30,{align:'center',size:11});}
    hits.push({x,y,w:ww,h:hh,value:r.symbol});
   }
  } else if(type==='cvd'){
   const f=current.flow,pts=f.cvd;if(!pts.length)return;const l=58,r=w-23,top=28,bottom=h-35;const middle=top+(bottom-top)*.52;
   function series(key,y0,y1,color,title){const vals=pts.map(p=>p[key]);let lo=Math.min(...vals),hi=Math.max(...vals);if(lo===hi){lo-=1;hi+=1;}const yy=v=>y1-(v-lo)/(hi-lo)*(y1-y0),xx=t=>l+(t-f.from)/Math.max(1,f.to-f.from)*(r-l);for(let i=0;i<4;i++){const v=lo+(hi-lo)*i/3;line(l,yy(v),r,yy(v));text(key==='price'?v.toFixed(1):(v<0?'-':'')+volumeLabel(Math.abs(v)),l-7,yy(v)+4,{align:'right'});}text(title,l,y0-10,{color});ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(xx(p.ts),yy(p[key])):ctx.moveTo(xx(p.ts),yy(p[key])));ctx.strokeStyle=document.body.classList.contains('theme-light')?(key==='price'?'#616d7c':'#168366'):color;ctx.lineWidth=1.5;ctx.stroke();}
   series('price',top+18,middle-18,'#c6cbc5','價格 · USDT');series('value',middle+42,bottom,'#91c7b1','CVD · '+current.base+' · 起點歸零');text(timeLabel(f.from),l,h-12);text(timeLabel(f.to),r,h-12,{align:'right'});
  } else if(type==='profile'){
   const levels=current.flow.profile;if(!levels.length)return;const max=Math.max(...levels.map(l=>l.total)),left=70,right=w-70,top=32,hh=(h-60)/levels.length;const poc=levels.reduce((a,l)=>l.total>a.total?l:a,levels[0]);text('價格 · USDT',8,16);text('Bid / Ask · '+current.base,w-10,16,{align:'right'});
   levels.forEach((p,i)=>{const y=top+i*hh,bar=(right-left)*p.total/max;if(hh>=13||i%Math.ceil(14/hh)===0)text(p.price.toFixed(current.decimals),left-8,y+hh*.7,{align:'right'});ctx.fillStyle='#765b66';ctx.fillRect(left,y+1,bar*p.bid/p.total,Math.max(1,hh-2));ctx.fillStyle='#568d78';ctx.fillRect(left+bar*p.bid/p.total,y+1,bar*p.ask/p.total,Math.max(1,hh-2));if(p===poc){line(left,y+hh/2,right+20,y+hh/2,'#ddd7bf');text('POC',right+27,y+hh/2+4,{color:'#ddd7bf'});}});
  } else if(type==='footprint'){
   const bars=current.flow.bars.slice(-current.count);if(!bars.length)return;const prices=bars.flatMap(b=>b.levels.map(l=>l.price)),hi=Math.max(...prices),lo=Math.min(...prices),step=current.step;const n=Math.round((hi-lo)/step)+1;const top=42,bottom=h-60,left=66,cw=(w-left-12)/bars.length,rh=(bottom-top)/Math.max(1,n);text('價格 · USDT',6,17);text('Bid × Ask · '+current.base,w-12,17,{align:'right'});
   const max=Math.max(...bars.flatMap(b=>b.levels.map(l=>l.total)));for(let i=0;i<n;i++){const p=hi-i*step,y=top+i*rh;if(rh>12||i%Math.ceil(14/rh)===0)text(p.toFixed(current.decimals),left-7,y+rh*.7,{align:'right',size:10});line(left,y,w-10,y,'#202c32');}
   bars.forEach((b,j)=>{const x=left+j*cw;line(x,top,x,bottom);text(timeLabel(b.time)+(b.partial?'*':''),x+cw/2,32,{align:'center',color:'#d4d8d1'});const candleY=p=>top+(hi+step-p)/step*rh;const candleColor=document.body.classList.contains('theme-light')?(b.close>=b.open?'#4598df':'#e86480'):(b.close>=b.open?'#a1c9b6':'#d5a0aa');line(x+8,candleY(b.high),x+8,candleY(b.low),candleColor);ctx.fillStyle=candleColor;ctx.fillRect(x+5,Math.min(candleY(b.open),candleY(b.close)),6,Math.max(1,Math.abs(candleY(b.open)-candleY(b.close))));for(const l of b.levels){const y=top+(hi-l.price)/step*rh;ctx.fillStyle=l.delta>=0?`rgba(97,166,134,${.08+.55*l.total/max})`:`rgba(184,105,122,${.08+.55*l.total/max})`;ctx.fillRect(x+15,y+1,cw-20,Math.max(1,rh-2));if(rh>=13&&cw>=85){text(volumeLabel(l.bid),x+cw/2,y+rh*.7,{align:'right',size:10,color:l.sellImbalance?'#f2b0b8':'#b2babd'});text(volumeLabel(l.ask),x+cw/2+8,y+rh*.7,{size:10,color:l.buyImbalance?'#b8ebcb':'#b2babd'});}if(l.price===b.poc){ctx.strokeStyle='#ded8bc88';ctx.strokeRect(x+15,y+1,cw-20,Math.max(1,rh-2));}}
    text('Δ '+signed(b.delta,2),x+cw/2,bottom+21,{align:'center',size:11,color:b.delta>=0?'#91c7b1':'#cd9399'});text('V '+volumeLabel(b.total),x+cw/2,bottom+40,{align:'center',size:10});hits.push({x,y:top,w:cw,h:bottom-top,value:b.time});});
  }
 }
 const schedule=()=>{if(!raf)raf=requestAnimationFrame(draw);};const observer=new ResizeObserver(e=>{const nw=e[0].contentRect.width,nh=e[0].contentRect.height;panX=w?panX*nw/w:0;panY=h?panY*nh/h:0;w=nw;h=nh;clampPan();schedule();});observer.observe(canvas);
 canvas.addEventListener('wheel',e=>{if(current.type!=='heatmap')return;e.preventDefault();const p=position(e);zoomAt(scale*Math.exp(-e.deltaY*.002),p.x,p.y);},{signal:life.signal,passive:false});
 canvas.addEventListener('pointerdown',e=>{if(current.type!=='heatmap'||e.button>0)return;if(!pointers.size)movement=0;pointers.set(e.pointerId,position(e));canvas.setPointerCapture(e.pointerId);if(pointers.size>1)suppressClickUntil=Date.now()+600;seedGesture();},{signal:life.signal});
 canvas.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;const p=position(e),prev=pointers.get(e.pointerId);pointers.set(e.pointerId,p);movement+=Math.hypot(p.x-prev.x,p.y-prev.y);if(movement>4)suppressClickUntil=Date.now()+600;if(Math.hypot(p.x-prev.x,p.y-prev.y)<.1)return;const ps=[...pointers.values()];if(ps.length>=2){const x=(ps[0].x+ps[1].x)/2,y=(ps[0].y+ps[1].y)/2,d=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);if(gesture?.d>0){zoomAt(scale*d/gesture.d,gesture.x,gesture.y);panX+=x-gesture.x;panY+=y-gesture.y;clampPan();schedule();}suppressClickUntil=Date.now()+600;}else if(scale>1){panX+=p.x-prev.x;panY+=p.y-prev.y;clampPan();schedule();if(Math.hypot(p.x-gesture.x,p.y-gesture.y)>4)suppressClickUntil=Date.now()+600;}seedGesture();},{signal:life.signal});
 const end=e=>{if(!pointers.delete(e.pointerId))return;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);seedGesture();};
 for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,end,{signal:life.signal});
 canvas.addEventListener('click',e=>{if(Date.now()<suppressClickUntil)return;const r=canvas.getBoundingClientRect(),x=e.clientX-r.left-(current.type==='heatmap'?panX:0),y=e.clientY-r.top-(current.type==='heatmap'?panY:0);const hit=hits.find(p=>x>=p.x&&x<=p.x+p.w&&y>=p.y&&y<=p.y+p.h);if(hit)onSelect(hit.value);},{signal:life.signal});
 document.addEventListener('ox:themechange',schedule,{signal:life.signal});
 const destroy=()=>{life.abort();observer.disconnect();cancelAnimationFrame(raf);pointers.clear();};
 signal?.addEventListener('abort',destroy,{once:true});
 return {update(options){if(options.type!==current.type){scale=1;panX=panY=0;}current=options;canvas.style.touchAction=options.type==='heatmap'?'none':'';canvas.dataset.zoom=String(scale);schedule();},zoom(factor){zoomAt(scale*factor);},reset(){scale=1;panX=panY=0;canvas.dataset.zoom='1';schedule();},viewport(){return {scale,x:panX,y:panY};},destroy};
}

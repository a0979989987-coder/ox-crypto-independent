const price=n=>n.toLocaleString('en-US',{maximumSignificantDigits:6});
export function candleChart(canvas,row,{interactive=false,onRange=()=>{},palette=null}={}){
  const ctx=canvas.getContext('2d'),life=new AbortController();let width=0,height=0,raf=0;
  const candles=row.candles;
  const initial=()=>({count:Math.min(candles.length,row.match?Math.max(35,row.match.end-row.match.start+15):90),end:row.match?Math.min(candles.length,row.match.end+6):candles.length});
  let {count,end}=initial(),pointers=new Map(),gesture=null;
  function draw(){
    const light=document.body.classList.contains('theme-light');
    raf=0;const dpr=Math.min(devicePixelRatio||1,2);width=canvas.clientWidth;height=canvas.clientHeight;if(!width||!height)return;
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const start=Math.max(0,Math.floor(end-count)),stop=Math.min(candles.length,Math.ceil(end)),rows=candles.slice(start,stop);if(!rows.length)return;
    const right=interactive?60:6,left=interactive?10:6,top=12,bottom=interactive?28:12,w=width-right-left,h=height-top-bottom;
    const max=Math.max(...rows.map(c=>c.high)),min=Math.min(...rows.map(c=>c.low)),span=(max-min)||max*.001;
    const y=v=>top+8+(max-v)/span*(h-16),x=i=>left+(i-start+.5)*w/rows.length,step=w/rows.length;
    ctx.lineWidth=1;ctx.strokeStyle=light?'#94a3b830':'#ffffff08';for(let j=0;j<4;j++){const py=top+h*j/3;ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(width-right,py);ctx.stroke();}
    if(row.match){const matchLeft=Math.max(start,row.match.start),matchRight=Math.min(stop-1,row.match.end);
      if(matchRight>=matchLeft){ctx.fillStyle='#e6ddd709';ctx.fillRect(x(matchLeft)-step/2,top,(matchRight-matchLeft+1)*step,h);}}
    const body=Math.max(1,Math.min(8,step*.65));
    rows.forEach((c,i)=>{const px=x(i+start);ctx.strokeStyle=ctx.fillStyle=light?(c.close>=c.open?(row.market==='tw'?'#e86480':'#4598df'):(row.market==='tw'?'#32a780':'#e86480')):(c.close>=c.open?(palette?.up||(row.market==='tw'?'#f16a70':'#78b3a3')):(palette?.down||(row.market==='tw'?'#48b78e':'#d18e91')));ctx.beginPath();ctx.moveTo(px,y(c.high));ctx.lineTo(px,y(c.low));ctx.stroke();ctx.fillRect(px-body/2,Math.min(y(c.open),y(c.close)),body,Math.max(1,Math.abs(y(c.open)-y(c.close))));});
    if(row.match){ctx.save();ctx.beginPath();ctx.rect(left,top,w,h);ctx.clip();ctx.strokeStyle=light?'#8d712e':'#f3e9d0';ctx.lineWidth=interactive?1.8:1.3;ctx.beginPath();row.match.points.forEach((p,i)=>{if(i===0)ctx.moveTo(x(p.x),y(p.y));else ctx.lineTo(x(p.x),y(p.y));});ctx.stroke();
      if(row.match.points.length<=9)row.match.points.forEach(p=>{ctx.beginPath();ctx.arc(x(p.x),y(p.y),interactive?3:2,0,Math.PI*2);ctx.fillStyle=light?'#8d712e':'#eee7d9';ctx.fill();});ctx.restore();}
    if(interactive){ctx.font='10px system-ui';ctx.fillStyle=light?'#616d7c':'#929992';ctx.textAlign='left';for(let j=0;j<4;j++)ctx.fillText(price(max-span*j/3),width-right+6,top+8+(h-16)*j/3+3);ctx.textAlign='center';[0,Math.floor((rows.length-1)/2),rows.length-1].forEach(i=>ctx.fillText(new Date(rows[i].time*1000).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',...(row.market==='tw'?{}:{hour:'2-digit',hour12:false})}),Math.max(42,Math.min(width-70,x(start+i))),height-8));}
    onRange({start,stop,count});
  }
  const schedule=()=>{if(!raf)raf=requestAnimationFrame(draw);};
  const resize=new ResizeObserver(schedule);resize.observe(canvas);
  const opts={signal:life.signal};
  document.addEventListener('ox:themechange',schedule,opts);
  if(interactive){
    canvas.style.touchAction='none';
    const resetGesture=()=>{const p=[...pointers.values()];gesture=p.length===2?{distance:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),count,end}:p.length===1?{x:p[0].x,count,end}:null;};
    canvas.addEventListener('pointerdown',e=>{pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);resetGesture();},opts);
    canvas.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const p=[...pointers.values()];if(p.length===2&&gesture?.distance){const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);count=Math.max(15,Math.min(candles.length,gesture.count*gesture.distance/Math.max(10,d)));end=Math.max(count,Math.min(candles.length,gesture.end));}else if(p.length===1&&gesture){end=Math.max(count,Math.min(candles.length,gesture.end-(p[0].x-gesture.x)/width*count));}schedule();},opts);
    for(const event of ['pointerup','pointercancel'])canvas.addEventListener(event,e=>{pointers.delete(e.pointerId);resetGesture();},opts);
    canvas.addEventListener('wheel',e=>{e.preventDefault();count=Math.max(15,Math.min(candles.length,count*Math.exp(e.deltaY*.002)));end=Math.max(count,Math.min(candles.length,end));schedule();},{...opts,passive:false});
  }
  schedule();return {destroy(){resize.disconnect();life.abort();cancelAnimationFrame(raf);},reset(){({count,end}=initial());schedule();}};
}

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const mix=(a,b,t)=>a+(b-a)*t;
function blendColor(first,second,t){
 if(!/^#[0-9a-f]{6}$/i.test(first)||!/^#[0-9a-f]{6}$/i.test(second))return first;
 const hex=channel=>Math.round(mix(parseInt(first.slice(channel,channel+2),16),parseInt(second.slice(channel,channel+2),16),t)).toString(16).padStart(2,'0');
 return '#'+hex(1)+hex(3)+hex(5);
}

const rowMaps=new WeakMap();
const mapAt=frame=>{if(!frame)return new Map();if(!rowMaps.has(frame))rowMaps.set(frame,new Map(frame.rows.map(r=>[r.symbol,r])));return rowMaps.get(frame);};
const connected=(frames,index,stepMs)=>!!frames[index]&&!!frames[index+1]&&(!stepMs||frames[index+1].ts-frames[index].ts===stepMs);
// Same bounded cubic as Taiwan rotation: shared velocity at dated turns,
// no overshoot, and no artificial ease-to-a-stop at every observation.
function smooth(before,a,b,after,key,t){
 const delta=b[key]-a[key];if(!delta)return a[key];
 const tangent=other=>delta*other>0?2*delta*other/(delta+other):0;
 const m0=before?tangent(a[key]-before[key]):delta,m1=after?tangent(after[key]-b[key]):delta,t2=t*t,t3=t2*t;
 return (2*t3-3*t2+1)*a[key]+(t3-2*t2+t)*m0+(-2*t3+3*t2)*b[key]+(t3-t2)*m1;
}
function geometry(frames,position,symbol,stepMs){
 const index=Math.floor(position),t=position-index,a=mapAt(frames[index]).get(symbol),b=mapAt(frames[index+1]).get(symbol);
 if(!connected(frames,index,stepMs)||!a||!b||!t)return a||b;
 const before=connected(frames,index-1,stepMs)?mapAt(frames[index-1]).get(symbol):null;
 const after=connected(frames,index+1,stepMs)?mapAt(frames[index+2]).get(symbol):null;
 return {x:smooth(before,a,b,after,'x',t),y:smooth(before,a,b,after,'y',t)};
}
// Interpolate presentation only; labels/rankings retain closed observations.
// Incoming/outgoing members fade in place instead of jumping across a gap.
export function replayVisualRows(frames,position,visible,{nextVisible,stepMs=0}={}){
 const value=clamp(position,0,Math.max(0,frames.length-1)),index=Math.floor(value),t=value-index;
 if(!t)return visible;
 const next=mapAt(frames[index+1]),current=new Map(visible.map(r=>[r.symbol,r]));
 const incoming=nextVisible||visible.flatMap(r=>next.has(r.symbol)?[next.get(r.symbol)]:[]);
 const allowedNext=new Map(incoming.map(r=>[r.symbol,r]));
 const candidates=new Map([...visible,...incoming].map(r=>[r.symbol,r]));
 const continuous=connected(frames,index,stepMs);
 return [...candidates.keys()].map(symbol=>{
  const a=current.get(symbol),b=allowedNext.get(symbol),row=a||b;
  const opacity=continuous?(a?(b?1:1-t):t):(t<.5?(a?1-2*t:0):(b?2*t-1:0));
  const source=continuous?row:(t<.5?a||row:b||row);
  const point=continuous&&a&&b?geometry(frames,value,symbol,stepMs):source;
  return {...source,x:point.x,y:point.y,opacity,labelX:source.x,
   turnover:continuous&&a&&b?mix(a.turnover,b.turnover,t):source.turnover,
   state:{...source.state,color:continuous&&a&&b?blendColor(a.state.color,b.state.color,t):source.state.color}};
 });
}
export function replayTrails(frames,position,visible,{stepMs=0}={}){
 const value=clamp(position,0,Math.max(0,frames.length-1)),index=Math.floor(value),duration=3,pieces=16;
 return visible.flatMap(row=>{
  if((row.opacity??1)<=0||!mapAt(frames[index]).has(row.symbol))return [];
  // A missing whole bucket is also a gap, even if the model omitted that frame.
  if(!connected(frames,index,stepMs)&&value-index>=.5&&index<frames.length-1)return [];
  let first=index;
  while(first>Math.max(0,Math.floor(value-duration))&&connected(frames,first-1,stepMs)&&mapAt(frames[first-1]).has(row.symbol))first--;
  const end=connected(frames,index,stepMs)&&mapAt(frames[index+1]).has(row.symbol)?value:index;
  const start=Math.max(first,value-duration);if(end<=start)return [];
  let from=geometry(frames,start,row.symbol,stepMs);const segments=[];
  for(let i=1;i<=pieces;i++){
   const time=mix(start,end,i/pieces),to=geometry(frames,time,row.symbol,stepMs),freshness=clamp(1-(value-time)/duration,0,1);
   segments.push({from,to,opacity:.48*freshness**1.6,width:.6+freshness*1.5});from=to;
  }
  return [{symbol:row.symbol,color:row.state.color,opacity:row.opacity??1,segments}];
 });
}

// A single clock owns playback. Seek and pause keep a fractional position;
// the caller keeps the same chart instance and merely redraws its canvas.
export function createFlowReplayPlayer({length,render,onState=()=>{},isActive=()=>true,
 requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame,position=0,speed=1}){
 let value=clamp(position,0,Math.max(0,length-1)),rate=speed,playing=false,frame=null,previous=null,destroyed=false;
 const notify=()=>onState({position:value,playing});
 const pause=()=>{if(!playing&&frame===null)return;playing=false;previous=null;if(frame!==null)cancelFrame(frame);frame=null;notify();};
 const tick=timestamp=>{
  frame=null;if(!playing||destroyed)return;
  if(!isActive()){pause();return;}
  if(previous!==null)value=Math.min(length-1,value+Math.max(0,timestamp-previous)*rate/1300);
  previous=timestamp;render(value);notify();
  if(value>=length-1){pause();return;}
  frame=requestFrame(tick);
 };
 return {
  get position(){return value;},get playing(){return playing;},
  play(){if(destroyed||playing||length<2)return;if(value>=length-1)value=0;playing=true;previous=null;render(value);notify();frame=requestFrame(tick);},
  pause,
  seek(position){if(destroyed)return;pause();value=clamp(Number(position)||0,0,Math.max(0,length-1));render(value);notify();},
  setSpeed(speed){if(Number.isFinite(speed)&&speed>0)rate=speed;},
  destroy(){pause();destroyed=true;}
 };
}

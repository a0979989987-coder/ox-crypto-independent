const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const mix=(a,b,t)=>a+(b-a)*t;
function blendColor(first,second,t){
 if(!/^#[0-9a-f]{6}$/i.test(first)||!/^#[0-9a-f]{6}$/i.test(second))return first;
 const hex=channel=>Math.round(mix(parseInt(first.slice(channel,channel+2),16),parseInt(second.slice(channel,channel+2),16),t)).toString(16).padStart(2,'0');
 return '#'+hex(1)+hex(3)+hex(5);
}

// Interpolate drawings only. Rankings, accessible values and period labels stay
// on real, closed exchange observations; no in-between price is published.
export function replayVisualRows(frames,position,visible){
 const index=Math.floor(clamp(position,0,Math.max(0,frames.length-1))),fraction=clamp(position-index,0,1);
 const next=new Map((frames[index+1]?.rows||[]).map(row=>[row.symbol,row]));
 return visible.map(row=>{
  const later=next.get(row.symbol);if(!later||!fraction)return row;
  return {...row,x:mix(row.x,later.x,fraction),y:mix(row.y,later.y,fraction),
    turnover:mix(row.turnover,later.turnover,fraction),labelX:row.x,
    state:{...row.state,color:blendColor(row.state.color,later.state.color,fraction)}};
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
  if(previous!==null)value=Math.min(length-1,value+clamp(timestamp-previous,0,100)*rate/1300);
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

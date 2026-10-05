import { radiusTargets, metricText, canonical } from './model.js?v=20261001-bubbles3';
import {squeeze,recover,deformation} from './soft-body.js?v=20261002-finance4';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const hash=s=>[...s].reduce((v,c)=>(v*31+c.charCodeAt(0))>>>0,7);
export class BubbleField {
  constructor(canvas,{onSelect=()=>{},logo=()=>null,formatMetric=metricText,metricNames=METRIC_NAMES,assetName="幣種",palette=null,radiusForRows=radiusTargets}={}) {
    this.radiusForRows=radiusForRows;
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.onSelect=onSelect;this.logo=logo;this.formatMetric=formatMetric;this.metricNames=metricNames;this.assetName=assetName;this.palette=palette;this.width=360;this.height=500;
    this.nodes=[];this.images=new Map();this.zoom=1;this.panX=0;this.panY=0;this.pointers=new Map();this.life=new AbortController();this.visible=true;this.paused=false;this.reduced=matchMedia('(prefers-reduced-motion:reduce)');
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);
    this.intersection=new IntersectionObserver(entries=>{this.visible=entries[0].isIntersecting;this.run();},{threshold:.01});this.intersection.observe(canvas);
    document.addEventListener('visibilitychange',()=>this.run(),{signal:this.life.signal});
    this.reduced.addEventListener('change',()=>this.run(),{signal:this.life.signal});
    document.addEventListener('ox:themechange',()=>{for(const n of this.nodes)n.sprite=this.sprite(n);this.paint();},{signal:this.life.signal});
    const opts={signal:this.life.signal};
    canvas.addEventListener('pointerdown',e=>this.down(e),opts);canvas.addEventListener('pointermove',e=>this.move(e),opts);
    canvas.addEventListener('pointerup',e=>this.up(e),opts);canvas.addEventListener('pointercancel',e=>this.up(e,true),opts);
    canvas.addEventListener('lostpointercapture',e=>this.up(e,true),opts);
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.setZoom(this.zoom*Math.exp(-e.deltaY*.001),this.point(e));},{...opts,passive:false});
    this.resize();
  }
  point(e){const r=this.canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
  world(p){return {x:(p.x-this.panX)/this.zoom,y:(p.y-this.panY)/this.zoom};}
  hit(p){const w=this.world(p);return [...this.nodes].reverse().find(n=>{const d=deformation(n),dx=w.x-n.x,dy=w.y-n.y,c=Math.cos(d.angle),s=Math.sin(d.angle);return Math.hypot((dx*c+dy*s)/d.sx,(-dx*s+dy*c)/d.sy)<n.r;});}
  down(e){if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();const p=this.point(e);this.canvas.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,p);
    if(this.pointers.size===1){const node=this.hit(p),w=this.world(p);this.drag={id:e.pointerId,node,start:p,last:p,dx:0,dy:0,moved:false,wasPinch:false,at:performance.now(),offset:node?{x:node.x-w.x,y:node.y-w.y}:null,target:node?{x:node.x,y:node.y}:null};if(node)this.selected=node.symbol;}
    if(this.pointers.size===2){const [a,b]=[...this.pointers.values()];const center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};this.pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:this.zoom,anchor:this.world(center)};if(this.drag){if(this.drag.node)this.drag.node.vx=this.drag.node.vy=0;this.drag.moved=true;this.drag.wasPinch=true;this.drag.node=null;}}
    this.run();this.paint();
  }
  move(e){if(!this.pointers.has(e.pointerId))return;e.preventDefault();const p=this.point(e);this.pointers.set(e.pointerId,p);
    if(this.pointers.size===2&&this.pinch){const [a,b]=[...this.pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};this.zoom=clamp(this.pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,this.pinch.distance),1,4);this.panX=center.x-this.pinch.anchor.x*this.zoom;this.panY=center.y-this.pinch.anchor.y*this.zoom;this.clampPan();}
    else if(this.drag?.id===e.pointerId&&!this.drag.wasPinch){const d=this.drag;d.moved||=Math.hypot(p.x-d.start.x,p.y-d.start.y)>5;
      const elapsed=Math.max(4,performance.now()-d.at),blend=1-Math.exp(-elapsed/30);d.dx+=(clamp((p.x-d.last.x)/this.zoom*16.67/elapsed,-12,12)-d.dx)*blend;d.dy+=(clamp((p.y-d.last.y)/this.zoom*16.67/elapsed,-12,12)-d.dy)*blend;d.at=performance.now();
      if(d.node&&d.moved){const w=this.world(p),n=d.node;
        d.target={x:w.x+d.offset.x,y:w.y+d.offset.y};
        d.wallX=Math.max(0,n.r+1-d.target.x,d.target.x-(this.width-n.r-1));d.wallY=Math.max(0,n.r+1-d.target.y,d.target.y-(this.height-n.r-1));
        // Pointer events update a target only. Motion and contact response run
        // on the same animation clock, independent of touch sampling rate.
        if(this.reduced.matches){this.advanceDrag(1);this.resolveCollisions(false);}}
      else if(!d.node&&this.zoom>1){this.panX+=p.x-d.last.x;this.panY+=p.y-d.last.y;this.clampPan();}d.last=p;
    }this.run();this.paint();
  }
  up(e,cancel=false){if(!this.pointers.has(e.pointerId))return;this.pointers.delete(e.pointerId);
    if(this.drag?.id===e.pointerId){const d=this.drag;if(d.node){if(d.moved){const release=cancel||this.paused?0:Math.exp(-(performance.now()-d.at)/70);d.node.vx=clamp(d.dx*release,-7,7);d.node.vy=clamp(d.dy*release,-7,7);}if(!cancel&&!d.moved&&!d.wasPinch)this.onSelect(d.node);}this.drag=null;}
    if(!this.pointers.size){this.pinch=null;this.drag=null;}this.run();
  }
  clampPan(){this.panX=clamp(this.panX,this.width*(1-this.zoom),0);this.panY=clamp(this.panY,this.height*(1-this.zoom),0);}
  setZoom(z,p={x:this.width/2,y:this.height/2}){const a=this.world(p);this.zoom=clamp(z,1,4);this.panX=p.x-a.x*this.zoom;this.panY=p.y-a.y*this.zoom;this.clampPan();this.paint();}
  reset(){this.zoom=1;this.panX=this.panY=0;this.paint();}
  resize(){const r=this.canvas.getBoundingClientRect();if(r.width<10||r.height<10)return;const oldW=this.width||r.width,oldH=this.height||r.height;this.width=r.width;this.height=r.height;const dpr=Math.min(2,devicePixelRatio||1);this.dpr=dpr;this.canvas.width=Math.round(r.width*dpr);this.canvas.height=Math.round(r.height*dpr);this.ctx.setTransform(dpr,0,0,dpr,0,0);for(const n of this.nodes){n.x*=this.width/oldW;n.y*=this.height/oldH;}this.clampPan();this.setRows(this.nodes,this.metric||'change',{layout:true});}
  setRows(rows,metric,{layout=false}={}){this.metric=metric;const previous=new Map(this.nodes.map(n=>[n.symbol,n])),radii=this.radiusForRows(rows,this.width||360,this.height||500);let added=false;
    this.nodes=rows.map((row,i)=>{const seed=hash(row.symbol),angle=i*2.399963,spread=Math.sqrt((i+.5)/Math.max(rows.length,1))*.43;
      let n=previous.get(row.symbol);if(!n){added=true;n={x:this.width*(.5+Math.cos(angle)*spread),y:this.height*(.5+Math.sin(angle)*spread),vx:Math.cos(seed)*.2,vy:Math.sin(seed)*.2,r:radii[i],seed};}
      const changed=n.value!==row.value||n.target!==radii[i]||n.metric!==metric||n.image!==row.image||n.change!==row.change;
      Object.assign(n,row,{target:radii[i],metric});if(layout||this.paused||this.reduced.matches)n.r=n.target;if(changed||!n.sprite)n.sprite=this.sprite(n);return n;
    });
    if(added||layout||this.paused||this.reduced.matches){for(let i=0;i<70;i++)this.resolveCollisions(false);}
    this.canvas.dataset.coins=String(this.nodes.length);this.canvas.dataset.metric=metric;this.canvas.setAttribute('aria-label',`${this.metricNames[metric]}動態泡泡圖，${this.nodes.length} 個${this.assetName}；可拖曳泡泡，雙指縮放`);this.paint();this.run();
  }
  sprite(n){const light=document.body.classList.contains('theme-light');const r=n.target,scale=2,margin=8,side=(r*2+margin*2),c=document.createElement('canvas');c.width=Math.ceil(side*scale);c.height=Math.ceil(side*scale);let ctx=c.getContext('2d');ctx.scale(scale,scale);const center=side/2;
    const direction=n.sign??(n.metric==='flow'?n.value:n.change),tone=direction>0?(this.palette?.up||'#44bde7'):direction<0?(this.palette?.down||'#f15e7b'):'#aeb6ba';n.tone=tone;
    const glow=ctx.createRadialGradient(center,center,r*.78,center,center,r+5);glow.addColorStop(0,tone+'00');glow.addColorStop(.74,tone+'55');glow.addColorStop(1,tone+'00');ctx.fillStyle=glow;ctx.fillRect(0,0,side,side);
    const fill=ctx.createRadialGradient(center-r*.3,center-r*.35,0,center,center,r);fill.addColorStop(0,light?'#ffffff':'#242b30');fill.addColorStop(.65,light?'#fffdf7':'#151b1f');fill.addColorStop(1,tone+'42');ctx.fillStyle=fill;ctx.beginPath();ctx.arc(center,center,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle=tone+'b0';ctx.lineWidth=1.4;ctx.stroke();
    // The shell yields under pressure; the label and logo remain readable.
    const label=document.createElement('canvas');label.width=c.width;label.height=c.height;n.labelSprite=label;ctx=label.getContext('2d');ctx.scale(scale,scale);
    const url=this.logo(canonical(n.base))||n.image;let img=url&&this.images.get(url);
    if(url&&!img){img=new Image();img.decoding='async';this.images.set(url,img);img.onload=()=>{if(this.life.signal.aborted)return;for(const row of this.nodes)if((this.logo(canonical(row.base))||row.image)===url)row.sprite=this.sprite(row);this.paint();};img.src=url;}
    const full=r>=23,logoSize=Math.min(25,r*.43);let nameY=center+(full?0:2);
    if(full){const ly=center-r*.58;ctx.save();ctx.beginPath();ctx.arc(center,ly,logoSize/2,0,Math.PI*2);ctx.clip();if(img?.complete&&img.naturalWidth)ctx.drawImage(img,center-logoSize/2,ly-logoSize/2,logoSize,logoSize);else{ctx.fillStyle=tone+'45';ctx.fillRect(center-logoSize/2,ly-logoSize/2,logoSize,logoSize);ctx.fillStyle=light?'#374151':'#fff';ctx.font=`600 ${logoSize*.48}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(n.base.slice(0,1),center,ly);}ctx.restore();}
    ctx.textAlign='center';ctx.textBaseline='middle';let font=Math.min(27,r*.48);ctx.font=`500 ${font}px Inter,system-ui`;const maxWidth=r*1.68;if(ctx.measureText(n.base).width>maxWidth){font*=maxWidth/ctx.measureText(n.base).width;ctx.font=`500 ${font}px Inter,system-ui`;}
    ctx.fillStyle=light?'#374151':'#f1f1eb';ctx.fillText(n.base,center,nameY);if(r>=19){ctx.font=`500 ${Math.min(13,Math.max(8,r*.25))}px Inter,system-ui`;ctx.fillStyle=light?'#585347':'#e6e9e8';ctx.fillText(this.formatMetric(n.value,n.metric),center,nameY+Math.min(22,r*.39),r*1.73);}return c;
  }
  extents(n){const d=deformation(n),c=Math.cos(d.angle),s=Math.sin(d.angle);return {x:n.r*Math.hypot(d.sx*c,d.sy*s),y:n.r*Math.hypot(d.sx*s,d.sy*c)};}
  advanceDrag(dt){const d=this.drag;if(!d?.moved||!d.node||!d.target)return;const n=d.node,r=this.extents(n),ease=this.reduced.matches?1:1-Math.exp(-.8*dt),x=n.x,y=n.y;
    let dx=(clamp(d.target.x,r.x+1,this.width-r.x-1)-n.x)*ease,dy=(clamp(d.target.y,r.y+1,this.height-r.y-1)-n.y)*ease;const distance=Math.hypot(dx,dy),limit=Math.max(8,Math.min(26,n.r*.7))*dt;
    if(!this.reduced.matches&&distance>limit){dx*=limit/distance;dy*=limit/distance;}n.x+=dx;n.y+=dy;
    n.vx=clamp((n.x-x)/Math.max(dt,.001),-12,12);n.vy=clamp((n.y-y)/Math.max(dt,.001),-12,12);
  }
  resolveCollisions(deform=true,dt=1){const nodes=this.nodes,held=this.drag?.moved?this.drag.node:null;
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];let dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy),min=a.r+b.r+2;if(dist>=min)continue;if(dist<.001){dx=.01;dy=.01;dist=Math.hypot(dx,dy);}const nx=dx/dist,ny=dy/dist,overlap=min-dist;
      const relative=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
      if(deform&&!this.reduced.matches){const pressure=Math.max(0,overlap-1)/Math.max(a.r+b.r,1)*.55+Math.max(0,-relative)*.009;squeeze(a,nx,ny,pressure);squeeze(b,nx,ny,pressure);}
      // Gradual position relaxation and low restitution make dense clusters
      // yield instead of snapping apart. Larger bubbles have more inertia.
      const wa=a===held?0:1/Math.max(1,a.r*a.r),wb=b===held?0:1/Math.max(1,b.r*b.r),mass=wa+wb;
      if(!mass)continue;const correction=Math.max(0,overlap-.25)*(deform?1-Math.exp(-.55*dt):1);
      a.x-=nx*correction*wa/mass;a.y-=ny*correction*wa/mass;b.x+=nx*correction*wb/mass;b.y+=ny*correction*wb/mass;
      // A dragged bubble may indent its neighbour, but cannot pass through it
      // when that neighbour is pinned against a wall or a dense cluster.
      if(held&&(a===held||b===held)){const other=a===held?b:a,r=this.extents(other);other.x=clamp(other.x,r.x+1,this.width-r.x-1);other.y=clamp(other.y,r.y+1,this.height-r.y-1);const separation=(b.x-a.x)*nx+(b.y-a.y)*ny,blocked=Math.max(0,min*.82-separation);if(a===held){a.x-=nx*blocked;a.y-=ny*blocked;}else{b.x+=nx*blocked;b.y+=ny*blocked;}}
      if(relative<0){const impulse=Math.min(12,-relative)*1.08/mass;a.vx-=impulse*nx*wa;a.vy-=impulse*ny*wa;b.vx+=impulse*nx*wb;b.vy+=impulse*ny*wb;}
    }
    this.constrainBounds(deform);
  }
  constrainBounds(deform=true,pressure=true){const held=this.drag?.moved?this.drag.node:null;
    for(const n of this.nodes){const r=deform?this.extents(n):{x:n.r,y:n.r},left=r.x+1,right=this.width-r.x-1,top=r.y+1,bottom=this.height-r.y-1,px=Math.max(0,left-n.x,n.x-right),py=Math.max(0,top-n.y,n.y-bottom);
      if(deform&&pressure&&!this.reduced.matches){if(px)squeeze(n,1,0,px/Math.max(n.r,1)*.38+Math.abs(n.vx)*.012);if(py)squeeze(n,0,1,py/Math.max(n.r,1)*.38+Math.abs(n.vy)*.012);}
      // Reflect only motion into a wall; contact correction cannot reverse an
      // already outgoing bubble on the following solver step.
      if(n!==held){if(n.x<left&&n.vx<0||n.x>right&&n.vx>0)n.vx*=-.22;if(n.y<top&&n.vy<0||n.y>bottom&&n.vy>0)n.vy*=-.22;}
      n.x=clamp(n.x,left,right);n.y=clamp(n.y,top,bottom);
    }
  }
  holdPressure(){const d=this.drag;if(!d?.moved||!d.node||this.reduced.matches)return;const n=d.node;if(d.wallX)squeeze(n,1,0,d.wallX/Math.max(n.r,1)*.16);if(d.wallY)squeeze(n,0,1,d.wallY/Math.max(n.r,1)*.16);}
  advance(dt,t){const steps=Math.max(1,Math.ceil(dt/.5)),step=dt/steps,interactive=!!(this.drag?.moved&&this.drag.node);
    for(let k=0;k<steps;k++){
      for(const n of this.nodes){n.pressureX=n.pressureY=0;n.r+=(n.target-n.r)*(1-Math.exp(-.09*step));}
      this.advanceDrag(step);
      if(!this.paused&&!this.reduced.matches)for(const n of this.nodes){if(n===this.drag?.node&&this.drag.moved)continue;
        n.vx+=Math.cos(t*.00018+n.seed)*.004*step;n.vy+=Math.sin(t*.00016+n.seed)*.004*step;n.vx*=Math.pow(.993,step);n.vy*=Math.pow(.993,step);
        n.vx=clamp(n.vx,-7,7);n.vy=clamp(n.vy,-7,7);n.x+=n.vx*step;n.y+=n.vy*step;
      }
      if(!this.paused&&!this.reduced.matches||interactive)this.resolveCollisions(!this.reduced.matches,step);
      this.holdPressure();for(const n of this.nodes)recover(n,step);this.constrainBounds(true,false);
    }
  }
  paint(){const ctx=this.ctx;if(!ctx||!this.width)return;ctx.clearRect(0,0,this.width,this.height);ctx.save();ctx.translate(this.panX,this.panY);ctx.scale(this.zoom,this.zoom);
    for(const n of this.nodes){if(!n.sprite)continue;const side=n.r*2+16,d=deformation(n);ctx.save();ctx.translate(n.x,n.y);ctx.rotate(d.angle);ctx.scale(d.sx,d.sy);ctx.rotate(-d.angle);ctx.drawImage(n.sprite,-side/2,-side/2,side,side);if(n.symbol===this.selected){ctx.strokeStyle='#fff8';ctx.lineWidth=1/this.zoom;ctx.beginPath();ctx.arc(0,0,n.r+3,0,Math.PI*2);ctx.stroke();}ctx.restore();if(n.labelSprite)ctx.drawImage(n.labelSprite,n.x-side/2,n.y-side/2,side,side);}
    ctx.restore();}
  run(){if(this.reduced.matches)for(const n of this.nodes)n.strainX=n.strainY=n.strainVX=n.strainVY=n.pressureX=n.pressureY=0;const recovering=this.nodes.some(n=>Math.hypot(n.strainX||0,n.strainY||0,n.strainVX||0,n.strainVY||0)>.0001),active=!this.life.signal.aborted&&this.visible&&!document.hidden&&this.nodes.length&&(!this.paused&&!this.reduced.matches||this.pointers.size||recovering&&!this.reduced.matches);
    if(!active){cancelAnimationFrame(this.frame);this.frame=0;this.last=0;this.paint();return;}if(this.frame)return;
    const tick=t=>{this.frame=0;if(this.life.signal.aborted)return;const dt=this.last?clamp((t-this.last)/16.67,.2,2):1;this.last=t;this.advance(dt,t);this.paint();this.run();};this.frame=requestAnimationFrame(tick);
  }
  destroy(){this.life.abort();cancelAnimationFrame(this.frame);this.frame=0;this.resizeObserver.disconnect();this.intersection.disconnect();this.images.clear();}
}
const METRIC_NAMES={change:'漲幅',volume:'成交量',cap:'市值',flow:'大資金灌入',score:'OX 評分'};

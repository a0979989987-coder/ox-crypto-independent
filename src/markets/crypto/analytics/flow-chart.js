import { signed } from './flow-model.js';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function strengthBubbleRadius(row,{rotation=false,domain=1,mobile=false}={}){
  const peak=mobile?34:50,minimum=mobile?10:12;
  const strength=rotation?(row.x/Math.max(domain,.001)+1)/2:Math.abs(row.x)/100;
  return minimum+(peak-minimum)*Math.pow(clamp(strength,0,1),rotation?2:1.35);
}
export function bubbleLabelLayout(measure,name,value,r,mobile=false){
  const fit=(text,size)=>size*Math.min(1,r*1.65/Math.max(1,measure(text,size)));
  const nameSize=fit(name,Math.min(mobile?10:13,r*.42));
  const valueSize=fit(value,Math.min(mobile?8:10.5,r*.34));
  return {nameSize,valueSize,nameY:-r*.2,valueY:r*.28};
}
export function createFlowChart(canvas, { onSelect, onZoom = () => {}, signal:parentSignal }) {
  const life=new AbortController(),signal=life.signal,onAbort=()=>life.abort();parentSignal?.addEventListener('abort',onAbort,{once:true});if(parentSignal?.aborted)life.abort();
  const ctx = canvas.getContext('2d');
  let rows = [], selected = '', filter = '', all = [], points = [], labelHits = [], width = 0, height = 0, zoom = 1, pan = { x: 0, y: 0 }, raf = 0;
  let settings = {}, interactive = true, active = true, drag = null, pinch = null; const pointers = new Map();
  canvas.style.touchAction = 'none';
  const draw = () => {
    const light=document.body.classList.contains('theme-light');
    raf = 0; labelHits = []; if (!active || !width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const m = { l: width < 600 ? 32 : 52, r: width < 600 ? 12 : 30, t: 31, b: 42 };
    const pw = width - m.l - m.r, ph = height - m.t - m.b;
    const ext = [...all, ...(settings.trails || []).flatMap(t => t.points)];
    const nice = v => { const step = v <= .2 ? .05 : v <= 1 ? .25 : v <= 4 ? 1 : v <= 10 ? 2 : 10; return Math.max(step, Math.ceil(v / step) * step); };
    const xd = settings.domain?.x || nice(Math.max(...ext.map(r => Math.abs(r.x)), 0));
    const yd = settings.domain?.y || nice(Math.max(...ext.map(r => Math.abs(r.y)), 0));
    // Insets keep the largest circle inside the plot at reset, without moving observations.
    const radiusMax = width < 600 ? 34 : 50;
    const xSpan = Math.max(20, pw / 2 - radiusMax - 12), ySpan = Math.max(20, ph / 2 - radiusMax - 12);
    const cx = m.l + pw / 2 + pan.x, cy = m.t + ph / 2 + pan.y;
    const xAt = v => cx + v / xd * xSpan * zoom, yAt = v => cy - v / yd * ySpan * zoom;
    ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
    const quadrants = [{ x: m.l, y: m.t, w: cx - m.l, h: cy - m.t, c: 'rgba(158,174,196,.025)' },{ x: cx, y: m.t, w: m.l + pw - cx, h: cy - m.t, c: 'rgba(145,199,177,.03)' },{ x: m.l, y: cy, w: cx - m.l, h: m.t + ph - cy, c: 'rgba(205,147,153,.025)' },{ x: cx, y: cy, w: m.l + pw - cx, h: m.t + ph - cy, c: 'rgba(207,188,145,.025)' }];
    quadrants.forEach(q => { if (q.w > 0 && q.h > 0) { ctx.fillStyle = q.c; ctx.fillRect(q.x, q.y, q.w, q.h); } });
    ctx.strokeStyle = light?'#d7dee7':'#242b2f'; ctx.lineWidth = 1;
    const nt = width < 600 ? 2 : 4;
    const spacing=width<600?34:58;
    const gridX=nt*Math.max(1,Math.ceil(xSpan*zoom/(nt*spacing))),gridY=nt*Math.max(1,Math.ceil(ySpan*zoom/(nt*spacing)));
    const xStep=xSpan*zoom/gridX,yStep=ySpan*zoom/gridY;
    for(let i=Math.ceil((m.l-cx)/xStep);i<=(m.l+pw-cx)/xStep;i++){
      const x=cx+i*xStep;
      ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
    }
    for(let i=Math.ceil((m.t-cy)/yStep);i<=(m.t+ph-cy)/yStep;i++){
      const y=cy+i*yStep;
      ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
    }
    ctx.strokeStyle = '#59615f';
    ctx.beginPath(); ctx.moveTo(cx, m.t); ctx.lineTo(cx, m.t + ph); ctx.moveTo(m.l, cy); ctx.lineTo(m.l + pw, cy); ctx.stroke();
    const label = (text, x, y, align) => { ctx.font = `${width<600?10:11}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`; ctx.fillStyle = light?'#616d7c':'#838c8e'; ctx.textAlign = align; ctx.fillText(text, x, y); };
    label(settings.quadrants?.[0] || '賣壓放緩', m.l + 12, m.t + 22, 'left'); label(settings.quadrants?.[1] || '買壓增強', m.l + pw - 12, m.t + 22, 'right');
    label(settings.quadrants?.[2] || '賣壓增強', m.l + 12, m.t + ph - 12, 'left'); label(settings.quadrants?.[3] || '買壓放緩', m.l + pw - 12, m.t + ph - 12, 'right');
    points = rows.map(row => ({ row, x: xAt(row.x), y: yAt(row.y), r: settings.equalSize ? Math.min(radiusMax, width < 600 ? 18 : 24) : strengthBubbleRadius(row,{rotation:settings.rotation,domain:xd,mobile:width<600}) }));
    const sorted = [...points].sort((a, b) => b.r - a.r);
    for (const p of sorted) {
      const active = !filter || p.row.state.id === filter; const chosen = p.row.symbol === selected;
      ctx.globalAlpha = active ? (selected && !chosen ? .88 : 1) : .12;
      const gradient = ctx.createRadialGradient(p.x - p.r * .3, p.y - p.r * .4, 0, p.x, p.y, p.r);
      gradient.addColorStop(0, p.row.state.color + 'aa'); gradient.addColorStop(.75, p.row.state.color + '70'); gradient.addColorStop(1, p.row.state.color + '45');
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = chosen ? (light?'#8d712e':'#f0eee8') : p.row.state.color + 'cc'; ctx.lineWidth = chosen ? 1.8 : 1.25; ctx.stroke();
      
    }
    ctx.globalAlpha = 1;
    // Draw the moving path over the bubbles so the cumulative line stays visible.
    for (const trail of settings.trails || []) { if (selected && trail.symbol !== selected) continue; const pts=trail.points;if(pts.length<2)continue;
      ctx.strokeStyle=(trail.color || '#bbc5c4')+(selected?'ef':'ae');ctx.lineWidth=selected?2.5:1.7;ctx.lineJoin='round';ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(xAt(p.x),yAt(p.y)):ctx.moveTo(xAt(p.x),yAt(p.y)));ctx.stroke();
      pts.slice(0,-1).forEach(p=>{ctx.fillStyle=light?'#334149c9':'#15252bdb';ctx.beginPath();ctx.arc(xAt(p.x),yAt(p.y),2.3,0,Math.PI*2);ctx.fill();});
    }
    // Labels stay centered inside their own circle and scale with its radius.
    const boxes=[];
    const measure=(text,size)=>{ctx.font=`400 ${size}px Inter,-apple-system,sans-serif`;return ctx.measureText(text).width;};
    for(const p of [...points].sort((a,b)=>Number(b.row.symbol===selected)-Number(a.row.symbol===selected)||b.r-a.r)){
      if(filter&&p.row.state.id!==filter)continue;
      const name=p.row.base,value=signed(p.row.labelX??p.row.x,settings.rotation?2:1)+(settings.rotation?'pp':'%');
      const layout=bubbleLabelLayout(measure,name,value,p.r,width<600);
      const w=Math.max(measure(name,layout.nameSize),measure(value,layout.valueSize));
      const box={l:p.x-w/2,r:p.x+w/2,t:p.y+layout.nameY-layout.nameSize/2,b:p.y+layout.valueY+layout.valueSize/2};
      if(p.row.symbol!==selected&&boxes.some(o=>box.l<o.r+1&&box.r>o.l-1&&box.t<o.b+1&&box.b>o.t-1))continue;
      boxes.push(box);ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,p.r-1,0,Math.PI*2);ctx.clip();
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=light?'#334149':'#f0f2ea';
      ctx.font=`400 ${layout.nameSize}px Inter,-apple-system,sans-serif`;ctx.fillText(name,p.x,p.y+layout.nameY);
      ctx.fillStyle=light?'#52646b':'#c4d9d5';ctx.font=`400 ${layout.valueSize}px Inter,-apple-system,sans-serif`;ctx.fillText(value,p.x,p.y+layout.valueY);
      ctx.restore();
    }
    ctx.restore(); ctx.font = `${width<600?10:11}px Inter, -apple-system, sans-serif`; ctx.fillStyle = light?'#616d7c':'#909a9d';
    for (let i = -nt; i <= nt; i++) {
      const xv = xd * i / nt, yv = yd * i / nt, x = xAt(xv), y = yAt(yv);
      if (x >= m.l && x <= width - m.r) { ctx.textAlign = 'center'; ctx.fillText(signed(xv, Number.isInteger(xv) ? 0 : Math.abs(xv)<1 ? 2 : 1), x, height - 29); }
      if (y >= m.t && y <= m.t + ph) { ctx.textAlign = 'right'; ctx.fillText(signed(yv, Number.isInteger(yv) ? 0 : Math.abs(yv)<1 ? 2 : 1), m.l - 4, y + 3); }
    }
    ctx.textAlign = 'left'; ctx.fillStyle = light?'#616d7c':'#a5adad'; ctx.fillText(settings.axisY || '占比變化（百分點）', m.l, 17);
    ctx.textAlign = 'center'; ctx.fillText(settings.axisX || '主動買賣占比（%）', m.l + pw / 2, height - 7);
  };
  const schedule = () => { if (active && !raf) raf = requestAnimationFrame(draw); };
  const resize = new ResizeObserver(entries => { const r = entries[0].contentRect; width = r.width; height = r.height; schedule(); }); resize.observe(canvas);
  const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', e => { const p = local(e); pointers.set(e.pointerId, p); canvas.setPointerCapture(e.pointerId); if(pointers.size===1)drag = { ...p, px: pan.x, py: pan.y, moved: false }; if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; } }, { signal });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return; const p = local(e); pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) { const [a, b] = [...pointers.values()]; zoom = clamp(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.d), 1, 5); if (drag) drag.moved = true; onZoom(zoom); schedule(); }
    else if (interactive && drag) { if (Math.hypot(p.x - drag.x, p.y - drag.y) > 5) drag.moved = true; if (drag.moved) { pan = { x: clamp(drag.px + p.x - drag.x, -width * zoom / 2, width * zoom / 2), y: clamp(drag.py + p.y - drag.y, -height * zoom / 2, height * zoom / 2) }; schedule(); } }
    else if (drag && Math.hypot(p.x - drag.x, p.y - drag.y) > 7) drag.moved = true;
  }, { signal });
  const release = e => { if (drag && !drag.moved && !pinch && e.type === 'pointerup') { const p = local(e); const labelHit=labelHits.find(b=>p.x>=b.l&&p.x<=b.r&&p.y>=b.t&&p.y<=b.b); if(labelHit){onSelect(labelHit.symbol);pointers.delete(e.pointerId);drag=null;pinch=null;return;} const match = points.filter(p => !filter || p.row.state.id === filter).map(q => ({ q, distance: Math.hypot(p.x - q.x, p.y - q.y) })).filter(q => q.distance <= Math.max(q.q.r, 22)).sort((a, b) => a.distance - b.distance)[0]; if (match) onSelect(match.q.row.symbol); } pointers.delete(e.pointerId); drag = null; pinch = null; };
  canvas.addEventListener('pointerup', release, { signal }); canvas.addEventListener('pointercancel', release, { signal });
  canvas.addEventListener('wheel', e => { if (!interactive || e.ctrlKey) return; e.preventDefault(); zoom = clamp(zoom * (e.deltaY > 0 ? .9 : 1.1), 1, 5); onZoom(zoom); schedule(); }, { signal, passive: false });
  document.addEventListener('ox:themechange',schedule,{signal});
  return {
    update(next, options = {}) { settings = options; all = next; rows = next; selected = options.selected || ''; filter = options.filter || ''; schedule(); },
    setInteractive(value=true) { interactive = value; canvas.style.touchAction = value?'none':'pan-y'; },
    setActive(value){active=value;if(!value){cancelAnimationFrame(raf);raf=0;pointers.clear();drag=pinch=null;}else schedule();},
    reset() { zoom = 1; pan = { x: 0, y: 0 }; onZoom(zoom); schedule(); },
    zoom(delta) { zoom = clamp(zoom + delta, 1, 5); onZoom(zoom); schedule(); },
    getViewport(){return {zoom,pan:{...pan}};},restoreViewport(view){if(view&&[view.zoom,view.pan?.x,view.pan?.y].every(Number.isFinite)){zoom=clamp(view.zoom,1,5);pan={...view.pan};onZoom(zoom);schedule();}},
    destroy() {parentSignal?.removeEventListener('abort',onAbort);life.abort(); document.removeEventListener('ox:themechange',schedule);resize.disconnect(); cancelAnimationFrame(raf); pointers.clear(); }
  };
}

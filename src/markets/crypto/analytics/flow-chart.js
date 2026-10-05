import { signed } from './flow-model.js';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function createFlowChart(canvas, { onSelect, onZoom = () => {}, signal }) {
  const ctx = canvas.getContext('2d');
  let rows = [], selected = '', filter = '', all = [], points = [], labelHits = [], width = 0, height = 0, zoom = 1, pan = { x: 0, y: 0 }, raf = 0;
  let settings = {}, interactive = true, drag = null, pinch = null; const pointers = new Map();
  canvas.style.touchAction = 'none';
  const draw = () => {
    const light=document.body.classList.contains('theme-light');
    raf = 0; labelHits = []; if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const m = { l: width < 600 ? 45 : 62, r: width < 600 ? 23 : 42, t: 40, b: 50 };
    const pw = width - m.l - m.r, ph = height - m.t - m.b;
    const ext = [...all, ...(settings.trails || []).flatMap(t => t.points)];
    const nice = v => { const step = v <= .2 ? .05 : v <= 1 ? .25 : v <= 4 ? 1 : v <= 10 ? 2 : 10; return Math.max(step, Math.ceil(v / step) * step); };
    const xd = settings.domain?.x || nice(Math.max(...ext.map(r => Math.abs(r.x)), 0));
    const yd = settings.domain?.y || nice(Math.max(...ext.map(r => Math.abs(r.y)), 0));
    // Insets keep the largest circle inside the plot at reset, without moving observations.
    const radiusMax = width < 600 ? 43 : 66;
    const xSpan = Math.max(20, pw / 2 - radiusMax - 12), ySpan = Math.max(20, ph / 2 - radiusMax - 12);
    const cx = m.l + pw / 2 + pan.x, cy = m.t + ph / 2 + pan.y;
    const xAt = v => cx + v / xd * xSpan * zoom, yAt = v => cy - v / yd * ySpan * zoom;
    ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
    const quadrants = [{ x: m.l, y: m.t, w: cx - m.l, h: cy - m.t, c: 'rgba(158,174,196,.025)' },{ x: cx, y: m.t, w: m.l + pw - cx, h: cy - m.t, c: 'rgba(145,199,177,.03)' },{ x: m.l, y: cy, w: cx - m.l, h: m.t + ph - cy, c: 'rgba(205,147,153,.025)' },{ x: cx, y: cy, w: m.l + pw - cx, h: m.t + ph - cy, c: 'rgba(207,188,145,.025)' }];
    quadrants.forEach(q => { if (q.w > 0 && q.h > 0) { ctx.fillStyle = q.c; ctx.fillRect(q.x, q.y, q.w, q.h); } });
    ctx.strokeStyle = light?'#d7dee7':'#242b2f'; ctx.lineWidth = 1;
    const nt = width < 600 ? 2 : 4;
    for (let i = -nt; i <= nt; i++) {
      const x = xAt(xd * i / nt), y = yAt(yd * i / nt);
      ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
    }
    ctx.strokeStyle = '#59615f';
    ctx.beginPath(); ctx.moveTo(cx, m.t); ctx.lineTo(cx, m.t + ph); ctx.moveTo(m.l, cy); ctx.lineTo(m.l + pw, cy); ctx.stroke();
    const label = (text, x, y, align) => { ctx.font = '12px Inter, -apple-system, BlinkMacSystemFont, sans-serif'; ctx.fillStyle = light?'#616d7c':'#838c8e'; ctx.textAlign = align; ctx.fillText(text, x, y); };
    label(settings.quadrants?.[0] || '賣壓放緩', m.l + 12, m.t + 22, 'left'); label(settings.quadrants?.[1] || '買壓增強', m.l + pw - 12, m.t + 22, 'right');
    label(settings.quadrants?.[2] || '賣壓增強', m.l + 12, m.t + ph - 12, 'left'); label(settings.quadrants?.[3] || '買壓放緩', m.l + pw - 12, m.t + ph - 12, 'right');
    for (const trail of settings.trails || []) { if (selected && trail.symbol !== selected) continue; const pts=trail.points; ctx.strokeStyle=(trail.color || '#bbc5c4')+'70';ctx.lineWidth=1.2;ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(xAt(p.x),yAt(p.y)):ctx.moveTo(xAt(p.x),yAt(p.y)));ctx.stroke();pts.slice(0,-1).forEach((p,i)=>{ctx.fillStyle=(trail.color || '#bbc5c4')+'80';ctx.beginPath();ctx.arc(xAt(p.x),yAt(p.y),2+i*.3,0,Math.PI*2);ctx.fill();}); }
    const max = Math.max(...all.map(r => r.turnover), 1);
    points = rows.map(row => ({ row, x: xAt(row.x), y: yAt(row.y), r: settings.equalSize ? Math.min(radiusMax, width < 600 ? 15 : 23) : radiusMax * Math.sqrt(row.turnover / max) }));
    const sorted = [...points].sort((a, b) => b.r - a.r);
    for (const p of sorted) {
      const active = !filter || p.row.state.id === filter; const chosen = p.row.symbol === selected;
      ctx.globalAlpha = active ? (selected && !chosen ? .68 : 1) : .12;
      const gradient = ctx.createRadialGradient(p.x - p.r * .3, p.y - p.r * .4, 0, p.x, p.y, p.r);
      gradient.addColorStop(0, p.row.state.color + 'aa'); gradient.addColorStop(.75, p.row.state.color + '70'); gradient.addColorStop(1, p.row.state.color + '45');
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = chosen ? (light?'#8d712e':'#f0eee8') : p.row.state.color + 'cc'; ctx.lineWidth = chosen ? 1.8 : 1.25; ctx.stroke();
      ctx.fillStyle = p.row.state.color; ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Labels may be suppressed on overlap; the measured coordinates never move.
    const boxes = [];
    for (const p of [...points].sort((a, b) => Number(b.row.symbol === selected) - Number(a.row.symbol === selected) || b.r - a.r)) {
      if (filter && p.row.state.id !== filter) continue;
      const chosen = p.row.symbol === selected;
      if (!settings.rotation && !chosen && p.r < (width < 600 ? 11 : 12)) continue;
      if(settings.rotation) {
        const labelWidth=width<600?77:88,labelHeight=36;
        const vert=p.r+labelHeight/2+10,side=p.r+labelWidth/2+8;const candidates=[[0,-vert],[0,vert],[side,0],[-side,0],[side*.8,-vert*.8],[-side*.8,-vert*.8],[side*.8,vert*.8],[-side*.8,vert*.8],[0,-vert*1.7],[0,vert*1.7]];
        const pointInView=p.x>=m.l&&p.x<=m.l+pw&&p.y>=m.t&&p.y<=m.t+ph;
        if(!pointInView)continue;
        let box=null;
        for(const [dx,dy] of candidates){const lx=clamp(p.x+dx,m.l+labelWidth/2+2,m.l+pw-labelWidth/2-2),ly=clamp(p.y+dy,m.t+42,m.t+ph-42);const candidate={l:lx-labelWidth/2,r:lx+labelWidth/2,t:ly-labelHeight/2,b:ly+labelHeight/2,x:lx,y:ly};if(Math.hypot(lx-p.x,ly-p.y)<p.r+labelHeight/2+3)continue;if(!boxes.some(o=>candidate.l<o.r+5&&candidate.r>o.l-5&&candidate.t<o.b+5&&candidate.b>o.t-5)){box=candidate;break;}}
        if(!box)continue;
        boxes.push(box);labelHits.push({...box,symbol:p.row.symbol});
        const displaced=Math.hypot(box.x-p.x,box.y-p.y)>14;
        if(displaced){ctx.strokeStyle=p.row.state.color+'a0';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(box.x,box.y);ctx.stroke();}
        ctx.fillStyle=light?(chosen?'#edf2f8':'#ffffffed'):(chosen?'#273a40f5':'#17252ded');ctx.fillRect(box.l,box.t,labelWidth,labelHeight);
        ctx.strokeStyle=chosen?(light?'#8d712e':'#e7ede4'):p.row.state.color+'50';ctx.lineWidth=.6;ctx.strokeRect(box.l,box.t,labelWidth,labelHeight);
        ctx.font='12px Inter,-apple-system,sans-serif';ctx.textAlign='center';ctx.fillStyle=light?'#374151':'#eceee5';ctx.fillText(p.row.base,box.x,box.y-2);
        ctx.font='10px Inter,sans-serif';ctx.fillStyle=p.row.state.color;ctx.fillText(signed(p.row.x,2)+'pp',box.x,box.y+12);
        continue;
      }
      ctx.font = `600 ${chosen || p.r > 26 ? 15 : 12}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
      const w = Math.max(ctx.measureText(p.row.base).width + 12, 52), h = p.r > 26 || chosen ? 36 : 18;
      const b = { l: p.x - w / 2, r: p.x + w / 2, t: p.y - h / 2, b: p.y + h / 2 };
      if (b.l < m.l || b.r > m.l + pw || b.t < m.t || b.b > m.t + ph) continue;
      if (!chosen && boxes.some(o => b.l < o.r + 5 && b.r > o.l - 5 && b.t < o.b + 5 && b.b > o.t - 5)) continue;
      boxes.push(b); ctx.textAlign = 'center'; ctx.fillStyle = light?'#374151':'#f0eee8';
      ctx.fillText(p.row.base, p.x, p.y + (h === 18 ? 4 : -1));
      if (h > 18) { ctx.font = '11px Inter, sans-serif'; ctx.fillText(signed(p.row.x, settings.rotation ? 2 : 1) + (settings.rotation ? 'pp' : '%'), p.x, p.y + 15); }
    }
    ctx.restore(); ctx.font = '11px Inter, -apple-system, sans-serif'; ctx.fillStyle = light?'#616d7c':'#909a9d';
    for (let i = -nt; i <= nt; i++) {
      const xv = xd * i / nt, yv = yd * i / nt, x = xAt(xv), y = yAt(yv);
      if (x >= m.l && x <= width - m.r) { ctx.textAlign = 'center'; ctx.fillText(signed(xv, Number.isInteger(xv) ? 0 : Math.abs(xv)<1 ? 2 : 1), x, height - 29); }
      if (y >= m.t && y <= m.t + ph) { ctx.textAlign = 'right'; ctx.fillText(signed(yv, Number.isInteger(yv) ? 0 : Math.abs(yv)<1 ? 2 : 1), m.l - 10, y + 4); }
    }
    ctx.textAlign = 'left'; ctx.fillStyle = light?'#616d7c':'#a5adad'; ctx.fillText(settings.axisY || '占比變化（百分點）', m.l, 20);
    ctx.textAlign = 'center'; ctx.fillText(settings.axisX || '主動買賣占比（%）', m.l + pw / 2, height - 7);
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
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
    setInteractive() { interactive = true; canvas.style.touchAction = 'none'; },
    reset() { zoom = 1; pan = { x: 0, y: 0 }; onZoom(zoom); schedule(); },
    zoom(delta) { zoom = clamp(zoom + delta, 1, 5); onZoom(zoom); schedule(); },
    destroy() { document.removeEventListener('ox:themechange',schedule);resize.disconnect(); cancelAnimationFrame(raf); pointers.clear(); }
  };
}

// Bottom dock on phones, after the iOS 26 liquid-glass tab bar in Threads and
// Instagram, ported as is from the Taiwan site (PRs #44–#47); the crypto dock
// keeps its own five tabs 首頁／行情／畫板／型態／資訊. Studied frame by frame from
// screen recordings:
// - A tap moves the tinted capsule to the new tab fast (about 0.2 s) with a
//   slight stretch and a glint at the rim; it does not lift or bounce much.
// - Press and hold, or slide, and the capsule lifts into a clear lens larger
//   than the bar that magnifies the icons under it, with a bright rim and a
//   rainbow edge where the light bends. Let go and it drops into the nearest
//   tab with a small settle.
// One spring loop writes transforms only; the magnifier switches on once per
// hold and off once when the lens has landed, so nothing flickers.
const PHONE = '(max-width:1024px)';
const RW = 70, RH = 46;   // resting capsule
const MW = 86, MH = 66;   // lifted lens; drawn at this size and scaled down at rest
const PAD = 24;           // how far the lens may reach past the bar
const ZOOM = 0.16;        // icon magnification when fully lifted
const HOLD_MS = 150;      // a press longer than this lifts the lens
// Springs: [stiffness, damping ratio]
const TAP = [700, 0.86], FOLLOW = [1300, 0.9], DROP = [420, 0.72], RISE = [520, 0.62], FALL = [420, 0.8], JIGGLE = [560, 0.42];
const HOLE = typeof CSS !== 'undefined' && !!CSS.supports?.('clip-path', 'path(evenodd, "M0 0H1V1Z")');

const STYLE = `
@media ${PHONE}{
/* stronger than the old white 白金 dock rules, so the glass shows through */
html:root body .app-dock.glass-nav.glass-nav.glass-nav.glass-nav.glass-nav.glass-nav{height:56px!important;min-height:56px!important;grid-template-rows:46px!important;background:none!important;background-image:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;border-color:transparent!important;box-shadow:none!important;overflow:visible!important;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
html:root body .app-dock.glass-nav.glass-nav.glass-nav::before,html:root body .app-dock.glass-nav.glass-nav.glass-nav::after{display:none!important}
html:root body .app-dock.glass-nav.glass-nav > span.ox-dock-indicator.ox-dock-indicator.ox-dock-indicator{display:none!important}
html:root body .app-dock.glass-nav.glass-nav.glass-nav > .dock-btn.dock-btn{height:46px!important;min-height:46px!important;background:transparent!important;box-shadow:none!important;border-color:transparent!important;position:relative;z-index:2}
html:root body .app-dock.glass-nav.glass-nav .dock-btn.dock-btn::before{display:none!important}
html:root body .app-dock.glass-nav.glass-nav .dock-btn > span:not(.dock-icon):not(.dock-radar-orb),html:root body .app-dock.glass-nav.glass-nav .dock-radar-label{font-size:11px!important;font-weight:500!important;letter-spacing:0}
/* the bar: clear glass that lifts what is behind it a little, a lit rim that
   catches light at the top-left and bottom-right, and a soft edge band where the
   background is bent (blurred and brighter), like the lip of a thick lens */
.oc-bar{position:absolute;inset:0;z-index:0;border-radius:999px;pointer-events:none;
 background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.03) 55%,rgba(255,255,255,.06)),rgba(16,18,22,.16);
 -webkit-backdrop-filter:blur(3px) saturate(1.8) brightness(1.12);backdrop-filter:blur(3px) saturate(1.8) brightness(1.12);
 box-shadow:0 0 0 .5px rgba(0,0,0,.35),0 10px 26px rgba(0,0,0,.3),0 2px 6px rgba(0,0,0,.16)}
.oc-bar::before{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(45% 120% at 12% -40%,rgba(255,255,255,.14),rgba(255,255,255,0) 60%),radial-gradient(40% 110% at 90% 150%,rgba(255,255,255,.07),rgba(255,255,255,0) 60%)}
.oc-bar::after{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;box-sizing:border-box;
 background:linear-gradient(118deg,rgba(255,255,255,.72),rgba(255,255,255,.2) 20%,rgba(255,255,255,.05) 42%,rgba(255,255,255,.05) 62%,rgba(255,255,255,.24) 84%,rgba(255,255,255,.58));
 -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}
.oc-rim{position:absolute;inset:0;z-index:0;border-radius:999px;pointer-events:none;
 -webkit-backdrop-filter:blur(5px) saturate(1.6) brightness(1.28);backdrop-filter:blur(5px) saturate(1.6) brightness(1.28);
 -webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}
body.theme-light .oc-bar{background:linear-gradient(180deg,rgba(255,255,255,.38),rgba(255,255,255,.2)),rgba(255,255,255,.06);
 -webkit-backdrop-filter:blur(3px) saturate(1.9) brightness(1.1);backdrop-filter:blur(3px) saturate(1.9) brightness(1.1);
 box-shadow:0 0 0 .5px rgba(0,0,0,.08),0 10px 26px rgba(20,20,30,.1),0 2px 6px rgba(20,20,30,.06)}
body.theme-light .oc-bar::before{background:radial-gradient(45% 120% at 12% -40%,rgba(255,255,255,.7),rgba(255,255,255,0) 60%)}
body.theme-light .oc-bar::after{background:linear-gradient(118deg,#fff,rgba(255,255,255,.75) 22%,rgba(255,255,255,.35) 45%,rgba(255,255,255,.35) 60%,rgba(255,255,255,.75) 82%,#fff)}
body.theme-light .oc-rim{-webkit-backdrop-filter:blur(5px) saturate(1.5) brightness(1.06);backdrop-filter:blur(5px) saturate(1.5) brightness(1.06)}
/* 畫板 keeps its whole logo in the thinner bar; labels a touch smaller */
html:root body .app-dock.glass-nav.glass-nav.glass-nav > .dock-radar.dock-btn{padding-top:2px!important;padding-bottom:2px!important;gap:2px!important}
html:root body .app-dock.glass-nav.glass-nav .dock-radar .dock-radar-orb{flex:none!important;width:28px!important;height:28px!important;min-height:28px!important}
/* the lens */
.oc-lens{position:absolute;inset:0;z-index:1;pointer-events:none}
.oc-lb,.oc-le{position:absolute;left:0;top:0;width:${MW}px;height:${MH}px;border-radius:999px;transform-origin:50% 50%;will-change:transform,opacity}
.oc-lt{position:absolute;inset:0;border-radius:inherit;background:rgba(255,255,255,.12);box-shadow:inset 0 .6px 0 rgba(255,255,255,.3)}
body.theme-light .oc-lt{background:rgba(0,0,0,.06);box-shadow:inset 0 .6px 0 rgba(255,255,255,.95)}
.oc-le{opacity:0;background:radial-gradient(90% 70% at 50% 16%,rgba(255,255,255,.11),rgba(255,255,255,0) 62%);
 box-shadow:0 0 0 .6px rgba(0,0,0,.45),inset 0 0 0 .6px rgba(255,255,255,.28),inset 2px 3px 2px -2px rgba(255,255,255,.8),inset -2px -3px 2px -2px rgba(255,255,255,.4),inset 0 10px 9px -9px rgba(0,0,0,.3),inset 0 -10px 9px -9px rgba(0,0,0,.24),0 6px 16px rgba(0,0,0,.26)}
body.theme-light .oc-le{background:radial-gradient(90% 70% at 50% 16%,rgba(255,255,255,.5),rgba(255,255,255,0) 62%);
 box-shadow:0 0 0 .6px rgba(0,0,0,.2),inset 0 0 0 .6px rgba(255,255,255,.7),inset 2px 3px 2px -2px #fff,inset -2px -3px 2px -2px rgba(255,255,255,.8),inset 0 10px 9px -9px rgba(0,0,0,.1),inset 0 -10px 9px -9px rgba(0,0,0,.08),0 6px 16px rgba(30,30,40,.14)}
/* rainbow where the light bends: strongest at the two ends, clear at top and bottom */
.oc-lc{position:absolute;inset:-.3px;border-radius:inherit;padding:2px;box-sizing:border-box;opacity:.55;
 background:conic-gradient(from 0deg,rgba(80,210,255,0),rgba(80,210,255,.3) 8%,rgba(140,90,255,.55) 16%,rgba(255,80,150,.6) 24%,rgba(255,175,60,.5) 32%,rgba(110,255,170,.3) 40%,rgba(110,255,170,0) 47%,rgba(80,210,255,0) 53%,rgba(80,210,255,.35) 60%,rgba(150,90,255,.6) 68%,rgba(255,85,140,.6) 76%,rgba(255,190,70,.5) 84%,rgba(100,255,170,.3) 92%,rgba(80,210,255,0));
 -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}
body.theme-light .oc-lc{opacity:.42}
.oc-lv{position:absolute;left:-${PAD}px;top:-${PAD}px;right:-${PAD}px;bottom:-${PAD}px;visibility:hidden}
.oc-lr{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:0 0;will-change:transform}
.oc-cl{position:absolute;display:block}.oc-cl,.oc-cl *{transition:none!important;animation:none!important}
/* crypto: the motion layer makes every child of a glass panel position:relative; the glass layers stay out of the grid */
html body .app-dock.glass-nav > :is(.oc-bar,.oc-rim,.oc-lens){position:absolute!important}
}
`;

export function initDockGlass() {
  const dock = document.querySelector('.app-dock.glass-nav'); if (!dock) return;
  const style = document.createElement('style'); style.id = 'oc-dock-glass'; style.textContent = STYLE; document.head.append(style);
  const el = (cls, parent) => { const n = document.createElement('span'); n.className = cls; parent?.append(n); return n; };
  const bar = el('oc-bar'), rim = el('oc-rim'), lens = el('oc-lens');
  const base = el('oc-lb', lens), tint = el('oc-lt', base), view = el('oc-lv', lens), row = el('oc-lr', view), edge = el('oc-le', lens); el('oc-lc', edge);
  lens.setAttribute('aria-hidden', 'true'); lens.inert = true; bar.setAttribute('aria-hidden', 'true'); rim.setAttribute('aria-hidden', 'true');
  dock.prepend(bar, rim, lens);
  const phone = matchMedia(PHONE), still = matchMedia('(prefers-reduced-motion:reduce)');
  const btns = () => [...dock.querySelectorAll(':scope > .dock-btn')];
  const active = () => dock.querySelector(':scope > .dock-btn.active');
  let rects = new Map(), clones = new Map(), W = 0, H = 0;

  // The magnified icons are a copy of the real ones, shown only inside the lens.
  function measure() {
    W = dock.clientWidth; H = dock.clientHeight;
    // The edge band: a soft ring hugging the rim, drawn once per size.
    const ring = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'><filter id='f' x='-10%' y='-30%' width='120%' height='160%'><feGaussianBlur stdDeviation='2'/></filter><rect x='2.5' y='2.5' width='${W - 5}' height='${H - 5}' rx='${H / 2 - 2.5}' fill='none' stroke='#fff' stroke-width='5' filter='url(#f)'/></svg>`;
    rim.style.webkitMaskImage = rim.style.maskImage = `url("data:image/svg+xml,${encodeURIComponent(ring)}")`;
    rects = new Map(btns().map(b => [b, { x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight }]));
    row.replaceChildren(); clones = new Map();
    for (const [b, k] of rects) {
      const wrap = el('oc-cl', row); wrap.style.cssText = `left:${k.x + PAD}px;top:${k.y + PAD}px;width:${k.w}px;height:${k.h}px`;
      const c = b.cloneNode(true);
      c.removeAttribute('data-view-target'); c.removeAttribute('id'); c.removeAttribute('aria-current'); c.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
      c.tabIndex = -1; c.style.cssText = 'position:static!important;display:flex;width:100%!important;height:100%!important;margin:0!important;transform:none!important;clip-path:none!important;pointer-events:none';
      wrap.append(c); clones.set(b, c);
    }
  }
  const mirror = () => { for (const [b, c] of clones) c.className = b.className; };
  const center = b => { const k = rects.get(b); return k ? k.x + k.w / 2 : 0; };

  // Spring state: x (centre), L (lift 0..1), J (jiggle: wide vs tall), s (stretch from speed)
  let x = 0, vx = 0, tx = 0, L = 0, vL = 0, tL = 0, J = 0, vJ = 0, s = 0, mode = TAP, running = false, last = 0;
  let press = null, magnify = false, quietUntil = 0;
  const damp = ([k, z]) => 2 * z * Math.sqrt(k);
  function frame(now) {
    const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000) || 1 / 60); last = now;
    const lift = tL > L ? RISE : FALL;
    const [kx] = mode, cx = damp(mode), [kl] = lift, cl = damp(lift), [kj] = JIGGLE, cj = damp(JIGGLE);
    for (let t = dt; t > 1e-6; t -= 1 / 240) {
      const h = Math.min(t, 1 / 240);
      vx += (-kx * (x - tx) - cx * vx) * h; x += vx * h;
      vL += (-kl * (L - tL) - cl * vL) * h; L += vL * h;
      vJ += (-kj * J - cj * vJ) * h; J += vJ * h;
    }
    s += (Math.min(0.22, Math.abs(vx) / 2600) - s) * Math.min(1, dt * 20);
    // The magnifier goes off once, when a released lens has nearly landed.
    if (magnify && !press && L < 0.06) magnify = false;
    draw();
    const rest = Math.abs(x - tx) < 0.05 && Math.abs(vx) < 0.5 && Math.abs(L - tL) < 0.002 && Math.abs(vL) < 0.01 && Math.abs(J) < 0.002 && Math.abs(vJ) < 0.02 && s < 0.002;
    if (rest) { x = tx; L = tL; vx = vL = J = vJ = s = 0; if (!press) magnify = false; draw(); running = false; } else requestAnimationFrame(frame);
  }
  function wake() {
    if (still.matches) { x = tx; L = tL; vx = vL = J = vJ = s = 0; if (!press) magnify = false; draw(); return; }
    if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
  }

  const f1 = n => n.toFixed(1), f4 = n => n.toFixed(4);
  function hole(x0, y0, w, h, rx, ry, bw, bh) {
    return `path(evenodd, "M-300 -300H${f1(bw + 300)}V${f1(bh + 300)}H-300Z M${f1(x0 + rx)} ${f1(y0)}H${f1(x0 + w - rx)}A${f1(rx)} ${f1(ry)} 0 0 1 ${f1(x0 + w - rx)} ${f1(y0 + h)}H${f1(x0 + rx)}A${f1(rx)} ${f1(ry)} 0 0 1 ${f1(x0 + rx)} ${f1(y0)}Z")`;
  }
  function draw() {
    const l = Math.max(-0.15, Math.min(1.25, L)), lift = Math.max(0, Math.min(1, l));
    const sx = Math.max(0.2, (RW + (MW - RW) * l) / MW * (1 + s + J)), sy = Math.max(0.2, (RH + (MH - RH) * l) / MH * (1 - s * 0.4 - J * 0.7));
    const cy = H / 2;
    const tr = `translate3d(${f1(x - MW / 2)}px,${f1(cy - MH / 2)}px,0) scale(${f4(sx)},${f4(sy)})`;
    base.style.transform = tr; edge.style.transform = tr;
    tint.style.opacity = f4(1 - lift); edge.style.opacity = f4(Math.min(1, lift * 1.15));
    const lw = MW * sx, lh = MH * sy, lx = x - lw / 2, ly = cy - lh / 2, rx = MH / 2 * sx, ry = lh / 2;
    const on = HOLE && magnify;
    if (on) {
      // Magnification fades to exactly 1 as the lens lands, so the swap back to the real icons is invisible.
      const m = 1 + ZOOM * lift * lift, ox = x + PAD, oy = cy + PAD;
      if (view.style.visibility !== 'visible') view.style.visibility = 'visible';
      view.style.clipPath = `inset(${f1(ly + PAD)}px ${f1(W + PAD - lx - lw)}px ${f1(H + PAD - ly - lh)}px ${f1(lx + PAD)}px round ${f1(rx)}px / ${f1(ry)}px)`;
      row.style.transform = `translate3d(${f1(ox * (1 - m))}px,${f1(oy * (1 - m))}px,0) scale(${f4(m)})`;
    } else if (view.style.visibility !== 'hidden') view.style.visibility = 'hidden';
    // The real icons step aside inside the lens, so the magnified copy shows alone.
    for (const [b, k] of rects) {
      const hit = on && lx < k.x + k.w && lx + lw > k.x && ly < k.y + k.h && ly + lh > k.y;
      if (hit) b.style.clipPath = hole(lx - k.x, ly - k.y, lw, lh, rx, ry, k.w, k.h);
      else if (b.style.clipPath) b.style.clipPath = '';
    }
  }

  function snap() {
    if (!phone.matches) return;
    measure(); mirror();
    const a = active(); if (a) tx = center(a);
    if (!press) { x = tx; vx = 0; }
    draw();
  }
  // Any way a tab opens (a tap, a swipe, a link): the capsule glides over with a glint.
  document.addEventListener('ox:viewchange', () => requestAnimationFrame(() => {
    if (!phone.matches) return;
    mirror();
    const a = active(); if (!a || press) return;
    tx = center(a);
    if (performance.now() > quietUntil) { mode = TAP; if (Math.abs(tx - x) > 4) { tL = 0.24; setTimeout(() => { if (!press) { tL = 0; wake(); } }, 110); } }
    wake();
  }));
  new ResizeObserver(snap).observe(dock);
  phone.addEventListener?.('change', snap);
  requestAnimationFrame(snap);

  // Tap: open the tab (we click it ourselves; inside a lifted lens the real
  // button is clipped and would miss the browser's own click). Hold or slide:
  // the lens lifts and follows the finger; let go: it drops into a tab.
  const local = clientX => { const r = dock.getBoundingClientRect(), scale = r.width / Math.max(1, dock.offsetWidth); return (clientX - r.left) / scale; };
  const nearest = cx => btns().sort((a, b) => Math.abs(center(a) - cx) - Math.abs(center(b) - cx))[0];
  function swallowClicks() {
    // Only the browser's own click: a quick second tap within the window opens its tab too
    // (on the Taiwan site a tap less than 0.4 s after another was dropped).
    const swallow = ev => { if (ev.isTrusted && ev.target.closest?.('.app-dock')) { ev.stopPropagation(); ev.preventDefault(); } };
    document.addEventListener('click', swallow, true); setTimeout(() => document.removeEventListener('click', swallow, true), 400);
  }
  function lift() {
    if (!press || press.held) return;
    press.held = true; magnify = true; tL = 1; vJ -= 0.9; mode = FOLLOW; tx = press.x; wake();
  }
  dock.addEventListener('pointerdown', e => {
    if (!phone.matches || e.button > 0) return;
    const b = e.target.closest('.dock-btn'); if (!b || b.parentElement !== dock) return;
    press = { id: e.pointerId, sx: e.clientX, btn: b, x: center(b), moved: false, held: false, timer: setTimeout(lift, HOLD_MS) };
  });
  dock.addEventListener('pointermove', e => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.moved) { if (Math.abs(e.clientX - press.sx) < 8) return; press.moved = true; try { dock.setPointerCapture(e.pointerId); } catch {} }
    const k = [...rects.values()], lo = k[0] ? k[0].x + 6 : 0, hi = k.length ? k.at(-1).x + k.at(-1).w - 6 : W;
    press.x = Math.max(lo, Math.min(hi, local(e.clientX)));
    if (!press.held) lift();
    tx = press.x; mode = FOLLOW; wake();
  });
  dock.addEventListener('pointerup', e => {
    if (!press || e.pointerId !== press.id) return;
    const p = press; press = null; clearTimeout(p.timer);
    if (!p.held) {                      // a plain tap
      // Our click goes first; the browser's own click right after is dropped. The active tab still gets it (scroll to top).
      p.btn.click(); swallowClicks();
      if (p.btn.classList.contains('active')) { tx = center(p.btn); wake(); }
      return;
    }
    quietUntil = performance.now() + 400;
    // Where the finger is, not where the lens has got to.
    const pick = nearest(tx);
    tx = center(pick); tL = 0; vJ += 1.1; mode = DROP; wake();
    if (!pick.classList.contains('active')) pick.click();
    swallowClicks();
  });
  dock.addEventListener('pointercancel', e => {
    if (!press || e.pointerId !== press.id) return;
    clearTimeout(press.timer); press = null; tL = 0; mode = DROP; const a = active(); if (a) tx = center(a); wake();
  });
}

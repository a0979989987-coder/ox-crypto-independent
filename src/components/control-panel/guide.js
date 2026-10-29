// 使用說明 at the bottom of 設定: picture pages swiped sideways, with a 1 / N
// counter and dots. Pictures come from src/assets/guide/, listed in
// src/assets/guide/manifest.json as {"pages":[{"src":"guide-01.webp","alt":"…"}]}.
// The section stays hidden while the list is empty, and nothing is downloaded
// until 設定 is opened for the first time.
(() => {
  'use strict';
  const section = document.getElementById('ox-settings-guide');
  if (!section) return;
  const base = new URL('../../assets/guide/', document.currentScript?.src || new URL('src/components/control-panel/guide.js', location.href));
  let loading = null;

  function build(pages) {
    const total = pages.length;
    const top = document.createElement('div'); top.className = 'ox-guide-top';
    const title = document.createElement('h3'); title.className = 'ox-guide-title'; title.textContent = '使用說明';
    const count = document.createElement('span'); count.className = 'ox-guide-count'; count.setAttribute('aria-live', 'polite');
    top.append(title, count);
    const track = document.createElement('div'); track.className = 'ox-guide-track'; track.tabIndex = 0;
    track.setAttribute('aria-label', '使用說明圖片，左右滑動翻頁');
    for (const page of pages) {
      const figure = document.createElement('figure'); figure.className = 'ox-guide-slide';
      const img = document.createElement('img');
      img.alt = String(page.alt || '使用說明'); img.width = Number(page.width) || 1080; img.height = Number(page.height) || 1350;
      img.loading = 'lazy'; img.decoding = 'async'; img.src = new URL(String(page.src), base).href;
      figure.append(img); track.append(figure);
    }
    const dots = document.createElement('div'); dots.className = 'ox-guide-dots'; dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < total; i++) dots.append(document.createElement('i'));
    const sync = () => {
      const index = Math.min(total - 1, Math.max(0, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
      count.textContent = `${index + 1} / ${total}`;
      [...dots.children].forEach((dot, i) => dot.classList.toggle('on', i === index));
    };
    track.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
    track.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      track.scrollBy({ left: (event.key === 'ArrowRight' ? 1 : -1) * track.clientWidth, behavior: 'smooth' });
    });
    section.replaceChildren(top, track, dots);
    section.hidden = false;
    sync();
  }

  function load() {
    loading ||= fetch(new URL('manifest.json', base), { cache: 'no-cache' })
      .then(response => response.ok ? response.json() : { pages: [] })
      .then(data => {
        const pages = Array.isArray(data?.pages) ? data.pages.filter(page => page && typeof page.src === 'string' && page.src) : [];
        if (pages.length) build(pages); else section.hidden = true;
      })
      .catch(() => { section.hidden = true; loading = null; });
    return loading;
  }

  document.addEventListener('ox:viewchange', event => { if (event.detail?.to === 'settings') load(); });
  if (document.body?.dataset.view === 'settings') load();
})();

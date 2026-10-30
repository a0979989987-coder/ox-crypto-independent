// Shared pieces of the app chrome (top bar, its sheets, the left drawer, the
// drawer's pages and the 個股 bar): line icons, the guest avatar and the OX mark.
// Their look lives in src/styles/components/app-shell.css, loaded with the page,
// so the top bar paints with the first frame.
export const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  back: '<path d="m15 5-7 7 7 7"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4Z"/>', book: '<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4Z"/><path d="M9 8h6"/>',
  group: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 5 5.5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6M12 16.8h.01"/>',
  journal: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  google: '<path d="M21 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5a4.3 4.3 0 0 1-1.9 2.8v2.3h3A9 9 0 0 0 21 12.2Z"/><path d="M12 21c2.4 0 4.5-.8 6-2.2l-3-2.3a5.6 5.6 0 0 1-8.3-2.9H3.6v2.4A9 9 0 0 0 12 21Z"/><path d="M6.7 13.6a5.4 5.4 0 0 1 0-3.4V7.8H3.6a9 9 0 0 0 0 8.2Z"/><path d="M12 6.5c1.3 0 2.5.5 3.5 1.4l2.6-2.6A9 9 0 0 0 3.6 7.8l3.1 2.4A5.4 5.4 0 0 1 12 6.5Z"/>',
  tool: '<path d="M4 19h16"/><path d="m5 15 4-5 4 3 6-7"/>', radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M12 12 18 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>', calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16Z"/><path d="m14 6 3 3"/>', share: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  bubbles: '<circle cx="8.5" cy="10" r="4.5"/><circle cx="16.5" cy="15" r="3.5"/><circle cx="16" cy="6" r="2"/>', flame: '<path d="M13 3c1 5-4 6-3 10 2-1 3-3 3-3 4 3 5 5 4 8-1 3-7 4-10 0-3-5 2-8 6-15Z"/>',
  megaphone: '<path d="M4 10v4h3l7 4V6L7 10Z"/><path d="M17 9a4 4 0 0 1 0 6"/>', spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  rank: '<path d="M6 20V11M12 20V5M18 20v-6"/>'
};
// The guest avatar: a person, kept apart from the OX mark used by 畫板.
export const PERSON = '<svg class="oc-person" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="15" r="6.6"/><path d="M7.5 34.5c1.6-6.6 6.6-10.4 12.5-10.4s10.9 3.8 12.5 10.4"/></svg>';
// The OX mark (OX Journal page).
export const LOGO = '<svg class="oc-logo" viewBox="0 0 980 980" aria-hidden="true"><path class="d" d="M534 16L503 8L476 8L461 11L434 22L93 221L78 232L64 246L57 255L45 277L38 301L36 332L36 663L41 693L53 719L74 745L93 759L180 812L190 812L196 809L202 802L207 788L207 557L211 532L216 515L232 481L251 454L272 431L326 378L361 353L394 337L432 326L468 322L501 324L524 329L545 337L564 347L582 360L619 397L634 405L647 408L668 407L690 398L703 388L711 379L722 359L727 335L727 187L724 163L715 140L701 120L687 107L584 44Z"/><path class="b" d="M800 168L789 168L782 172L774 185L772 196L773 399L770 428L762 458L746 494L729 521L680 576L652 602L625 622L590 641L556 652L518 657L481 655L459 650L433 640L410 627L398 618L371 590L362 583L351 577L338 573L312 574L291 583L277 594L269 603L259 621L253 644L253 796L257 816L266 838L278 855L298 873L444 961L460 967L480 971L512 969L536 961L885 760L903 747L912 738L925 721L934 704L940 686L943 663L943 317L941 299L936 281L928 264L919 250L905 234L887 220Z"/></svg>';
export const icon = (name, cls = 'oc-i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
export const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// The signed-in member's picture or initial, else the person.
export function avatarHTML(member = globalThis.OXMember?.member) {
  if (member?.picture) return `<img src="${escapeHTML(member.picture)}" alt="" referrerpolicy="no-referrer">`;
  return member ? `<b>${escapeHTML((member.name || member.email || '').trim().slice(0, 1))}</b>` : PERSON;
}
// The crypto runtime (classic scripts) keeps its state in a global binding.
export const runtime = () => { try { return typeof state !== 'undefined' ? state : null; } catch { return null; } };
export const coinOf = symbol => String(symbol || '').replace(/USDT$/, '');
// A tradable USDT perpetual of the radar universe (leveraged/test contracts are filtered by the runtime).
export const allowed = symbol => { try { return typeof isCryptoSymbolAllowed !== 'function' || isCryptoSymbolAllowed(symbol); } catch { return true; } };
export const tickers = () => (runtime()?.tickers || []).filter(t => t?.symbol && allowed(t.symbol));
// Opens a coin's 個股 page (switchSymbol owns that step).
export function openCoin(symbol) { if (symbol && typeof window.switchSymbol === 'function') window.switchSymbol(symbol); }
export function toast(text) {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = text; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

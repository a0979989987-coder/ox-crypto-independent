import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function informationEntryHarness(market = 'crypto') {
  const events = new Map(), opened = [], scheduled = [];
  const entries = ['desktop', 'mobile'].map(surface => ({
    surface, dataset:{}, attributes:new Map(), listeners:new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener(type, callback) {
      const handlers = this.listeners.get(type) || [];
      handlers.push(callback); this.listeners.set(type, handlers);
    },
  }));
  const document = {
    readyState:'loading', body:{dataset:{market}},
    querySelectorAll:() => entries,
    addEventListener:(type, callback) => events.set(type, callback),
    createElement() { assert.fail('Information must not create a popup'); },
  };
  const window = {OXNews:{openMarket:() => opened.push(document.body.dataset.market)}};
  const context = vm.createContext({document, window, setTimeout:fn => scheduled.push(fn)});
  vm.runInContext(await readFile(new URL('../src/components/news/entry.js', import.meta.url), 'utf8'), context);
  events.get('DOMContentLoaded')();
  return {document, entries, events, opened, scheduled};
}

test('desktop and mobile Information clicks immediately open the currently selected market', async () => {
  const {document, entries, opened, scheduled} = await informationEntryHarness();
  for (const market of ['crypto','crypto']) {
    document.body.dataset.market = market;
    for (const entry of entries) {
      let prevented = false, stopped = false;
      entry.listeners.get('click')[0]({detail:1, preventDefault(){prevented=true;}, stopImmediatePropagation(){stopped=true;}});
      assert.equal(opened.at(-1), market, `${entry.surface} uses the current market`);
      assert.ok(prevented && stopped, 'one action owns navigation without duplicate bubbling');
    }
  }
  assert.equal(opened.length, 4);
  assert.equal(scheduled.length, 0, 'single-click navigation has no double-tap delay');
});

test('Information exposes one label and has no hover, long-press, double-tap or keyboard menu', async () => {
  const {entries, events, opened} = await informationEntryHarness('crypto');
  events.get('DOMContentLoaded')();
  for (const entry of entries) {
    assert.equal(entry.attributes.get('aria-label'), '資訊');
    assert.equal(entry.attributes.has('aria-haspopup'), false);
    assert.deepEqual([...entry.listeners.keys()], ['click']);
    assert.equal(entry.listeners.get('click').length, 1, 'rebinding cannot duplicate navigation');
    entry.listeners.get('click')[0]({detail:0, preventDefault(){}, stopImmediatePropagation(){}});
  }
  assert.deepEqual(opened, ['crypto','crypto'], 'keyboard activation uses the same direct action');
});

test('leaving news for settings restores market navigation and supports history', async () => {
  const documentEvents = new Map(), windowEvents = new Map(), entries = [];
  let view = 'media';
  const body = { dataset: { market: 'crypto', newsMode: '0' } };
  const history = { state: null, pushState(state, _, url) { this.state = state; entries.push({ state, url }); } };
  const document = {
    body,
    addEventListener(type, callback) { documentEvents.set(type, callback); },
    getElementById() { return null; },
    querySelector(selector) { return selector === '.app-view.active' ? { dataset: { appView: view } } : null; },
    querySelectorAll() { return []; }
  };
  const window = {
    scrollY: 180,
    addEventListener(type, callback) { windowEvents.set(type, callback); },
    scrollTo() {},
    switchAppView(next) { view = next; documentEvents.get('ox:viewchange')?.({ detail: { to: next } }); }
  };
  const context = vm.createContext({ document, window, history,
    location: { hash: '', pathname: '/ox/', search: '' },
    localStorage: { getItem() { return null; } },
    requestAnimationFrame: callback => callback(), AbortController, setTimeout, clearTimeout,
    fetch: async () => ({ ok: true, json: async () => ({ schemaVersion: 1, news: [], events: [] }) })
  });
  vm.runInContext(await readFile(new URL('../src/components/news/center.js', import.meta.url), 'utf8'), context);
  assert.equal(window.OXNews.unlockCountdown({ status: 'date-only', date: '2026-10-12' }, new Date('2026-09-25T02:00:00Z')), '距官方預估日期 17 天・時間待公布');
  assert.equal(window.OXNews.unlockCountdown({ status: 'confirmed', occursAt: '2026-09-26T02:00:00Z' }, new Date('2026-09-25T02:00:00Z')), '倒數 1 天 00:00:00');
  window.OXNews.open();
  await window.OXNews.refresh();
  const newsEntry = entries.at(-1).state;
  assert.equal(body.dataset.newsMode, '1');
  window.switchAppView('settings');
  assert.equal(body.dataset.newsMode, '0');
  assert.equal(entries.at(-1).url, '/ox/');
  assert.equal(entries.at(-1).state.oxView, 'settings');
  windowEvents.get('popstate')({ state: newsEntry });
  assert.equal(view, 'news');
  assert.equal(body.dataset.newsMode, '1');
  windowEvents.get('popstate')({ state: { oxView: 'settings' } });
  assert.equal(view, 'settings');
  assert.equal(body.dataset.newsMode, '0');
  assert.equal(entries.length, 2, 'history navigation must not create extra entries');
});

test('date-only unlock count is stable across browser timezones', async () => {
  const document = { body: { dataset: {} }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const window = { addEventListener() {} };
  const context = vm.createContext({ document, window, location: { hash: '' }, localStorage: { getItem: () => null } });
  vm.runInContext(await readFile(new URL('../src/components/news/center.js', import.meta.url), 'utf8'), context);
  const countdown = window.OXNews.unlockCountdown;
  assert.equal(countdown({status:'date-only',date:'2026-10-12'}, new Date('2026-09-25T17:00:00Z')), '距官方預估日期 16 天・時間待公布');
  assert.equal(countdown({status:'confirmed',occursAt:'2026-09-26T17:00:00Z'}, new Date('2026-09-25T17:00:01Z')), '倒數 0 天 23:59:59');
});

test('direct news URL owns its base history entry so Back stays in the calendar', async()=>{
 const docEvents=new Map(),winEvents=new Map();let view='radar';
 const body={dataset:{market:'crypto',newsMode:'0'}};
 const history={state:null,replaceState(value){this.state=value;}};
 const document={readyState:'loading',body,addEventListener:(k,v)=>docEvents.set(k,v),querySelector:s=>s==='.app-view.active'?{dataset:{appView:view}}:null};
 const window={scrollY:0,scrollTo(){},addEventListener:(k,v)=>winEvents.set(k,v),switchAppView:v=>{view=v;}};
 const context=vm.createContext({document,window,history,location:{pathname:'/',search:'',hash:'#news/crypto'},localStorage:{getItem:()=>null},URLSearchParams,AbortController,setTimeout:fn=>{fn();return 1;},clearTimeout(){},requestAnimationFrame:fn=>fn(),fetch:async()=>({ok:true,json:async()=>({schemaVersion:1,news:[],events:[]})})});
 vm.runInContext(await readFile(new URL('../src/components/news/center.js',import.meta.url),'utf8'),context);
 docEvents.get('DOMContentLoaded')();
 assert.equal(history.state.oxView,'data');assert.equal(history.state.oxMarket,'crypto');assert.equal(history.state.oxMarketNews,true);
 const base=history.state;view='radar';winEvents.get('popstate')({state:base});assert.equal(view,'data');
});

for (const market of ['crypto', 'all']) test(`reloading ${market} event preserves deep link and history through radar boot`, async () => {
 const docEvents=new Map(), pending=[];let view='radar', pushes=0;
 const route={day:'2026-10-02',event:'real-event-id'};
 const hash=(market==='all'?'#news':`#news/${market}`)+'?date=2026-10-02&event=real-event-id';
 const location={pathname:'/',search:'',hash};
 const previous={view:'home',market:'crypto',scroll:75};
 const history={state:{oxNews:market==='all',oxMarketNews:market!=='all',oxView:market==='all'?'news':'data',oxMarket:market==='all'?'crypto':market,oxPrevious:previous,oxNewsDepth:2,oxNewsRoute:route},
   replaceState(value,_,url){this.state=value;location.hash=new URL(url,'https://example.test').hash;},
   pushState(value,_,url){pushes++;this.replaceState(value,_,url);}};
 const body={dataset:{market:market==='all'?'crypto':market,newsMode:'0'}};
 const document={readyState:'loading',body,addEventListener:(k,v)=>docEvents.set(k,v),querySelector:s=>s==='.app-view.active'?{dataset:{appView:view}}:null};
 const window={scrollY:0,scrollTo(){},addEventListener(){},switchAppView(v){view=v;docEvents.get('ox:viewchange')?.({detail:{to:v}});}};
 const context=vm.createContext({document,window,history,location,localStorage:{getItem:()=>null},URLSearchParams,AbortController,setTimeout(fn,ms){if(ms===0)pending.push(fn);return 1;},clearTimeout(){},requestAnimationFrame:fn=>fn(),fetch:async()=>({ok:true,json:async()=>({schemaVersion:1,news:[],events:[]})})});
 vm.runInContext(await readFile(new URL('../src/components/news/center.js',import.meta.url),'utf8'),context);
 docEvents.get('DOMContentLoaded')();
 window.switchAppView('radar'); // runtime-boot's window DOMContentLoaded listener
 assert.equal(pushes,0,'boot must not add a history entry or erase the event hash');
 pending.shift()();
 assert.equal(location.hash,hash);
 assert.equal(view,market==='all'?'news':'data');
 assert.equal(JSON.stringify(history.state.oxNewsRoute),JSON.stringify(route));
 assert.equal(history.state.oxNewsDepth,2);
 assert.equal(history.state.oxPrevious,previous);
});

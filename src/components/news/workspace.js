import {localizeNewsText} from './localization.js';
import { createToolsRail } from '../strength/tools-rail.js?v=20261005-stable18';
import { MARKET_NAMES, CATEGORY_NAMES, MARKET_CATEGORIES, TIME_CHOICES, sourceName } from './config.js?v=20261005-calendar11';
import { defaultState, taipeiDay, validDate, monthGrid, shiftMonth, eventDay, eventCategory, importance, matchesImportance, newsBase, filterNews, hotWords, ranking, sourcesFor, coverage, safeLink, plain, agendaDays, inMarket, upcomingEventDays } from './model.js?v=20261005-load16';
import { macroResult, macroValue } from './macro.js?v=20261005-macro1';
import { node, button, anchoredPanel, modal } from './layers.js';
const newsDateFormatter = new Intl.DateTimeFormat('zh-TW', { timeZone:'Asia/Taipei', dateStyle:'short', timeStyle:'short', hour12:false });
const fmt = value => Number.isFinite(Date.parse(value)) ? newsDateFormatter.format(new Date(value)) : '時間待確認';
const label = item => localizeNewsText(item.titleZh || (/[\u4e00-\u9fff]/.test(item.title||'') ? item.title : '中文翻譯準備中'));
const calendarTone = category => ({ macro: 'red', regulation: 'red', unlock: 'yellow', 'dividend-preview': 'yellow', payment: 'yellow', dividend: 'green', earnings: 'blue', exchange: 'blue', listing: 'blue', network: 'blue', governance: 'green', airdrop: 'green', burn: 'gray', holiday: 'gray' }[category] || 'gray');
const statusLabel = item => item.announcementStatus === 'cancelled' ? '已取消' : item.announcementStatus === 'estimated' || item.kind === 'token-unlock' && item.date ? '預估排程' : item.announcementStatus === 'announced' ? '媒體所列排程' : item.announcementStatus === 'preview' ? '預告' : item.status === 'confirmed' || item.announcementStatus === 'confirmed' ? '已公告' : '狀態待確認';
const sourceState = source => source.access === 'authorization-required' ? '需取得授權' : source.status === 'not-connected' ? '尚未接入' : source.status === 'error' ? '更新失敗' : source.lastSuccessAt && Date.now() - Date.parse(source.lastSuccessAt) > 18 * 3600000 ? '資料過期' : source.status === 'ready' && source.count === 0 ? '成功・零篇' : source.status === 'ready' ? source.access==='public-aggregated-rss'?'聚合接入':'已接入' : '尚未載入';
function link(text, url) { const safe = safeLink(url); if (!safe) return null; const a = node('a', '', text); a.href = safe; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
function fieldList(fields) { const list = node('dl', 'oxn-fields'); for (const [name, value] of fields) { list.append(node('dt', '', name), node('dd', '', value === null || value === undefined || value === '' ? '資料未提供' : plain(value))); } return list; }
export function mountNewsWorkspace(host, api) {
  const key = `ox-news-v2-${api.scope}`;
  let saved; try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch {}
  const state = { ...defaultState(), ...saved }, life = new AbortController();
  if(window.OXFeatures)state.tab=window.OXFeatures.newsTab;
  state.selectedDay = taipeiDay(); state.month = state.selectedDay.slice(0,7);
  if (saved?.timePresetVersion !== 2) { state.times = ['week']; state.customTime = null; state.timePresetVersion = 2; }
  if (state.importance !== true) state.importance = null;
  if (!Object.hasOwn(MARKET_NAMES, state.market)) state.market = 'all';
  let monthExpanded = false;
  let data = {}, panel = null, detail = null, detailKey = '', countdown = null, restorePosition = true;
  const root = node('section', 'oxn-root'); root.dataset.scope = api.scope;
  const header = node('div', 'oxn-header'), exit = button('‹', '返回先前頁面', api.exit, 'oxn-close');
  header.append(exit, node('span', 'oxn-title', api.scope === 'all' ? '新聞總頁' : `${MARKET_NAMES[api.scope]}新聞`));
  const marketChoice = button('全部市場', '篩選新聞總頁市場', () => showPanel(marketChoice, '市場', body => {
    const tags = node('div', 'oxn-tags'); for (const id of ['all', 'crypto']) { const tag = button(id === 'all' ? '全部市場' : MARKET_NAMES[id], '', () => { state.market = id; state.sources = null; state.categories = null; persist(); renderContent(); panel.destroy(); }); tag.setAttribute('aria-pressed', String(state.market === id)); tags.append(tag); } body.append(tags);
  }), 'oxn-pill'); if (api.scope === 'all') header.append(marketChoice);
  const more = button('⋯', '閱讀偏好與快照更新', () => showPanel(more, '閱讀偏好', body => {
    const tags = node('div', 'oxn-tags'); for (const [id, text] of [['all', '全部閱讀狀態'], ['unread', '僅未讀'], ['following', '追蹤來源']]) { const b = button(text, '', () => { state.reader = id; persist(); renderContent(); [...tags.children].forEach(n => n.setAttribute('aria-pressed', String(n === b))); }); b.setAttribute('aria-pressed', String((state.reader || 'all') === id)); tags.append(b); }
    body.append(tags, button('恢復隱藏新聞／來源', '', () => { api.save({ hidden: [], mutedSources: [] }); renderContent(); }, 'oxn-action'), button('更新來源快照', '', api.refresh, 'oxn-action'), node('p', 'oxn-caption', '資料依來源快照更新，並非即時串流；重新讀取會保留最後成功資料。'));
  }), 'oxn-close oxn-more'); header.append(more);
  const rail = createToolsRail({ tabs: [['calendar', '行事曆'], ['key', '關鍵新聞']], selected: state.tab, label: '新聞內容', attribute: 'data-news-tab', equal: true,
    onSelect(tab) { state.tab = tab; persist(); panel?.destroy({ focus: false }); renderControls(); renderContent(); } }); rail.element.classList.add('oxn-tabs');
  const controls = node('div', 'oxn-controls'), notification = node('div', 'oxn-notification'), content = node('div', 'oxn-content');
  root.append(header, rail.element, controls, notification, content); host.replaceChildren(root);
  const scope = () => api.scope === 'all' ? state.market : api.scope;
  function persist() { try { sessionStorage.setItem(key, JSON.stringify(state)); } catch {} }
  function closePanel() { panel?.destroy({ focus: false }); panel = null; }
  function showPanel(anchor, title, build) { if (panel?.element.isConnected && anchor.getAttribute('aria-expanded') === 'true') { closePanel(); return; } closePanel(); panel = anchoredPanel(anchor, title, build); }
  function multi(anchor, title, property, choices, defaults = null, footer = null) {
    showPanel(anchor, title, body => {
      const tools = node('div', 'oxn-panel-actions'), tags = node('div', 'oxn-tags');
      function sync() { all.setAttribute('aria-pressed', String(state[property] === null || property === 'times' && choices.every(c => state[property]?.includes(c.id)))); [...tags.children].forEach(b => b.setAttribute('aria-pressed', String(!b.disabled && state[property]?.includes(b.dataset.value)))); anchor.classList.toggle('is-filtered', JSON.stringify(state[property]) !== JSON.stringify(defaults)); }
      const all = button('全部', '', () => { state[property] = choices.filter(c => !c.disabled).map(c => c.id); if (property !== 'times') state[property] = null; persist(); sync(); renderContent(); }, 'oxn-action');
      const none = button('清除選取', '', () => { state[property] = []; persist(); sync(); renderContent(); }, 'oxn-action');
      const reset = button('恢復預設', '', () => { state[property] = defaults; persist(); sync(); renderContent(); }, 'oxn-action'); tools.append(all, none, reset); body.append(tools);
      for (const choice of choices) { const tag = button(choice.label, '', () => { const selected = new Set(state[property] || []); selected.has(choice.id) ? selected.delete(choice.id) : selected.add(choice.id); state[property] = [...selected]; persist(); sync(); renderContent(); }, 'oxn-tag'); tag.dataset.value = choice.id; tag.disabled = Boolean(choice.disabled); if (choice.hint) { tag.append(node('small', '', choice.hint)); tag.title = choice.description || choice.hint; } tags.append(tag); }
      body.append(tags); if (footer) body.append(node('p', 'oxn-caption', footer)); sync();
    });
  }
  function renderControls() {
    controls.replaceChildren(); header.querySelector('.oxn-calendar-switch')?.remove(); controls.dataset.tab = state.tab;
    if (state.tab === 'calendar') {
      const prev = button('‹', '上個月', () => changeMonth(-1), 'oxn-close oxn-month-arrow'), next = button('›', '下個月', () => changeMonth(1), 'oxn-close oxn-month-arrow');
      const month = button(state.month.replace('-', '／'), '選擇年份月份', () => showPanel(month, '選擇年月', body => {
        const row = node('div', 'oxn-year-row'), year = node('input'); year.type = 'number'; year.inputMode = 'numeric'; year.min = '1900'; year.max = '2200'; year.value = state.month.slice(0, 4); year.setAttribute('aria-label', '年份');
        row.append(button('‹', '前一年', () => { year.value = Math.max(1900, Number(year.value) - 1); }), year, button('›', '後一年', () => { year.value = Math.min(2200, Number(year.value) + 1); })); body.append(row);
        const months = node('div', 'oxn-month-picker'); for (let m = 1; m <= 12; m++) months.append(button(`${m} 月`, '', () => { const y = Number(year.value); if (y < 1900 || y > 2200 || !Number.isInteger(y)) return; state.month = `${y}-${String(m).padStart(2, '0')}`; persist(); closePanel(); renderControls(); renderContent(); })); body.append(months);
      }), 'oxn-pill oxn-month-title');
      const viewSwitch = button('切換', state.calendarView==='agenda'?'切換為月份格':'切換為行程列表', () => { state.calendarView=state.calendarView==='agenda'?'month':'agenda'; persist(); renderControls(); renderContent(); }, 'oxn-pill');
      viewSwitch.dataset.calendarSwitch='';viewSwitch.setAttribute('aria-pressed',String(state.calendarView==='agenda'));viewSwitch.title=state.calendarView==='agenda'?'目前：行程列表':'目前：月份格';
      const events = button('事件', '多選事件類別', () => {
        const c = coverage(data.snapshot, scope(), state.month).categories;
        multi(events, '事件類別', 'categories', MARKET_CATEGORIES[scope()].map(id => ({ id, label: CATEGORY_NAMES[id], hint: c.find(i => i.category === id)?.spans.length ? '有資料・覆蓋依月份' : c.find(i => i.category === id)?.known ? '部分排程' : c.find(i => i.category === id)?.connected.length ? '已接入・依來源排程' : '尚未接入' })), null, '沒有覆蓋的類別不會填入示範事件。');
      }, 'oxn-pill'); const level = button('重要性', '僅顯示重要事件', () => {
        state.importance = state.importance === true ? null : true; persist();
        // Retain the button so both directions of the glow transition can run.
        level.setAttribute('aria-pressed', String(state.importance === true));
        level.classList.toggle('is-filtered', state.importance === true);
        level.title = state.importance === true ? '目前僅顯示重要事件；點一下恢復全部' : '目前顯示全部事件；點一下只顯示重要事件';
        renderContent();
      }, 'oxn-pill oxn-importance-toggle');
      level.setAttribute('aria-pressed', String(state.importance === true));
      level.title = state.importance === true ? '目前僅顯示重要事件；點一下恢復全部' : '目前顯示全部事件；點一下只顯示重要事件';
      events.classList.toggle('is-filtered', state.categories !== null); level.classList.toggle('is-filtered', state.importance !== null);
      const monthNav = node('div', 'oxn-month-nav'); monthNav.append(prev, month, next);
      viewSwitch.classList.add('oxn-calendar-switch');
      controls.append(monthNav);
      if (innerWidth > 600) controls.append(viewSwitch);
      controls.append(events, level);
    } else {
      const time = button('時間', '多選新聞時間', () => showPanel(time, '時間', body => {
        body.classList.add('oxn-time-panel');
        const actions=node('div','oxn-panel-actions'), tags=node('div','oxn-tags oxn-time-options'), form=node('form','oxn-custom-time');
        const from=node('input'),to=node('input'),message=node('p','oxn-caption');from.type=to.type='date';from.setAttribute('aria-label','開始日期');to.setAttribute('aria-label','結束日期');
        from.value=state.customTime?.from||taipeiDay();to.value=state.customTime?.to||taipeiDay();
        function sync(){for(const b of tags.children)b.setAttribute('aria-pressed',String(state.times.includes(b.dataset.value)));time.classList.toggle('is-filtered',JSON.stringify(state.times)!=='["week"]');}
        function setTimes(values){state.times=values;persist();sync();renderContent();}
        actions.append(button('全部','',()=>setTimes([...TIME_CHOICES.map(([id])=>id),'week']),'oxn-action'),button('清除選取','',()=>setTimes([]),'oxn-action'),button('恢復預設','',()=>{setTimes(['week']);form.hidden=true;tags.scrollLeft=0;panel?.position();},'oxn-action'));
        for(const [id,text] of [['week','本週'],...TIME_CHOICES,['custom','自訂時間']]){const b=button(text,'',()=>{if(id==='custom'){form.hidden=!form.hidden;panel?.position();return;}const values=new Set(state.times);values.has(id)?values.delete(id):values.add(id);setTimes([...values]);},'oxn-tag');b.dataset.value=id;tags.append(b);}
        const apply=button('套用','套用自訂日期',()=>{if(!validDate(from.value)||!validDate(to.value)||from.value>to.value){message.textContent='請選擇有效日期，結束日期不可早於開始日期。';return;}state.customTime={from:from.value,to:to.value};setTimes(['custom']);message.textContent=`${from.value} ～ ${to.value}（台北時間）`;panel?.position();},'oxn-action');
        form.append(from,node('span','','至'),to,apply,message);form.hidden=true;form.addEventListener('submit',e=>{e.preventDefault();apply.click();});body.append(actions,tags,form,node('p','oxn-caption','本週從週一開始；自訂日期包含起訖日。依台北時間與新聞發布時間篩選。'));sync();
      }), 'oxn-pill');
      const source = button('來源', '多選新聞來源', () => {
        const available = sourcesFor(data.snapshot, scope()).filter(s => (s.status === 'ready' || s.count > 0) && !s.id.includes('calendar') && !['aptos', 'aave-governance','ethereum-upgrades'].includes(s.id));
        multi(source, '來源', 'sources', available.map(s => ({ id: s.id, label: s.name, disabled: s.status === 'not-connected', hint: `${sourceState(s)}${s.scopeLabel?'・'+s.scopeLabel:s.aggregator ? '・聚合入口' : ''}`, description:s.message })), null, '公開標題與原文連結，非全文轉載；聚合接入不代表官方 API。中央通訊社 RSS 限個人／非營利的非商業用途；來源失敗保留最後成功資料。');
      }, 'oxn-pill');
      const words = button('關鍵字', '搜尋與熱門關鍵字', () => showPanel(words, '關鍵字', (body, layer) => {
        const input = node('input', 'oxn-search'); input.type = 'search'; input.placeholder = '關鍵字、名稱、代號'; input.value = state.query; input.setAttribute('aria-label', '搜尋新聞');
        let timer; layer.signal.addEventListener('abort', () => clearTimeout(timer), { once: true }); input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.query = input.value; persist(); renderContent(); }, 120); }, { signal: life.signal });
        const tags = node('div', 'oxn-tags'); const stats = baseItems(); const hotCache = hotWords(stats); const order = [...new Map([...state.words.map(w => [w, 0]), ...hotCache]).entries()];
        for (const [word, count] of order) { const b = button(word, '', () => { const selected = new Set(state.words); selected.has(word) ? selected.delete(word) : selected.add(word); state.words = [...selected]; persist(); b.setAttribute('aria-pressed', String(selected.has(word))); renderContent(); }, 'oxn-tag'); b.setAttribute('aria-pressed', String(state.words.includes(word))); if (count) b.append(node('small', '', String(count))); tags.append(b); }
        body.append(input, node('p', 'oxn-caption', statsText(stats)), tags, button('清除搜尋與熱詞', '', () => { clearTimeout(timer); input.value = ''; state.query = ''; state.words = []; persist(); [...tags.children].forEach(b => b.setAttribute('aria-pressed', 'false')); renderContent(); }, 'oxn-action'));
      }), 'oxn-pill');
      const rank = button('排行榜', '新聞資產提及排行', () => showPanel(rank, '新聞提及排行', body => {
        const items = baseItems(), assets = ranking(items); body.append(node('p', 'oxn-caption', statsText(items)));
        if (!assets.length) body.append(node('p', 'oxn-empty', '本範圍沒有可核實的資產提及。'));
        const table = node('div', 'oxn-ranking'); for (const [i, asset] of assets.slice(0, 30).entries()) { const b = button('', `${asset.name}，${asset.count} 篇新聞`, () => { state.asset = state.asset === asset.id ? null : asset.id; persist(); b.setAttribute('aria-pressed', String(state.asset === asset.id)); renderContent(); }); b.setAttribute('aria-pressed', String(state.asset === asset.id)); b.append(node('span', 'oxn-rank-number', String(i + 1).padStart(2, '0')), node('span', '', `${asset.symbol} ${asset.name}`), node('small', '', MARKET_NAMES[asset.market]), node('b', '', `${asset.count} 篇`)); table.append(b); }
        body.append(table, button('清除資產篩選', '', () => { state.asset = null; persist(); [...table.children].forEach(b => b.setAttribute('aria-pressed', 'false')); renderContent(); }, 'oxn-action'));
      }), 'oxn-pill');
      time.classList.toggle('is-filtered', JSON.stringify(state.times) !== '["week"]'); source.classList.toggle('is-filtered', state.sources !== null); words.classList.toggle('is-filtered', Boolean(state.query || state.words.length)); rank.classList.toggle('is-filtered', Boolean(state.asset));
      controls.append(time, source, words, rank);
    }
  }
  function changeMonth(delta) { state.month = shiftMonth(state.month, delta); persist(); renderControls(); renderContent(); }
  function baseItems() { return newsBase(data.snapshot, scope(), state, api.preferences()); }
  function statsText(items) { const names=new Map([['week','本週'],...TIME_CHOICES,['custom',state.customTime?`${state.customTime.from}～${state.customTime.to}`:'自訂時間']]); const range=(state.times||[]).map(id=>names.get(id)).filter(Boolean).join('／')||'未選時間';return `${range}・${scope() === 'all' ? '全部市場' : MARKET_NAMES[scope()]}・目前快照去重 ${items.length} 篇，標題提及・非全網統計`; }
  function status() {
    notification.replaceChildren(); if (data.candidate) notification.append(button('有新消息・點此更新', '', api.applyUpdate, 'oxn-update'));
    if (data.error) notification.append(node('p', 'oxn-caption', data.snapshot ? '更新失敗，保留最後成功資料' : '來源快照讀取失敗'), button('重試', '', api.refresh, 'oxn-action'));
    else if (!data.snapshot) notification.append(node('p', 'oxn-caption', data.pending ? '正在讀取來源快照…' : '尚未載入'));
  }
  function renderContent() {
    if(window.OXFeatures&&!window.OXFeatures.enterTool(state.tab,'data-news-tab',renderContent))return;
    content.replaceChildren(); marketChoice.textContent = state.market === 'all' ? '全部市場' : MARKET_NAMES[state.market]; status();
    if (!data.snapshot) { content.append(node('div', 'oxn-empty', data.error ? '暫時無法讀取資料，請重試。' : '載入新聞與事件…')); return; }
    if (state.tab === 'calendar') {if(innerWidth<=600)renderMobileCalendar();else if(state.calendarView==='agenda')renderAgenda();else renderCalendar();} else renderNews();
    positionCalendar();
  }
  function selectedDate() { return state.selectedDay?.slice(0,7) === state.month ? state.selectedDay : taipeiDay().slice(0,7) === state.month ? taipeiDay() : `${state.month}-01`; }
  function renderMobileCalendar() {
    const selected = selectedDate();
    const shell = node('section', 'oxn-mobile-dates'); shell.setAttribute('aria-label','日期選擇');
    const week = node('div', 'oxn-week-strip');
    const start = new Date(selected+'T12:00:00Z'); start.setUTCDate(start.getUTCDate() - (start.getUTCDay()+6)%7);
    for (let i=0;i<7;i++) { const d=new Date(start); d.setUTCDate(d.getUTCDate()+i); const day=d.toISOString().slice(0,10);
      const b=button('',day,()=>{state.selectedDay=day;state.month=day.slice(0,7);persist();renderControls();renderContent();},'oxn-week-date');
      b.append(node('small','','一二三四五六日'[i]),node('strong','',String(d.getUTCDate())));b.setAttribute('aria-pressed',String(day===selected));if(day===taipeiDay())b.setAttribute('aria-current','date');week.append(b);
    }
    const toggle=button(monthExpanded?'收起行事曆 ▴':'展開行事曆 ▾','展開或收起完整月份行事曆',()=>{monthExpanded=!monthExpanded;renderContent();},'oxn-month-expand');toggle.setAttribute('aria-expanded',String(monthExpanded));shell.append(week,toggle);content.append(shell);
    if(monthExpanded) { renderCalendar(); content.querySelector('.oxn-day-events')?.remove(); }
    renderUpcomingEvents(selected,true);
  }
  function renderUpcomingEvents(start,mobile) {
    const section=node('section',mobile?'oxn-mobile-events oxn-upcoming-events':'oxn-day-events oxn-upcoming-events');section.setAttribute('aria-label','起始日期與未來七天事件');
    for(const {date:day,events:entries} of upcomingEventDays(data.snapshot,scope(),state,start)){const group=node('section','oxn-upcoming-day');group.dataset.date=day;
      const heading=node('div','oxn-day-events-heading');heading.append(node('h2','',`${day.replaceAll('-','/')} ${day===taipeiDay()?'今天・':''}事件`),button('完整列表',`查看 ${day} 完整事件`,()=>api.navigate({day}),'oxn-text-button'));group.append(heading);
      for(const item of entries){const row=eventRow(item,()=>api.navigate({day,event:item.id}));row.append(node('small','oxn-card-source',`${sourceName(item)} · ${statusLabel(item)}`));group.append(row);}
      if(!entries.length)group.append(node('p','oxn-caption','目前沒有符合篩選的已收錄事件。'));section.append(group);
    }content.append(section);
  }
  function renderCalendar() {
    const mobile = innerWidth <= 600;
    const gridInfo = monthGrid(state.month);
    if (mobile) {
      const [year, month] = state.month.split('-').map(Number);
      const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
      gridInfo.weeks = 6;
      gridInfo.cells = Array.from({ length: 42 }, (_, i) => {
        const date = new Date(Date.UTC(year, month - 1, 1 - offset + i)).toISOString().slice(0, 10);
        return { date, day: Number(date.slice(8)), outside: date.slice(0, 7) !== state.month };
      });
    }
    const events = (data.snapshot.events || []).filter(i => eventDay(i)?.slice(0, 7) === state.month && inMarket(i, scope()) && (state.categories === null || state.categories.includes(eventCategory(i))) && matchesImportance(i, state.importance));
    const map = new Map(); for (const e of events) { const key = eventDay(e); if (!map.has(key)) map.set(key, []); map.get(key).push(e); }
    const calendar = node('section', 'oxn-calendar'); calendar.setAttribute('aria-label', `${state.month} 完整月份行事曆`); calendar.dataset.weeks = String(gridInfo.weeks);
    const weekdays = node('div', 'oxn-weekdays'); (mobile ? '日一二三四五六' : '一二三四五六日').split('').forEach(d => weekdays.append(node('span', '', d)));
    const grid = node('div', 'oxn-calendar-grid'); grid.style.setProperty('--weeks', gridInfo.weeks); grid.setAttribute('role', 'grid');
    for (const cell of gridInfo.cells) {
      const entries = map.get(cell.date) || []; const b = node('div', 'oxn-day'); b.dataset.date = cell.date; b.setAttribute('role', 'gridcell');
      const selectDay = () => { state.selectedDay=cell.date; persist(); renderContent(); };
      b.addEventListener('click', () => { selectDay(); if(mobile && entries.length)api.navigate({day:cell.date}); });
      if (cell.outside) b.classList.add('is-outside'); if (cell.date === taipeiDay()) { b.classList.add('is-today'); b.setAttribute('aria-current', 'date'); }
      b.append(button(String(cell.day), `${cell.date}，${entries.length} 個已收錄事件`, e => { e.stopPropagation(); selectDay(); if(!mobile || entries.length)api.navigate({day:cell.date}); }, 'oxn-day-number'));
      if(entries.length)b.append(button(`${entries.length} 件`,`${cell.date}，開啟當日 ${entries.length} 個事件`,e=>{e.stopPropagation();state.selectedDay=cell.date;persist();api.navigate({day:cell.date});},'oxn-day-count'));
      for (const item of entries.slice(0, 2)) { const short = button(item.shortTitle || label(item).replace(/美國 \d{4} 年 \d+ 月/, ''), `${CATEGORY_NAMES[eventCategory(item)] || '事件'}：${label(item)}`, e => { e.stopPropagation(); api.navigate({ day: cell.date, event: item.id }); }, 'oxn-calendar-event'); short.title = label(item); short.dataset.category = eventCategory(item) || ''; short.dataset.tone = calendarTone(eventCategory(item)); b.append(short); }
      if (entries.length>2) b.append(button(`＋${entries.length-2}`,`${cell.date}，查看全部 ${entries.length} 個事件`,e=>{e.stopPropagation();api.navigate({day:cell.date});},'oxn-day-more')); grid.append(b);
    }
    const cover = coverage(data.snapshot, scope(), state.month);
    const caption = node('div', 'oxn-calendar-caption'); caption.append(node('span', '', '台北時間 UTC+8'), button(cover.complete ? '資料範圍' : '部分資料・範圍', '', () => showPanel(caption.querySelector('button'), '事件資料範圍', body => {
      for (const category of cover.categories) { const entry = node('div', 'oxn-coverage-row'); entry.append(node('b', '', CATEGORY_NAMES[category.category]), node('span', '', category.covered ? '本月完整來源範圍' : category.known ? `本月已收錄 ${category.known} 件・非完整月資料` : '本月未覆蓋，不能判定沒有事件')); for (const span of category.spans) entry.append(node('small', '', `${span.from}～${span.to}・${sourceName({ sourceId: span.sourceId })}`)); body.append(entry); }
    }), 'oxn-text-button'));
    calendar.append(weekdays, grid, caption); content.append(calendar);
    const selected=state.selectedDay?.slice(0,7)===state.month?state.selectedDay:taipeiDay().slice(0,7)===state.month?taipeiDay():[...map.keys()].sort()[0]||`${state.month}-01`;
    grid.querySelector(`[data-date="${selected}"]`)?.classList.add('is-selected');
    if(!mobile)renderUpcomingEvents(selected,false);
  }
  function eventRow(item, action) {
    const b = button('', label(item), action, 'oxn-event-row');
    const stars = importance(item).value, rating = node('span', 'oxn-stars', stars ? '★'.repeat(stars) : ''); rating.setAttribute('aria-label', stars ? `重要性 ${stars}／5 星` : '沒有星級');
    const title = node('strong', '', label(item));
    if (eventCategory(item) === 'macro' && item.releasedAt && Date.parse(item.releasedAt) <= Date.now()) { const result = macroResult(item); const badge = node('span', 'oxn-result-badge', result.label); badge.dataset.score = result.score ?? ''; title.append(badge); }
    const country = item.country || (['bls-calendar','fed','sec','cftc'].includes(item.sourceId) ? '美國' : '');
    const flag = {美國:'🇺🇸',美国:'🇺🇸',US:'🇺🇸',USA:'🇺🇸',台灣:'🇹🇼',臺灣:'🇹🇼',日本:'🇯🇵',法國:'🇫🇷',德國:'🇩🇪',英國:'🇬🇧',歐元區:'🇪🇺'}[country];
    const symbol = item.assets?.[0]?.symbol || item.symbols?.[0];
    const icon = flag || ({BTC:'₿',ETH:'◆',SOL:'◎',APT:'A',AAVE:'A'}[symbol]) || ({macro:'◷',unlock:'🔓',network:'⚙',listing:'⇄',governance:'🗳',airdrop:'🎁',burn:'🔥',regulation:'⚖',dividend:'💰',payment:'💵',earnings:'📊',holiday:'🗓'}[eventCategory(item)] || '🗓');
    const identity=node('span','oxn-event-icon',icon);
    if(flag==='🇺🇸'){const img=node('img');img.src=new URL('../../assets/flags/us.svg',import.meta.url).href;img.alt='美國國旗';img.width=28;img.height=20;identity.replaceChildren(img);}
    if(!flag&&symbol&&typeof OX_COIN_LOGOS!=='undefined'){ const path=OX_COIN_LOGOS[String(symbol).toLowerCase()];if(path){const img=node('img');img.src=new URL(path,document.baseURI).href;img.alt=symbol;img.width=28;img.height=28;img.addEventListener('error',()=>identity.replaceChildren(document.createTextNode(icon)),{once:true});identity.replaceChildren(img);} }
    const meta=node('div','oxn-event-meta');meta.append(identity,node('time','',item.date?item.originalTimezone==='America/New_York'?(eventCategory(item)==='macro'?'美東日期・時間待公布':'美東交易日'):item.allDay?'全天':'時間待公布':fmt(item.occursAt)),node('span','oxn-event-type',CATEGORY_NAMES[eventCategory(item)]||'事件'),rating);
    b.append(meta,title);
    const facts=[];
    if(['dividend','dividend-preview','payment'].includes(eventCategory(item))) { if(item.cashDividend!=null)facts.push(`現金股利 ${item.cashDividend} 元／股`);if(item.stockDividend!=null)facts.push(`股票股利 ${item.stockDividend} 元／股`);if(item.paymentDate)facts.push(`發放 ${item.paymentDate}`); }
    if(eventCategory(item)==='earnings'&&item.location)facts.push(item.location);
    if(eventCategory(item)==='governance'&&item.proposalTitle)facts.push(item.proposalTitleZh||'治理提案內容翻譯準備中');
    if(item.descriptionZh||item.description)facts.push(plain(item.descriptionZh||item.description));
    if(facts.length)b.append(node('p','oxn-event-summary',facts.join(' · ')));

    if(eventCategory(item)==='macro') { const values=node('div','oxn-event-values');const indicator=item.indicators?.[0]||item;
      for(const [name,value] of [['前值',indicator.previous],['預期',indicator.consensus],['公布',item.releasedAt&&Date.parse(item.releasedAt)<=Date.now()?indicator.actual:null]]){const cell=node('span');cell.append(node('small','',name),node('b','',macroValue(value,indicator.unit||item.unit)));values.append(cell);}b.append(values);
    }
 return b;
  }
  function renderAgenda(){
    const days=agendaDays(data.snapshot,scope(),state);
    const agenda=node('section','oxn-agenda');agenda.setAttribute('aria-label','行程列表');
    for(const day of days){
      const section=node('section','oxn-agenda-day');section.dataset.date=day.date;
      const heading=node('div','oxn-agenda-day-heading'),date=node('time');date.dateTime=day.date;
      date.append(node('strong','',String(Number(day.date.slice(8)))),node('span','',`${Number(day.date.slice(5,7))} 月 · ${new Intl.DateTimeFormat('zh-TW',{timeZone:'UTC',weekday:'short'}).format(new Date(day.date+'T12:00:00Z'))}`));heading.append(date);section.append(heading);
      if(day.date===taipeiDay()){section.classList.add('is-today');date.setAttribute('aria-current','date');}
      const events=node('div','oxn-agenda-events');
      for(const item of day.events){
        const row=eventRow(item,()=>api.navigate({day:day.date,event:item.id}));row.dataset.eventId=item.id;row.dataset.category=eventCategory(item)||'';row.classList.add('oxn-agenda-event');
        row.append(node('small','oxn-agenda-source',`${sourceName(item)} · ${statusLabel(item)}`));events.append(row);
      }
      section.append(events);agenda.append(section);
    }
    if(!days.length)agenda.append(node('p','oxn-empty','已收錄資料中沒有本月起符合條件的行程。可切換月份或調整篩選。'));
    agenda.append(node('p','oxn-caption','依已接入來源的排程列出有事件的日期；未提供的日期與事件不補入示範資料。'));content.append(agenda);
  }
  function renderNews() {
    const base = baseItems(), prefs = api.preferences(); let items = filterNews(base, state);
    if (state.reader === 'unread') items = items.filter(i => !(prefs.read || []).includes(i.id)); if (state.reader === 'following') items = items.filter(i => (prefs.followedSources || []).includes(i.sourceId));
    const range = node('div', 'oxn-news-range'); range.append(node('span', '', `${items.length} 篇・台北時間`), node('span', '', data.snapshot.generatedAt ? `快照 ${fmt(data.snapshot.generatedAt)}` : '快照時間未提供')); content.append(range);
    if (state.asset || state.query || state.words.length) { const selected = node('div', 'oxn-active-filters'); selected.append(node('span', '', [state.asset ? ranking(base).find(a => a.id === state.asset)?.name || '資產篩選' : '', state.query, ...state.words].filter(Boolean).join(' · ')), button('清除', '', () => { state.asset = null; state.query = ''; state.words = []; persist(); renderControls(); renderContent(); })); content.append(selected); }
    const list = node('div', 'oxn-news-list'); for (const item of items.slice(0, state.limit)) list.append(newsRow(item));
    if (!items.length) list.append(node('p', 'oxn-empty', !state.times.length || state.sources?.length === 0 ? '沒有選取時間或來源。可在藥丸中選擇「全部」或恢復預設。' : '已收錄資料中沒有符合條件的新聞。'));
    content.append(list); if (items.length > state.limit) content.append(button(`載入更多（尚有 ${items.length - state.limit} 篇）`, '', () => { state.limit += 40; persist(); renderContent(); }, 'oxn-load-more'));
    const published = [...(data.snapshot.news || []), ...(data.snapshot.pendingNews || [])].filter(i => scope() === 'all' || i.markets?.includes(scope())).map(i => i.publishedAt).sort();
    content.append(node('p', 'oxn-caption', `${statsText(base)}。${published.length ? `現有文章發布範圍：${fmt(published[0])}～${fmt(published.at(-1))}；來源 RSS 篇數有限，未完整覆蓋所選區間。` : '目前没有本市場來源資料。'}`));
  }
  function newsRow(item) {
    const row = node('details', 'oxn-news-row'); row.dataset.newsId = item.id;
    const summary = node('summary'), meta = node('div', 'oxn-news-meta');
    meta.append(node('span', 'oxn-source', sourceName(item)), node('time', '', fmt(item.publishedAt))); if (api.scope === 'all') meta.append(node('span', '', item.markets?.map(m => MARKET_NAMES[m]).filter(Boolean).join('／')));
    summary.append(meta, node('h3', '', label(item)), node('span', 'oxn-expand', '＋'));
    const tags = node('div', 'oxn-article-tags'); for (const asset of (item.assets || []).slice(0, 4)) tags.append(node('span', '', `${asset.symbol} ${asset.name}`)); if (item.translationStatus !== 'translated') tags.append(node('span', '', '翻譯待補')); if (tags.children.length) summary.append(tags);
    const body = node('div', 'oxn-article-body');
    if(item.translationMethod==='machine-title-only')body.append(node('small','oxn-caption','標題機器翻譯・原文保留供核對'));
    if (item.summaryZh) { body.append(node('small', 'oxn-caption', item.summaryType === 'system' ? '系統整理' : '來源摘要'), node('p', '', plain(item.summaryZh))); } else body.append(node('p', 'oxn-caption', item.translationStatus === 'translated' ? '來源未提供摘要，可點下方閱讀原文。' : '來源尚未提供繁中內容，可點下方閱讀原文。'));
    if (item.titleZh && item.title && item.title !== item.titleZh) { const originalTitle=node('details','oxn-original');originalTitle.append(node('summary','','查看原文標題'),node('p','',item.title));body.append(originalTitle); }
    if(item.aggregation)body.append(node('p','oxn-caption',`公開標題由 ${item.aggregation} 聚合 · ${item.publisher?`原始發布者：${item.publisher}`:`入口來源：${sourceName(item)}`}；非官方 API，不轉載全文。`));
    const actions = node('div', 'oxn-article-actions'), original = link(item.aggregation?'前往聚合連結／原文':'閱讀原文', item.link); if (original) actions.append(original);
    const read = button((api.preferences().read || []).includes(item.id) ? '標為未讀' : '標為已讀', '', () => { const set = new Set(api.preferences().read || []); set.has(item.id) ? set.delete(item.id) : set.add(item.id); api.save({ read: [...set] }); read.textContent = set.has(item.id) ? '標為未讀' : '標為已讀'; row.classList.toggle('is-read', set.has(item.id)); });
    const follow = button((api.preferences().followedSources || []).includes(item.sourceId) ? '取消追蹤' : '追蹤來源', '', () => { const set = new Set(api.preferences().followedSources || []); set.has(item.sourceId) ? set.delete(item.sourceId) : set.add(item.sourceId); api.save({ followedSources: [...set] }); follow.textContent = set.has(item.sourceId) ? '取消追蹤' : '追蹤來源'; });
    actions.append(read, follow, button('隱藏', '', () => { api.save({ hidden: [...new Set([...(api.preferences().hidden || []), item.id])] }); row.remove(); })); body.append(actions);
    for (const asset of item.assets || []) {
      const assetActions = node('div', 'oxn-asset-actions'); assetActions.append(button(`${asset.name}相關新聞`, '', () => { state.asset = asset.id; persist(); renderControls(); renderContent(); }));
      if (asset.market === 'crypto' && asset.venueSymbol && typeof window.switchSymbol === 'function') assetActions.append(button('前往幣種雷達', '', () => { window.OXMarketController?.setMarket('crypto'); window.switchSymbol(asset.venueSymbol); })); body.append(assetActions);
    }
    if (item.reports?.length > 1) { const related = node('div', 'oxn-related'); related.append(node('small', '', '同篇轉載／連結（不算獨立查證）')); for (const report of item.reports.slice(1)) { const a = link(sourceName(report), report.link); if (a) related.append(a); } body.append(related); }
    const health = data.snapshot.sources?.find(s => s.id === item.sourceId); if (health?.status === 'error') body.append(node('p', 'oxn-caption', '來源更新失敗・保留前次快照'));
    row.append(summary, body); if ((api.preferences().read || []).includes(item.id)) row.classList.add('is-read'); return row;
  }
  function renderRoute(route) {
    const next = JSON.stringify(route || {}); if (detailKey === next && detail) return; detail?.destroy(); detail = null; clearInterval(countdown); countdown = null; detailKey = next;
    if (!route?.day && !route?.event) return;
    closePanel(); const item = (data.snapshot?.events || []).find(e => e.id === route.event && inMarket(e, scope()));
    if (route.event) {
      detail = modal('事件詳情', api.back);
      if (!item) { detail.body.append(node('p', 'oxn-empty', data.snapshot ? '事件未收錄於目前來源快照。' : '正在讀取事件…')); return; }
      const category = eventCategory(item); detail.body.append(node('span', 'oxn-detail-type', `${CATEGORY_NAMES[category] || '事件'}・${statusLabel(item)}`), node('h2', '', label(item)));
      const fields = [['適用市場', item.markets?.map(m => MARKET_NAMES[m]).join('／')], [item.date&&item.originalTimezone==='America/New_York'?'交易日／美東':'日期／台北時間', item.date ? `${item.date}・${item.allDay ? '全天' : '時間待公布'}` : fmt(item.occursAt)]];
      if (['dividend', 'payment', 'dividend-preview', 'earnings'].includes(category)) fields.push(['公司／代號', `${item.company || '資料未提供'} ${item.symbol || ''}`]);
      if (category === 'dividend' || category === 'dividend-preview') fields.push(['除權息日', item.exDividendDate || item.date], ['現金股利（元／股）', item.cashDividend], ['股票股利（元／股）', item.stockDividend], ['合計配發（元／股）', item.totalDividend], ['現金發放日', item.paymentDate]);
      if (category === 'payment') fields.push(['發放日期', item.paymentDate || item.date], ['對應除息日', item.exDividendDate], ['配發金額（元／股）', item.cashDividend]);
      if (category === 'dividend-preview') fields.push(['預告日期', item.announcedDate], ['預計配發', item.expectedDividend], ['公告狀態', statusLabel(item)]);
      if (category === 'earnings') fields.push(['形式／地點', item.location || item.format], ['結束／台北時間', item.endsAt ? fmt(item.endsAt) : null], ['報到／場次說明', item.registrationNote]);
      if (category === 'macro') fields.push(['國家', item.country || (item.sourceId === 'bls-calendar' ? '美國' : null)], ['重要性', importance(item).value ? `${'★'.repeat(importance(item).value)}（${importance(item).value}／5）` : '沒有星級']);
      if (['holiday', 'exchange'].includes(category)) fields.push(['時段', item.session], ['調整內容', item.description]);
      if (category !== 'macro' && (api.scope === 'crypto' || item.markets?.includes('crypto'))) fields.push(['幣種／專案', (item.assets || []).map(a => `${a.name} ${a.symbol}`).join('／') || item.symbols?.join('／')], ['鏈／專案識別', item.chain || item.projectId], ['相關數量', item.quantity]);
      detail.body.append(fieldList(fields));
      const description=item.descriptionZh||item.description||item.summaryZh||item.scheduleBasis;
      if(description)detail.body.append(node('h3','','事件內容'),node('p','oxn-event-description',plain(description)));
      if(item.quantity!=null||item.percentage!=null||item.recipient)detail.body.append(fieldList([['數量',item.quantity],['流通占比',item.percentage],['對象',item.recipient]]));

      if (category === 'macro') {
        const box = node('section', 'oxn-macro-result'); box.setAttribute('aria-label', '數據公布結果');
        box.append(node('h3', '', '數據公布結果'));
        for (const indicator of item.indicators?.length ? item.indicators : [item]) {
          if (indicator.label) box.append(node('h4', '', indicator.label));
          const values = node('div', 'oxn-macro-values'), published = item.releasedAt && Date.parse(item.releasedAt) <= Date.now();
          for (const [name, value] of [['前值', indicator.previous], ['預期值', indicator.consensus], ['實際值', published ? indicator.actual : null]]) { const cell = node('div'); cell.append(node('small', '', name), node('strong', '', macroValue(value, indicator.unit || item.unit))); values.append(cell); }
          box.append(values);
          if (indicator.previousOriginal != null) box.append(node('p', 'oxn-caption', `前值已修正：${macroValue(indicator.previousOriginal, indicator.unit)} → ${macroValue(indicator.previous, indicator.unit)}`));
        }
        const result = macroResult(item), badge = node('span', 'oxn-result-badge', result.label); badge.dataset.score = result.score ?? ''; box.append(badge, node('p', '', result.summary));
        if (item.rateRange) box.append(node('p', 'oxn-caption', `公布利率區間：${item.rateRange}`));
        box.append(node('small', 'oxn-caption', '判讀範圍：加密市場的利率與流動性面；非實際行情漲跌。非農亦須對照薪資與失業率。'));
        const expected = link('預期值：調查來源', item.consensusSource); if (expected) box.append(expected); else box.append(node('small', 'oxn-caption', '預期值尚無可靠調查來源，以 — 顯示。'));
        const actual = link('實際值：官方公布', item.sourceUrl); if (actual) box.append(actual);
        box.append(node('small', 'oxn-caption', `公布：${item.releasedAt ? fmt(item.releasedAt) : '待公布'} · 更新：${item.updatedAt ? fmt(item.updatedAt) : '待更新'}`));
        detail.body.append(box);
      }
      if (category === 'governance') detail.body.append(fieldList([['治理議案', item.proposalTitleZh || '中文翻譯準備中'], ['投票開始／台北時間', fmt(item.startsAt)], ['投票截止／台北時間', fmt(item.endsAt||item.occursAt)]]));
      if (item.eventTimeType) detail.body.append(node('p', 'oxn-caption', item.eventTimeType === 'software-release-publication' ? '此時間為官方軟體版本發布時間，不是主網硬分叉生效時間。' : item.eventTimeType));
      if (category === 'unlock') { const counter = node('p', 'oxn-countdown', api.unlockCountdown(item)); detail.body.append(counter); if (item.status === 'confirmed' && item.occursAt && !item.date) countdown = setInterval(() => { counter.textContent = api.unlockCountdown(item); }, 1000); }
      if (item.scheduleBasis) detail.body.append(node('p', 'oxn-caption', item.scheduleBasis));
      const original = link('官方公告／原始資料', item.sourceUrl || item.link); if (original) detail.body.append(original);
      for (const [name, url] of [['簡報', item.presentationUrl], ['直播', item.liveUrl || item.livestreamUrl], ['官方月表', item.documentUrl]]) { const a = link(name, url); if (a) detail.body.append(a); }
      if (item.impact?.evidence) detail.body.append(node('p', 'oxn-caption', item.impact.reason));
      detail.body.append(node('p', 'oxn-caption', `${sourceName(item)}・資料更新 ${item.updatedAt ? fmt(item.updatedAt) : '時間未提供'}・${statusLabel(item)}`));
      if (item.title !== item.titleZh) {const original=node('details','oxn-original');original.append(node('summary','','查看原文標題'),node('p','',item.proposalTitle||item.title));detail.body.append(original);}
    } else {
      detail = modal(`${route.day}・當日事件`, api.back); const events = (data.snapshot?.events || []).filter(e => eventDay(e) === route.day && inMarket(e, scope()) && (state.categories === null || state.categories.includes(eventCategory(e))) && matchesImportance(e, state.importance));
      detail.body.append(node('p', 'oxn-caption', `台北時間・符合目前篩選 ${events.length} 件`));
      for (const event of events) detail.body.append(eventRow(event, () => api.navigate({ day: route.day, event: event.id })));
      if (!events.length) detail.body.append(node('p', 'oxn-empty', '已收錄資料中沒有符合條件的事件；未覆蓋資料不能判定為沒有事件。'));
    }
  }
  let width = innerWidth, height = innerHeight;
  function positionCalendar() {
    requestAnimationFrame(() => { const grid = content.querySelector('.oxn-calendar-grid'); if (!grid) return;
      const viewport = window.visualViewport;
      const visibleHeight = viewport?.height || innerHeight;
      const dock = document.querySelector('.app-dock')?.getBoundingClientRect();
      const top = grid.getBoundingClientRect().top + scrollY;
      const bottom = Math.min(visibleHeight, dock?.top || visibleHeight - 80);
      const captionHeight = content.querySelector('.oxn-calendar-caption')?.getBoundingClientRect().height || 30;
      const rows = Number(content.querySelector('.oxn-calendar').dataset.weeks);
      const room = Math.floor(bottom - top - captionHeight - 12);
      const mobile = innerWidth <= 600 && visibleHeight > innerWidth;
      const available = room - Math.min(64, Math.max(0, room - rows * 66));
      const fit = mobile && available >= rows * 54;
      grid.style.setProperty('--month-height', fit ? `${available}px` : 'auto');
      root.dataset.fit = fit ? '1' : '0';
      root.dataset.compact = fit && available < rows * 66 ? '1' : '0';
    });
  }
  window.addEventListener('resize', () => { if (innerWidth !== width || Math.abs(innerHeight - height) > 90) { const crossed=(width<=600)!==(innerWidth<=600);width = innerWidth; height = innerHeight; if(crossed&&state.tab==='calendar'){renderControls();renderContent();}else positionCalendar(); } }, { signal: life.signal });
  window.visualViewport?.addEventListener('resize', positionCalendar, { signal: life.signal });
  let scrollTimer; window.addEventListener('scroll', () => { if (!root.closest('.app-view.active')) return; clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { state.scroll = scrollY; persist(); }, 180); }, { signal: life.signal, passive: true });
  renderControls();
  return { host, update(next) { const changed = next.snapshot !== data.snapshot || !content.firstChild; data = next; if (changed) { detailKey = ''; renderContent(); } else status(); renderRoute(data.route); rail.position(); if (restorePosition) { restorePosition = false; requestAnimationFrame(() => window.scrollTo(0, state.scroll || 0)); } }, suspend() { closePanel(); detail?.destroy(); detail = null; detailKey = ''; clearInterval(countdown); countdown = null; }, destroy() { state.scroll = root.closest('.app-view.active') ? scrollY : state.scroll; persist(); closePanel(); detail?.destroy(); clearInterval(countdown); clearTimeout(scrollTimer); life.abort(); rail.destroy(); root.remove(); } };
}

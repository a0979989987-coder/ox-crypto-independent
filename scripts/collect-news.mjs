import { projectCryptoSnapshot } from './crypto-news-scope.mjs';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
const REVIEWED_V2 = JSON.parse(readFileSync(new URL('../data/news-translations-v2.json', import.meta.url), 'utf8'));
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CRYPTO_ASSETS, identifyAssets, governanceEvents, spansFor } from './news-providers.mjs';
import { nyseCalendar, ethereumUpgradeCalendar } from './news-official-calendar.mjs';
import { translateHeadlines } from './news-translation.mjs';
import { fedMeetingCalendar, beaReleaseCalendar, foresightCalendar } from './news-live-providers.mjs';
import { FEEDS, TRADITIONAL_SOURCES, BITGET_ANNOUNCEMENTS_URL, hash, impact, normalizeFeed, migrateAggregateHeadline, cryptoRelevant, fetchText, bitgetAnnouncements } from '../server/news/feeds.js';

// Feed definitions and normalization live in server/news/feeds.js so the live
// endpoint (/api/v1/news/latest) applies exactly the same source rules.
export { FEEDS, impact, normalizeFeed, migrateAggregateHeadline, cryptoRelevant, fetchText };
const plain = value => String(typeof value === 'object' ? value?.['#text'] ?? '' : value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const iso = value => { const ms = Date.parse(String(value ?? '')); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; };

export function parseBlsCalendar(html, now = Date.now()) {
  const events = [];
  const pattern = /<tr\b[^>]*>[\s\S]*?<td class="date-cell"><p>([^<]+)<\/p><\/td>[\s\S]*?<td class="time-cell"><p>([^<]*)<\/p><\/td>[\s\S]*?<td class="desc-cell"><p>([\s\S]*?)<\/p><\/td>[\s\S]*?<\/tr>/gi;
  for (const match of html.matchAll(pattern)) {
    const date = plain(match[1]);
    const time = plain(match[2]);
    const title = plain(match[3]);
    if (!/Consumer Price Index|Employment Situation|Producer Price Index|Job Openings and Labor Turnover/i.test(title) || !/^\d{1,2}:\d{2} [AP]M$/.test(time)) continue;
    const midday = Date.parse(`${date} 12:00 UTC`);
    if (!Number.isFinite(midday)) continue;
    const eastern = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }).formatToParts(midday).find(part => part.type === 'timeZoneName')?.value;
    const occursAt = iso(`${date} ${time} ${eastern === 'EDT' ? 'EDT' : 'EST'}`);
    if (!occursAt) continue; // Full-month lookup also needs releases that have already occurred.
    events.push({ id: hash(`bls:${date}:${title}`), title, link: 'https://www.bls.gov/schedule/news_release/current_year.asp', sourceUrl: 'https://www.bls.gov/schedule/news_release/current_year.asp', occursAt,
      source: 'U.S. BLS', sourceId: 'bls-calendar', markets: ['crypto'], category: 'macro', country: '美國', symbols: [], kind: 'event', status: 'confirmed', originalTimezone: 'America/New_York', previous: null, consensus: null, actual: null, revised: null, updatedAt: null, impact: impact(title, 'bls-calendar', 'https://www.bls.gov/schedule/news_release/current_year.asp') });
  }
  return events.sort((a,b) => a.occursAt.localeCompare(b.occursAt));
}

const retainEvent = item => ({ ...item, sourceUrl: item.sourceUrl ?? item.link ?? null,
  originalTimezone: item.originalTimezone ?? item.originalZone ?? null,
  symbols: item.symbols ?? [], previous: item.previous ?? null, consensus: item.consensus ?? null,
  actual: item.actual ?? null, revised: item.revised ?? null, updatedAt: item.updatedAt ?? null,
  impact: impact(item.title, item.sourceId, item.sourceUrl ?? item.link) });

// Preserve translations only while both the source identity and original title match.
export function localize(item, previous = []) {
  const reviewed = REVIEWED_V2.find(entry => entry.id === item.id && entry.sourceId === item.sourceId && entry.title === item.title);
  const old = previous.find(entry => entry.id === item.id && entry.sourceId === item.sourceId && entry.title === item.title);
  let titleZh = reviewed?.titleZh || old?.titleZh || (TRADITIONAL_SOURCES.includes(item.sourceId) && /[\u4e00-\u9fff]/.test(item.title) ? item.title : null) || VERIFIED_TRANSLATIONS[item.title] || null;
  // The publisher's short summary keeps its translation while the summary text is unchanged.
  const summaryZh = !item.summary ? null : item.summaryZh || (old?.summary === item.summary ? old.summaryZh : null) || (TRADITIONAL_SOURCES.includes(item.sourceId) && /[\u4e00-\u9fff]/.test(item.summary) ? item.summary : null) || null;
  const summaryMethod = summaryZh && summaryZh !== item.summary ? (item.summaryMethod || old?.summaryMethod || 'machine') : null;
  if (item.kind === 'event') {
    const match = item.title.match(/^(Consumer Price Index|Employment Situation|Producer Price Index|Job Openings and Labor Turnover Survey|State Job Openings and Labor Turnover|Employment Situation of Veterans) for (\w+) (\d{4})$/);
    const names = { 'Consumer Price Index': '消費者物價指數', 'Employment Situation': '就業情勢報告', 'Producer Price Index': '生產者物價指數', 'Job Openings and Labor Turnover Survey': '職缺與勞動流動調查', 'State Job Openings and Labor Turnover': '州別職缺與勞動流動調查', 'Employment Situation of Veterans': '退伍軍人就業情勢報告' };
    const months = 'January February March April May June July August September October November December'.split(' ');
    const month = match ? months.indexOf(match[2]) + 1 : 0;
    if (match && match[2] === 'Annual') titleZh = `美國 ${match[3]} 年${names[match[1]]}（年度）`;
    if (match && month) titleZh = `美國 ${match[3]} 年 ${month} 月${names[match[1]]}`;
  }
  return { ...item, titleZh, ...(old?.translationMethod?{translationMethod:old.translationMethod}:{}), ...(item.summary ? { summaryZh, summaryType: 'source', ...(summaryMethod ? { summaryMethod } : {}) } : {}), translationStatus: titleZh ? 'translated' : 'pending' };
}

// Reviewed headline translations are keyed by the exact original text; changed
// headlines wait for a new review instead of inheriting an inaccurate title.
const VERIFIED_TRANSLATIONS = {
  'Ukraine scrambles for money to fight war as Russian strikes batter economy': '俄軍攻擊重創經濟，烏克蘭急籌戰爭資金',
  'CFTC Staff Releases Updates to FAQs Concerning Registrants and Registered Entity Activities Relating to Crypto Assets and Blockchain Technologies': '美國 CFTC 更新加密資產與區塊鏈業務常見問答，涉及註冊機構及登記實體',
  'Spend more than your cash balance: introducing Kraken Borrow for US customers': 'Kraken 推出面向美國用戶的借貸功能 Kraken Borrow',
  'Inside Kraken&#8217;s VIP château retreat: a weekend in Saint-Émilion': 'Kraken 介紹其法國聖愛美濃貴賓活動',
  'CFTC Releases Staff Advisory on Mention Markets': '美國 CFTC 發布 Mention Markets 相關工作人員指引',
  'Earn up to 6% APY on AUSD with Kraken+': 'Kraken+ 宣布 AUSD 存放獎勵方案，標示最高年化 6%',
  'CFTC Innovation Task Force to Host Frontier Forum Series on Innovative Financial Technologies': '美國 CFTC 創新工作小組將舉辦金融科技前沿論壇系列',
  'v32.0rc2: Bitcoin Core 32.0 release candidate 2': '比特幣核心 32.0 第二版候選測試版本發布',
  'The Anthropic Pre-IPO Challenge: compete for $20,000 USDG on Kraken Pro': 'Kraken Pro 宣布 Anthropic 上市前挑戰活動，獎勵標示為 20,000 USDG',
  'CFTC Staff Issues No-Action Position to Providers of Passive Software': '美國 CFTC 工作人員就被動軟體提供者發布不採取執法行動立場',
  'TREAD is available for trading!': 'Kraken 開放 TREAD 交易',
  'GNOT is available for trading!': 'Kraken 開放 GNOT 交易',
  'USDC on Arc deposits and withdrawals now available!': 'Kraken 開放 Arc 網路 USDC 充值與提領',
  'Kraken is an official X Cashtag partner, with trading just a tap away from your timeline': 'Kraken 宣布成為 X Cashtag 合作夥伴，提供交易入口',
  'USDCx on Aleo deposits and withdrawals now available!': 'Kraken 開放 Aleo 網路 USDCx 充值與提領',
  'The new Kraken Wallet: self-custody, now with DeFi Earn': 'Kraken 推出新版自託管錢包，加入 DeFi 收益功能',
  'v32.0rc1: Bitcoin Core 32.0 release candidate 1': '比特幣核心 32.0 第一版候選測試版本發布',
  'CFTC Approves Final Rule Concerning Whistleblower Awards': '美國 CFTC 通過檢舉獎勵相關最終規則',
  'Joint Readout of Principals’ Meeting of UK and U.S. Authorities Regarding Central Counterparty Resolution': '英美主管機關發布中央交易對手處置會議聯合摘要',
  'CFTC Chairman Selig and Kansas State University Announce Agenda for October 22-23 AgCon Conference in Overland Park': '美國 CFTC 主席與堪薩斯州立大學公布 10 月 22 至 23 日農業會議議程',
  'CFTC Staff Issues No-Action Position on Large Trader Reporting for Direct Participants': '美國 CFTC 工作人員就直接參與者的大額交易人申報發布不採取執法行動立場',
  'CFTC Issues Final Rule to Modify Clearing Requirement for Canadian Dollar- and Mexican Peso-Denominated Interest Rate Swaps': '美國 CFTC 修訂加元與墨西哥披索利率交換交易的清算要求',
  'CFTC Further Extends Compliance Date for Amendments to Form PF': '美國 CFTC 再延長 Form PF 修正規定的遵循期限',
  'Bitcoin Core 29.4': '比特幣核心 29.4 正式版本發布',
  'Bitcoin Core 30.3': '比特幣核心 30.3 正式版本發布',
  'Bitcoin Core 31.1': '比特幣核心 31.1 正式版本發布',
  'v29.4rc1: Bitcoin Core 29.4 release candidate 1': '比特幣核心 29.4 第一版候選測試版本發布',
  'v30.3rc1: Bitcoin Core 30.3 release candidate 1': '比特幣核心 30.3 第一版候選測試版本發布',
  'v31.1rc1: Bitcoin Core 31.1 release candidate 1': '比特幣核心 31.1 第一版候選測試版本發布',
  'v27-final: Bitcoin Core 27.x Final': '比特幣核心 27.x 最終版本發布',
  'v26-final: Bitcoin Core 25.x Final': '比特幣核心 25.x 最終版本發布'
};

export async function collect() {
  const snapshotURL = new URL('../data/news.json', import.meta.url);
  const old = await readFile(snapshotURL, 'utf8').then(JSON.parse).catch(() => null);
  const stamp = new Date().toISOString();
  const results = await Promise.allSettled(FEEDS.map(async feed => ({ feed, items: normalizeFeed(await fetchText(feed.url), feed) })));
  const sources = results.map((result, i) => result.status === 'fulfilled'
    ? { id: FEEDS[i].id, name: FEEDS[i].name, markets: FEEDS[i].markets, status: 'ready', count: result.value.items.length, lastSuccessAt: stamp, lastAttemptAt: stamp, access: FEEDS[i].aggregator?'public-aggregated-rss':FEEDS[i].portal?'public-portal-rss':'public-rss-headlines-links', aggregator:Boolean(FEEDS[i].aggregator||FEEDS[i].portal), usage:FEEDS[i].usage, termsUrl:FEEDS[i].termsUrl, scopeLabel:FEEDS[i].scopeLabel, endpoint: FEEDS[i].url }
    : { ...old?.sources?.find(s => s.id === FEEDS[i].id), id: FEEDS[i].id, name: FEEDS[i].name, markets: FEEDS[i].markets, endpoint: FEEDS[i].url, scopeLabel:FEEDS[i].scopeLabel, status: 'error', lastAttemptAt: stamp, message: String(result.reason?.message || '來源請求失敗').slice(0, 100) });
  try {
    const items=bitgetAnnouncements(JSON.parse(await fetchText(BITGET_ANNOUNCEMENTS_URL)),stamp);
    results.push({status:'fulfilled',value:{items}});sources.push({id:'bitget',name:'Bitget 官方公告',markets:['crypto'],status:'ready',count:items.length,lastSuccessAt:stamp,lastAttemptAt:stamp,endpoint:BITGET_ANNOUNCEMENTS_URL,access:'public-announcement-headlines-links'});
  } catch(error) { sources.push({...old?.sources?.find(s=>s.id==='bitget'),id:'bitget',status:'error',lastAttemptAt:stamp,message:String(error.message).slice(0,100)}); }
  const allOldNews = [...(old?.news || []), ...(old?.pendingNews || [])].filter(item => item.sourceId !== 'decrypt').map(migrateAggregateHeadline).map(item => ['fed','bls-cpi','bls-jobs'].includes(item.sourceId) ? {...item,markets:['crypto']} : item);
  // Append to history rather than replacing yesterday with today's RSS window.
  const articles = new Map(allOldNews.map(item => [item.id, item]));
  results.forEach(result => { if (result.status === 'fulfilled') result.value.items.forEach(item => articles.set(item.id, item)); });
  const catalog = [];
  const news = [...articles.values()].filter(item => !['abmedia','blocktempo','decrypt','odaily'].includes(item.sourceId) || cryptoRelevant(item.title)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 6000).map(item => localize({ ...item, contentType: item.contentType || (/sponsored|APY|challenge|giveaway|獎池|限時優惠|抽獎|贊助|業配/i.test(item.title) ? 'promotion' : 'news'), assets: identifyAssets(item.titleZh || item.title, item.markets, catalog) }, allOldNews));
  const providers = [
    ['fed-calendar',async()=>fedMeetingCalendar(await fetchText('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),stamp)],
    ['bea-calendar',async()=>beaReleaseCalendar(await fetchText('https://www.bea.gov/news/schedule'),stamp)],
    ['foresight-calendar',async()=>foresightCalendar(await fetchText('https://api.foresightnews.pro/v1/calendar.ics'),stamp)],
    ['nyse-calendar',async()=>nyseCalendar(await fetchText('https://www.nyse.com/trade/hours-calendars'),stamp)],
    ['ethereum-upgrades',async()=>ethereumUpgradeCalendar(await fetchText('https://blog.ethereum.org/2026/09/17/glamsterdam-testnet-announcement'),stamp)],
    ['aptos', async () => {
      const url = 'https://aptosnetwork.com/currents/aptos-tokenomics-overview', html = await fetchText(url);
      if (!/October 12, 2022/.test(html) || !/four-year anniversary/.test(html)) throw Error('Official vesting rule changed; estimate requires review');
      const retained = old?.events?.find(e => e.id === 'aptos-investor-core-final-schedule-2026'); if (!retained) return [];
      return [{ ...retained, category: 'unlock', announcementStatus: 'estimated', projectId: 'aptos', assets: [CRYPTO_ASSETS.find(a => a.symbol === 'APT')], updatedAt: stamp,
        scheduleBasis: '官方文件載明 2022-10-12 主網上線及投資人／核心貢獻者四年解鎖週年；日期為依該規則推算，未提供精確時間或實際執行結果。' }];
    }],
    ['bls-calendar', async () => parseBlsCalendar(await fetchText('https://www.bls.gov/schedule/news_release/current_year.asp'))],
    ['aave-governance', async () => {
      const response = await fetch('https://hub.snapshot.org/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{ proposals(first: 100, skip: 0, where: { space_in: ["aave.eth", "uniswap.eth", "ens.eth", "arbitrumfoundation.eth"] }, orderBy: "created", orderDirection: desc) { id title start end space { id } } }' }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`); const body = await response.json(); if (body.errors || !Array.isArray(body.data?.proposals)) throw Error('Governance response has no verified proposals'); return governanceEvents(body.data.proposals, stamp);
    }]
  ];
  sources.push({ id: 'decrypt', status: 'not-connected', message: '已驗證 RSS，但官方服務條款限制自動收集；未取得許可，因此不啟用。', termsUrl: 'https://decrypt.co/terms-of-service' });
  const eventResults = await Promise.allSettled(providers.map(async ([id, load]) => ({ id, items: await load() })));
  const events = new Map((old?.events || []).map(item => [item.id, item]));
  const eventCoverage = [...(old?.eventCoverage || [])];
  eventResults.forEach((result, i) => {
    const id = providers[i][0];
    if (result.status === 'fulfilled') {
      // Replace this provider's published schedule so withdrawn/postponed entries cannot linger.
      if (['fed-calendar','bea-calendar','foresight-calendar'].includes(id)) for (const [key,item] of events) if(item.sourceId===id)events.delete(key);
      const items = result.value.items.map(item => item.titleZh ? item : localize(item, old?.events)); items.forEach(item => events.set(item.id, item));
      sources.push({ id, status: 'ready', count: items.length, lastSuccessAt: stamp, lastAttemptAt: stamp,
        ...(result.value.items.warnings?.length ? { partial: true, message: '部分月份公告格式尚未接入；只收錄解析成功的官方月表。' } : {}) });
      for (let j = eventCoverage.length - 1; j >= 0; j--) if (eventCoverage[j].sourceId === id) eventCoverage.splice(j, 1);
      eventCoverage.push(...spansFor(items, id));
    } else sources.push({ ...old?.sources?.find(s => s.id === id), id, status: 'error', lastAttemptAt: stamp, message: String(result.reason?.message || '來源請求失敗').slice(0, 100) });
  });
  // Published release timestamps identify actual software releases, not future hard forks.
  for (const item of news.filter(n => n.sourceId === 'bitcoin-core' && !/rc\d|candidate/i.test(n.title))) {
    const event = localize({ ...item, id: `release:${item.id}`, kind: 'event', category: 'network', occursAt: item.publishedAt, status: 'confirmed', announcementStatus: 'confirmed', sourceUrl: item.link, projectId: 'bitcoin', eventTimeType: 'software-release-publication' }, old?.events);
    if (event.titleZh) events.set(event.id, event);
  }
  // Fill fresh English titles on each collection run; retain exact-title
  // translations on later runs so opening the page never waits for translation.
  const eventItems=[...events.values()];
  for(const item of eventItems)if(item.proposalTitle){const reviewed=REVIEWED_V2.find(e=>e.translationField==='proposalTitle'&&e.sourceId===item.sourceId&&e.title===item.proposalTitle);const previous=old?.events?.find(e=>e.id===item.id&&e.sourceId===item.sourceId&&e.proposalTitle===item.proposalTitle);item.proposalTitleZh=reviewed?.titleZh||previous?.proposalTitleZh||null;}
  const proposals=new Map();
  for(const item of eventItems) if(item.proposalTitle && !item.proposalTitleZh){if(!proposals.has(item.proposalTitle))proposals.set(item.proposalTitle,{title:item.proposalTitle});}
  const translation = await translateHeadlines([...eventItems,...proposals.values(),...news],{limit:1000,concurrency:3});
  for(const item of eventItems)if(proposals.get(item.proposalTitle)?.titleZh)item.proposalTitleZh=proposals.get(item.proposalTitle).titleZh;
  for(const item of eventItems)if(!item.proposalTitleZh&&item.proposalTitle){const previous=old?.events?.find(e=>e.id===item.id&&e.proposalTitle===item.proposalTitle);if(previous?.proposalTitleZh)item.proposalTitleZh=previous.proposalTitleZh;}
  const translations = news.filter(item => item.translationStatus !== 'pending');
  const pendingNews = news.filter(item => item.translationStatus === 'pending');
  if (!news.length && !events.size) throw Error('No verified source data; snapshot not replaced');
  const snapshot = { schemaVersion: 1, generatedAt: sources.some(s => s.status === 'ready') ? stamp : old?.generatedAt || null, attemptedAt: stamp, sources,
    news: translations, pendingNews, events: [...events.values()], eventCoverage, assetCatalog: catalog, translation,
    methodology: { news: '公開 RSS 標題、來源自己提供的短摘要（描述第一段，約 100 字內）與原文連結；不轉載全文。', live: '新聞頁每 3 分鐘向 /api/v1/news/latest 取得最近 36 小時的新聞，合併到此快照；Foresight 行事曆由瀏覽器直接讀取公開 ICS。', ranking: '目前快照去重文章的標題資產提及；同篇同資產只計一次。', history: '逐次收集累積，RSS 數量有限，非完整 30 日資料庫。', importance: '保留 1–5 星與來源規則；重要性開＝有星、關＝無星。星級不代表多空。', frequencyHours: 6 } };
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  const temp = new URL('../data/news.next.json', import.meta.url);
  await writeFile(temp, JSON.stringify(projectCryptoSnapshot(snapshot), null, 2) + '\n');
  await rename(temp, snapshotURL);
  return { changed: true, news: translations.length, pendingTranslation: pendingNews.length, events: events.size, sources };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  collect().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
}

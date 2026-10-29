// Public publisher feeds and their normalization. Shared by the 6-hourly
// snapshot collector (scripts/collect-news.mjs) and the live endpoint
// (/api/v1/news/latest). Only dated headlines, the publisher's own short RSS
// summary and source links are retained; article bodies are never republished.
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

// Public publisher and explicitly identified aggregation feeds.
export const FEEDS = [
  { id: 'odaily', name: 'Odaily 星球日報', url: 'https://rss.odaily.news/rss/newsflash', hosts:['www.odaily.news','odaily.news'], markets:['crypto'], verified:'publisher-feed' },

  { id: 'theblock', name: 'The Block', url: 'https://www.theblock.co/rss.xml', markets: ['crypto'], verified: 'publisher-feed' },
  { id: 'cryptoslate', name: 'CryptoSlate', url: 'https://cryptoslate.com/feed/', markets: ['crypto'], verified: 'publisher-feed' },
  { id: 'abmedia', name: '鏈新聞 ABMedia', url: 'https://abmedia.io/feed', markets: ['crypto'], verified: 'publisher-feed' },
  { id: 'blocktempo', name: '動區動趨 BlockTempo', url: 'https://www.blocktempo.com/feed/', markets: ['crypto'], verified: 'publisher-feed' },
  { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml', markets: ['crypto'], verified: 'publisher-feed' },
  { id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', markets: ['crypto'], verified: 'publisher-feed' },
  { id: 'fed', name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', markets: ['crypto'] },
  { id: 'bls-cpi', name: 'U.S. BLS · CPI', url: 'https://www.bls.gov/feed/cpi.rss', markets: ['crypto'] },
  { id: 'bls-jobs', name: 'U.S. BLS · Employment', url: 'https://www.bls.gov/feed/empsit.rss', markets: ['crypto'] },
  { id: 'sec', name: 'U.S. SEC', url: 'https://www.sec.gov/news/pressreleases.rss', markets: ['crypto'] },
  { id: 'ethereum', name: 'Ethereum Foundation', url: 'https://blog.ethereum.org/en/feed.xml', markets: ['crypto'] },
  { id: 'kraken', name: 'Kraken', url: 'https://blog.kraken.com/feed', markets: ['crypto'] },
  { id: 'cftc', name: 'U.S. CFTC', url: 'https://www.cftc.gov/RSS/RSSGP/rssgp.xml', markets: ['crypto'] },
  { id: 'bitcoin-core', name: 'Bitcoin Core', url: 'https://github.com/bitcoin/bitcoin/releases.atom', markets: ['crypto'] }
];
// Fast-moving crypto newsrooms the live endpoint polls between snapshots.
export const LIVE_FEED_IDS = Object.freeze(['odaily', 'theblock', 'cryptoslate', 'abmedia', 'blocktempo', 'coindesk', 'cointelegraph']);
// Traditional Chinese newsrooms: their own title and summary are the Chinese text.
export const TRADITIONAL_SOURCES = Object.freeze(['abmedia', 'blocktempo']);
export const BITGET_ANNOUNCEMENTS_URL = 'https://api.bitget.com/api/v2/public/annoucements?language=zh_CN';
const OFFICIAL_HOSTS = new Set(['abmedia.io', 'www.blocktempo.com', 'www.coindesk.com', 'cointelegraph.com', 'decrypt.co', 'www.federalreserve.gov', 'www.bls.gov', 'www.ecb.europa.eu', 'www.theblock.co', 'cryptoslate.com', 'www.sec.gov', 'blog.ethereum.org', 'blog.kraken.com', 'www.cftc.gov']);
for (const host of ['news.google.com','www.odaily.news','odaily.news','www.bitget.com','www.bea.gov']) OFFICIAL_HOSTS.add(host);

const parser = new XMLParser({ ignoreAttributes: false, processEntities: true, trimValues: true });
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const plain = value => String(typeof value === 'object' ? value?.['#text'] ?? '' : value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
export const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 20);
const iso = value => { const ms = Date.parse(String(value ?? '')); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; };
export const safeUrl = value => { try { const u = new URL(plain(value)); return u.protocol === 'https:' && (OFFICIAL_HOSTS.has(u.hostname) || (u.hostname === 'github.com' && /^\/bitcoin\/bitcoin\/releases(?:\/tag\/[^/]+)?\/?$/.test(u.pathname))) ? u.href : null; } catch { return null; } };
const verifiedForFeed = (url, feed) => { try {
  const parsed = new URL(url);
  if(feed.aggregator)return parsed.hostname==='news.google.com'&&/^\/rss\/articles\//.test(parsed.pathname);
  if(feed.hosts)return feed.hosts.includes(parsed.hostname);
  return feed.id === 'bitcoin-core' ? parsed.hostname === 'github.com' && /^\/bitcoin\/bitcoin\/releases\/tag\/[^/]+\/?$/.test(parsed.pathname)
    : parsed.hostname === new URL(feed.url).hostname;
} catch { return false; } };

export function impact(title, sourceId, sourceUrl = null) {
  // Stars rank a verified *release category*, not price direction or its actual value.
  const official = !FEEDS.find(f => f.id === sourceId)?.verified && sourceUrl && safeUrl(sourceUrl);
  const sourceHost = { 'bls-cpi': 'www.bls.gov', 'bls-jobs': 'www.bls.gov', 'bls-calendar': 'www.bls.gov', fed: 'www.federalreserve.gov' }[sourceId];
  const evidence = official && sourceHost && new URL(official).hostname === sourceHost ? official : null;
  const patterns = {
    'bls-cpi': [/^CPI for all items\b/i, 5, '美國官方消費者物價指數發布'],
    'bls-jobs': [/^(?:Both )?payroll employment\b/i, 5, '美國官方就業報告發布'],
    'fed': [/^Federal Reserve issues FOMC statement$/i, 5, '美國聯準會政策決議聲明'],
    'bls-calendar': [/^(?:Consumer Price Index|Employment Situation|Producer Price Index|Job Openings and Labor Turnover Survey) for /i, null, '美國官方經濟數據預定公布']
  };
  const rule = patterns[sourceId];
  const type = sourceId === 'bls-calendar' ? (/^Consumer Price Index|^Employment Situation/.test(title) ? 5 : /^Producer Price Index/.test(title) ? 4 : 3) : rule?.[1];
  const stars = evidence && rule?.[0].test(title) ? type : null;
  return { stars, impactImportance: stars, reason: stars ? `${rule[2]}；星級只表示事件類別的重要性，不表示多空或結果` : '尚未評估；標題不足以判定影響力', ruleVersion: stars ? 'official-release-category-v1' : 'unassessed-v1', evidence: stars ? evidence : null, sourceConfidence: official ? 'official-source' : null, analysisConfidence: null, direction: null, sourceId };
}

// HTML entities left inside CDATA (the XML parser only decodes XML entities).
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
  if (code[0] === '#') { const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole; }
  return NAMED[code.toLowerCase()] ?? whole;
});
const textOf = html => decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const fold = text => text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\p{S}]/gu, '');
const CJK = /[\u3040-\u30ff\u4e00-\u9fff]/;
// A short gist from the publisher's own RSS description: its first text
// paragraph without feed boilerplate, cut at a sentence boundary
// (≈100 CJK characters or ≈220 Latin characters). Never the article body.
export function sourceSummary(raw, title = '') {
  const html = String(typeof raw === 'object' ? raw?.['#text'] ?? '' : raw ?? '');
  if (!html.trim()) return null;
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m => textOf(m[1])).filter(t => t.replace(/[.…\s]/g, '').length >= 8);
  let text = paragraphs[0] ?? textOf(html);
  text = text.replace(/〈[^〉]*〉\s*這篇文章最早發佈於[\s\S]*$/, '').replace(/The post [\s\S]+ appeared first on [\s\S]*$/i, '')
    .replace(/\s*(?:Read more|Continue reading|Read the full story)[\s\S]*$/i, '')
    .replace(/^Odaily\s*星球[日報报]+[訊讯]\s*/, '').trim();
  // The publisher cut its own teaser ("[…]"): keep it visibly cut rather than ending mid-word.
  const clipped = /\[(?:…|\.\.\.)\]\s*$|…\s*$/.test(text);
  text = text.replace(/\s*\[(?:…|\.\.\.)\]\s*$/, '').replace(/[\s…]+$/, '').trim();
  const folded = fold(text), heading = fold(title);
  if (heading && folded === heading) return null;
  if (title && text.startsWith(title)) text = text.slice(title.length).replace(/^[\s:：,，。.\-–—|]+/, '');
  if (fold(text).length < 12) return null;
  const cjk = CJK.test(text), max = cjk ? 100 : 220;
  if (text.length <= max) return clipped && !/[。！？.!?]$/.test(text) ? `${text}…` : text;
  const cut = text.slice(0, max);
  const end = Math.max(...(cjk ? ['。', '！', '？', '；'] : ['. ', '! ', '? ']).map(mark => cut.lastIndexOf(mark)));
  if (end >= max * 0.45) return cut.slice(0, end + 1).trim();
  const space = cjk ? Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('、')) : cut.lastIndexOf(' ');
  return `${(space >= max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,，、;；:：]+$/, '')}…`;
}

export function normalizeFeed(xml, feed) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('XML declarations are not accepted');
  const parsed = parser.parse(xml);
  const portalNews = feed.format === 'pchome-xml' ? parsed?.news : null;
  if (!parsed?.rss?.channel && !parsed?.feed && !portalNews) throw Error('來源沒有返回 RSS 或 Atom');
  const raw = array(parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? portalNews?.item);
  return raw.map(entry => {
    let title = plain(entry.title);
    const categories = array(entry.category).map(plain);
    if(feed.allowedCategories&&!categories.some(category=>feed.allowedCategories.includes(category)))return null;
    if(feed.excludedCategories&&categories.some(category=>feed.excludedCategories.includes(category)))return null;
    const publisherUrl=plain(entry.source?.['@_url']);
    const publisher=plain(entry.source);
    if(feed.aggregator&&(!publisherUrl||feed.domain&&new URL(publisherUrl).hostname!==feed.domain))return null;
    if(feed.aggregator&&publisher&&title.endsWith(` - ${publisher}`))title=title.slice(0,-publisher.length-3);
    const links = array(entry.link);
    const preferred = links.find(value => typeof value === 'object' && (!value['@_rel'] || value['@_rel'] === 'alternate')) ?? links[0];
    const rawLink = plain(typeof preferred === 'object' ? preferred?.['@_href'] ?? preferred?.['#text'] : preferred);
    const link = safeUrl(rawLink);
    let rawDate=entry.pubDate ?? entry.published ?? entry.updated ?? (feed.format === 'pchome-xml' ? entry.pubdate : null);
    if(feed.timezone&&/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d$/.test(rawDate))rawDate=rawDate.replace(' ','T')+(feed.timezone==='Asia/Taipei'?'+08:00':'Z');
    const publishedAt = iso(rawDate);
    if (!title || !link || !verifiedForFeed(link, feed) || !publishedAt) return null;
    if (feed.id === 'kraken' && /VIP château|APY on AUSD|Pre-IPO Challenge/i.test(title)) return null;
    if (['abmedia','blocktempo','decrypt','odaily'].includes(feed.id) && !cryptoRelevant(title)) return null;
    if (['sec','cftc'].includes(feed.id) && !/bitcoin|crypto|digital asset|spot etf|exchange.traded fund/i.test(title)) return null;
    const relevantMarkets = feed.markets;
    // Release notes (Atom content) are not summaries; publisher descriptions are.
    const summary = feed.id === 'bitcoin-core' || feed.aggregator ? null : sourceSummary(entry.description ?? entry.summary, title);
    return { id: hash(feed.aggregator ? `${feed.id}:${link}` : link), title, link, publishedAt, source: feed.name, sourceId: feed.id,
      ...(summary ? { summary } : {}),
      ...(feed.aggregator?{aggregation:'Google News RSS',publisher,publisherUrl}:{}),
      ...(feed.portal?{aggregation:`${feed.name} RSS`,feedUrl:feed.url}:{}),
      markets: relevantMarkets, kind: 'news', verified: feed.verified || 'official-source', fetchedAt: new Date().toISOString(), contentType: /sponsored|sponsor|APY|challenge|giveaway|獎池|限時優惠|抽獎|贊助|業配/i.test(title) ? 'promotion' : 'news', impact: impact(title, feed.id, link) };
  }).filter(Boolean).slice(0, 50);
}

// One aggregator URL can appear in the general feed and a publisher feed.
// Keep both source attributions; the UI de-duplicates after source filtering.
// Re-key retained snapshots too, so a refresh does not keep both old/new IDs.
export function migrateAggregateHeadline(item) {
  if (item.aggregation !== 'Google News RSS' || !item.sourceId || !item.link) return item;
  return { ...item, id: hash(`${item.sourceId}:${item.link}`) };
}

export function cryptoRelevant(title) {
  return /bitcoin|ethereum|crypto|blockchain|token|stablecoin|defi|nft|web3|solana|coinbase|binance|bitget|kraken|bitcoin|比特幣|比特币|以太|加密|區塊鏈|区块链|代幣|代币|穩定幣|稳定币|空投|主網|主网|鏈上|链上|交易所|幣安|币安|幣圈|币圈|Bithumb|Zcash|Strategy|Strive|日本央行|\b(?:BTC|ETH|SOL|XRP|USDT|USDC|ETF)\b/i.test(title);
}

export async function fetchText(url, { fetcher = (...args) => fetch(...args), timeoutMs = 35000 } = {}) {
  // Some native RSS servers negotiate text/xml (e.g. DIGITIMES), not
  // application/xml. Advertise that actual format to avoid a valid HTTP 406.
  const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OXNews/1.0)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html, */*;q=0.1' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('Feed exceeds size limit');
  return text;
}

const stripTags = html => String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
const httpsLink = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } };
export function bitgetAnnouncements(body, stamp) {
  if (body.code !== '00000' || !Array.isArray(body.data)) throw Error('Bitget 公告格式無效');
  return body.data.flatMap(row => {
    const link = httpsLink(row.annUrl), title = stripTags(row.annTitle), timestamp = Number(row.cTime);
    // This timestamp is publication, not the listing/maintenance activation time.
    if (!link || new URL(link).hostname !== 'www.bitget.com' || !title || !Number.isFinite(timestamp) || timestamp <= 0 || /股票|stock|MRVLUSDT|ORCLUSDT|NTAPUSDT/i.test(title)) return [];
    return [{id:hash(link),title,link,publishedAt:new Date(timestamp).toISOString(),source:'Bitget 官方公告',sourceId:'bitget',markets:['crypto'],kind:'news',verified:'official-source',fetchedAt:stamp,contentType:'news',impact:{stars:null,ruleVersion:'unassessed-v1',reason:'官方公告，未評估影響力'}}];
  });
}

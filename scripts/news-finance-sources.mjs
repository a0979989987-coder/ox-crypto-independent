// Headlines and links only. Aggregated entries retain the aggregator URL and
// publisher domain; they are never advertised as a publisher API connection.
export const FINANCE_SOURCES = [
  ['tpex','證券櫃檯買賣中心','tpex.org.tw'],
  ['wantgoo','玩股網','wantgoo.com'], ['google-news','Google 新聞',null],
  ['cmoney','CMoney 投資網誌','cmoney.tw'], ['chinatimes','中時新聞網','chinatimes.com'],
  ['forexfactory','Forex Factory','forexfactory.com'],
  ['ebc','東森財經新聞網','fnc.ebc.net.tw'], ['msn','MSN 財經','msn.com']
].map(([id,name,domain])=>{
  const query=domain?`site:${domain} (財經 OR 股市 OR 金融 OR 產業 OR stock OR economy OR forex)`:'台股 財經';
  return {id,name,domain,url:`https://news.google.com/rss/search?${new URLSearchParams({q:query,hl:'zh-TW',gl:'TW',ceid:'TW:zh-Hant'})}`,markets:['tw'],verified:'aggregated-headline',aggregator:true};
});
export const FINANCE_FEEDS = [
  // Publisher-owned RSS endpoints; article bodies are deliberately discarded.
  {id:'cnyes',name:'鉅亨網',url:'https://news.cnyes.com/rss/v1/news/category/tw_stock',hosts:['news.cnyes.com'],markets:['tw'],verified:'publisher-feed'},
  {id:'moneydj',name:'MoneyDJ 理財網',url:'https://www.moneydj.com/kmdj/RssCenter.aspx?svc=NW&fno=1&arg=X0000000',hosts:['www.moneydj.com'],markets:['tw'],verified:'publisher-feed'},
  {id:'udn',name:'經濟日報',url:'https://money.udn.com/rssfeed/news/1001/5590/5607?ch=money',hosts:['money.udn.com'],markets:['tw'],verified:'publisher-feed'},
  {id:'ctee',name:'工商時報',url:'https://www.ctee.com.tw/rss_web/livenews/policy',hosts:['www.ctee.com.tw'],markets:['tw'],verified:'publisher-feed',timezone:'Asia/Taipei',financialOnly:true,scopeLabel:'財經篩選 RSS',usage:'僅收錄公開政策 RSS 中標題明確涉及金融市場的項目；非完整工商時報新聞。'},
  {id:'168',name:'168 財經',url:'https://168abc.net/feed',hosts:['168abc.net','www.168abc.net'],markets:['tw'],verified:'publisher-feed',allowedCategories:['168看電視','專業看盤','科技電子','江慶財專欄'],excludedCategories:['政經時事','娛樂','生活'],usage:'僅收錄財經分類的評論標題與原文連結；不轉載全文，不代表投資建議。'},
  {id:'digitimes',name:'DIGITIMES／電子時報',url:'https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_0.xml',hosts:['www.digitimes.com.tw'],markets:['tw'],verified:'publisher-feed',termsUrl:'https://www.digitimes.com.tw/tech/rss/rss.asp'},
  {id:'yahoo',name:'Yahoo',url:'https://tw.stock.yahoo.com/rss?category=tw-market',hosts:['tw.stock.yahoo.com','tw.news.yahoo.com'],markets:['tw'],verified:'portal-feed',portal:true,termsUrl:'https://tw.stock.yahoo.com/rss-index'},
  {id:'pchome',name:'PChome 股市',url:'https://news.pchome.com.tw/rss/003',hosts:['news.pchome.com.tw'],markets:['tw'],verified:'portal-feed',portal:true,format:'pchome-xml',timezone:'Asia/Taipei',termsUrl:'https://news.pchome.com.tw/member_rss'},
  {id:'ltn',name:'自由時報',url:'https://news.ltn.com.tw/rss/business.xml',hosts:['news.ltn.com.tw','ec.ltn.com.tw'],markets:['tw'],verified:'publisher-feed'},
  {id:'cna',name:'中央通訊社',url:'https://feeds.feedburner.com/rsscna/finance',hosts:['www.cna.com.tw'],markets:['tw'],verified:'publisher-feed',usage:'個人／非營利之非商業用途；標示中央通訊社，不轉載全文',termsUrl:'https://www.cna.com.tw/about/rss.aspx'},
  {id:'investing',name:'Investing',url:'https://www.investing.com/rss/news_14.rss',hosts:['www.investing.com'],markets:['tw'],verified:'publisher-feed',timezone:'UTC'}
];
export function publisherMatches(url, domain){
  try {const host=new URL(url).hostname.toLowerCase();return host===domain||host.endsWith(`.${domain}`);}catch{return false;}
}
export function financeHeadline(title){
  return /台股|美股|股市|股價|營收|財報|匯率|利率|央行|通膨|金融|債券|半導體|台積電|投信|外資|證券|期貨|基金|銀行|油價|金價|黃金|新台幣|新臺幣|美元|聯準會|\b(?:GDP|CPI|PPI|PMI|ETF|FOMC)\b/i.test(title);
}

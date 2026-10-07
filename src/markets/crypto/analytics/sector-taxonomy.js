import { TOPIC_CATALOG } from './sector-topics.js';
// Only first-level groups create chart bubbles. Second-level topics are
// searchable and show their own validated coverage in the picker.
const IDS=['meme','pow','l1','l2','modular','defi','btcfi','rwa','stablecoin','ai','depin','oracle','bridge','zk','privacy','gamefi','nft','metaverse','socialfi','identity','media','cex','payments','wallet','developer','launchpad','prediction','desci','sports','enterprise','ecosystems'];
const parsed=new Map();
for(const line of TOPIC_CATALOG.split('\n')){
 const [first,name,coins]=line.split('|');if(!first||!name||!coins)throw Error('Invalid sector topic: '+line);
 if(!parsed.has(first))parsed.set(first,[]);
 parsed.get(first).push(Object.freeze({name,candidates:Object.freeze(coins.split(' '))}));
}
if(parsed.size!==IDS.length)throw Error('Sector group IDs do not match the editorial catalog');
export const SECTOR_GROUPS=Object.freeze([...parsed].map(([name,topics],i)=>Object.freeze({
 id:IDS[i],name,topics:Object.freeze(topics),bases:Object.freeze([...new Set(topics.flatMap(t=>t.candidates))])
})));
// Bitget instruments expose a base ticker but no project identity. These
// symbols denote different projects in the supplied list. Show them as
// candidates, never silently attribute their contract to the wrong project.
export const AMBIGUOUS_BASES=Object.freeze(['BEAM','RIF','HONEY','VELO','GAL','CAT','LIT','MON','FISH','ARC','WOLF','ANDY','MAGA','OVER','RAIN']);
const ambiguous=new Set(AMBIGUOUS_BASES);
const eligible=contract=>contract?.symbolType==='crypto'&&contract.type==='perpetual'&&contract.status==='online'&&contract.quoteCoin==='USDT';
export function verifiedSectorUniverse(instruments=[],tickers=[]){
 const contracts=new Map(instruments.filter(eligible).map(row=>[row.symbol,row]));
 const quotes=new Map(tickers.filter(row=>Number(row.usdtVolume)>0).map(row=>[row.symbol,row]));
 const verify=candidate=>{const base=candidate.toUpperCase(),symbol=base+'USDT';
  return !ambiguous.has(base)&&contracts.get(symbol)?.baseCoin===base&&quotes.has(symbol)?symbol:null;};
 const sectors=SECTOR_GROUPS.map(group=>{
  const topics=group.topics.map(topic=>({...topic,members:[...new Set(topic.candidates.map(verify).filter(Boolean))]}));
  return {id:group.id,name:group.name,topics,requestedBases:group.bases,members:[...new Set(topics.flatMap(topic=>topic.members))],
   source:'https://www.bitget.com/docs/catalog/market/market-data',mapping:'OX editorial topics; Bitget verified contracts and tickers; ambiguous project tickers excluded'};
 });
 const symbols=['BTCUSDT',...new Set(sectors.flatMap(group=>group.members).filter(symbol=>symbol!=='BTCUSDT'))];
 return {sectors,symbols,instruments:symbols.map(symbol=>contracts.get(symbol)).filter(Boolean),
  tickers:symbols.map(symbol=>quotes.get(symbol)).filter(Boolean)};
}
export const withSectorCatalog=snapshot=>({...snapshot,sectors:verifiedSectorUniverse(snapshot.instruments,snapshot.tickers).sectors,taxonomyVersion:'ox-crypto-31-topics-20261007'});

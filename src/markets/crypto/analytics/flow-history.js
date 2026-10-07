// Public venue observations only: never infer taker buys from candle direction.
export function mergeFlowHistory(snapshot,archive){
 if(!snapshot||snapshot.period!=='1d'&&!snapshot.flows?.['1d'])return snapshot;
 const flows={...snapshot.flows?.['1d']};
 for(const ticker of snapshot.tickers||[]){
  const current=flows[ticker.symbol];if(!current?.response)continue;
  const records=archive?.symbols?.[ticker.symbol]||[];
  const data=[...new Map([...records,...current.response.data].map(row=>[Number(row.ts),row])).values()].sort((a,b)=>Number(a.ts)-Number(b.ts));
  flows[ticker.symbol]={...current,response:{...current.response,data}};
 }
 return {...snapshot,flows:{...snapshot.flows,'1d':flows}};
}
export function retainDailyFlow(archive,snapshot,now=Date.now()){
 const symbols={...archive?.symbols};const cutoff=now-400*86400000;
 for(const [symbol,entry] of Object.entries(snapshot.flows?.['1d']||{})){
  if(!entry.response?.data)continue;
  symbols[symbol]=[...new Map([...(symbols[symbol]||[]),...entry.response.data].filter(row=>Number(row.ts)>=cutoff&&Number.isFinite(Number(row.buyVolume))&&Number.isFinite(Number(row.sellVolume))&&Number(row.buyVolume)>=0&&Number(row.sellVolume)>=0).map(row=>[Number(row.ts),row])).values()].sort((a,b)=>Number(a.ts)-Number(b.ts));
 }
 return {schemaVersion:1,source:'Bitget',period:'1d',collectedAt:new Date(now).toISOString(),symbols};
}

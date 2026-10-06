import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const cryptoSources = new Set(['coindesk','cointelegraph','decrypt','cryptoslate','theblock','panews','foresight','blockbeats','odaily','blocktempo','abmedia','bitget','binance','coinbase','kraken','okx','ethereum','bitcoin-core','aptos','aave-governance','fed','bls-cpi','bls-jobs','nyse-calendar','ethereum-upgrades','bls-calendar','fed-calendar','bea-calendar','foresight-calendar','ecb','sec','cftc']);
export function projectCryptoSnapshot(snapshot) {
  const keep = item => item.market === 'crypto' || item.markets?.includes('crypto');
  const scope = item => ({...item, ...(item.markets ? {markets:['crypto']} : {}), ...(item.assets ? {assets:item.assets.filter(a=>a.market==='crypto')} : {})});
  return {...snapshot,
    ...Object.fromEntries(['news','pendingNews','events','eventCoverage','assetCatalog'].filter(key=>Array.isArray(snapshot[key])).map(key=>[key,snapshot[key].filter(keep).map(scope)])),
    sources:(snapshot.sources||[]).filter(item=>cryptoSources.has(item.id)).map(scope)
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const file=new URL('../data/news.json',import.meta.url);
  await writeFile(file,JSON.stringify(projectCryptoSnapshot(JSON.parse(await readFile(file,'utf8'))),null,2)+'\n');
}

"""Capture public responses for an auditable review. No generated observations."""
import urllib.request,json,time,pathlib,concurrent.futures,datetime
ROOT=pathlib.Path(__file__).resolve().parent.parent
BASE='https://api.bitget.com'
def get(url):
 for attempt in range(3):
  try:
   with urllib.request.urlopen(url,timeout=30) as r: data=json.load(r)
   if isinstance(data,dict) and 'code' in data and data['code']!='00000':raise ValueError(data)
   return data
  except Exception:
   if attempt==2:raise
   time.sleep(2+attempt*3)
def bg(path):return get(BASE+path)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 a=pool.submit(bg,'/api/v3/market/instruments?category=USDT-FUTURES');b=pool.submit(bg,'/api/v2/mix/market/tickers?productType=USDT-FUTURES');instruments=a.result();tickers=b.result()
inst={r['symbol']:r for r in instruments['data'] if r.get('symbolType')=='crypto' and r.get('type')=='perpetual' and r.get('quoteCoin')=='USDT' and r.get('status')=='online'}
groups=[('l1','公鏈 L1','layer-1',['ethereum','solana','avalanche-2','sui','near']),('defi','DeFi','decentralized-finance-defi',['uniswap','aave','curve-dao-token','ethena','pendle']),('meme','Meme','meme-token',['dogecoin','pepe','dogwifcoin','bonk','floki']),('ai','AI','artificial-intelligence',['bittensor','fetch-ai','render-token','akash-network','arkham']),('l2','擴容 L2','layer-2',['arbitrum','optimism','starknet','zksync','manta-network']),('oracle','預言機','oracle',['chainlink','pyth-network','api3','band-protocol','dia-data']),('rwa','RWA','real-world-assets-rwa',['ondo-finance','polymesh','centrifuge'])]
sectors=[];coins={};errors=[];seen=set()
for key,label,cat,ids in groups:
 url=f'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category={cat}&per_page=250&page=1'
 try:
  response=get(url);members=[]
  for coin in response:
   if coin['id'] not in ids:continue
   symbol=coin['symbol'].upper()+'USDT'
   if symbol not in inst or symbol in seen:continue
   members.append(symbol);coins[symbol]=coin;seen.add(symbol)
  sectors.append({'id':key,'name':label,'categoryId':cat,'members':members,'requestedIds':ids,'source':url,'mapping':'Explicit CoinGecko ID + matching Bitget base symbol; one primary OX group per asset.'})
  print(label,members,flush=True)
 except Exception as e:errors.append({'source':url,'error':str(e)});print('CATEGORY ERROR',cat,str(e),flush=True)
 time.sleep(2.1)
# Capture benchmark market cap separately; missing metadata stays missing.
try:
 bitcoin=get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin')
 if bitcoin and bitcoin[0]['id']=='bitcoin':coins['BTCUSDT']=bitcoin[0]
except Exception as e:errors.append({'source':'CoinGecko bitcoin market cap','error':str(e)})
# BTC is benchmark; it is never mixed into a sector return.
symbols=['BTCUSDT']+sorted(seen)
result={'schemaVersion':2,'kind':'recorded','source':'Bitget + CoinGecko','capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'requestTime':tickers['requestTime'],'sectors':sectors,'coins':coins,'instruments':[inst[s] for s in symbols],'tickers':[r for r in tickers['data'] if r['symbol'] in symbols],'candles':{},'trades':{},'funding':{},'ratios':{},'errors':errors}
def candles(symbol):
 path=f'/api/v2/mix/market/candles?symbol={symbol}&productType=USDT-FUTURES&granularity=15m&limit=200'
 try:return symbol,{'path':path,'response':bg(path)}
 except Exception as e:return symbol,{'path':path,'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for symbol,response in pool.map(candles,symbols):result['candles'][symbol]=response;print('CANDLES',symbol,len(response.get('response',{}).get('data',[])),flush=True)
for symbol in ['BTCUSDT','ETHUSDT','SOLUSDT']:
 for key,path in [('funding',f'/api/v2/mix/market/current-fund-rate?symbol={symbol}&productType=USDT-FUTURES'),('ratios',f'/api/v2/mix/market/long-short?symbol={symbol}&period=1h')]:
  try:result[key][symbol]={'path':path,'response':bg(path)}
  except Exception as e:result[key][symbol]={'path':path,'error':str(e)}
 records=[];pages=[];cursor=''
 for page in range(3):
  path=f'/api/v2/mix/market/fills-history?symbol={symbol}&productType=USDT-FUTURES&limit=1000'+('&idLessThan='+cursor if cursor else '')
  try:
   r=bg(path);pages.append({'path':path,'requestTime':r['requestTime'],'count':len(r['data'])});records.extend(r['data'])
   if not r['data']:break
   cursor=min(r['data'],key=lambda x:int(x['tradeId']))['tradeId']
  except Exception as e:pages.append({'path':path,'error':str(e)});break
  time.sleep(.4)
 result['trades'][symbol]={'records':records,'pages':pages,'coverage':'REST pages; edge bars are partial; no all-history claim'}
 print('TRADES',symbol,len(records),flush=True)
result['previousTickers']=json.loads((ROOT/'previews/data/crypto-flow-snapshot.json').read_text())['tickers']
result['captureCompletedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
(ROOT/'previews/data/crypto-tools-snapshot.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print('SAVED',len(symbols),len(sectors),flush=True)

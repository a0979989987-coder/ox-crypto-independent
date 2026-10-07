"""Capture public responses for an auditable review. No generated observations."""
import urllib.request,json,time,pathlib,concurrent.futures,datetime,subprocess
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
# Use the same verifier as the browser, including the ambiguous ticker guard.
verifier="import {verifiedSectorUniverse} from './src/markets/crypto/analytics/sector-taxonomy.js';import{readFileSync}from'node:fs';const [i,t]=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(verifiedSectorUniverse(i,t)))"
verified=json.loads(subprocess.check_output(['node','--input-type=module','-e',verifier],input=json.dumps([instruments['data'],tickers['data']]).encode(),cwd=ROOT))
sectors=verified['sectors'];symbols=verified['symbols'];errors=[]
if not any(t['symbol']=='BTCUSDT' for t in verified['tickers']):raise ValueError('BTC benchmark unavailable')
for group in sectors:print(group['name'],len(group['members']),'/',len(group['requestedBases']),flush=True)
prior=json.loads((ROOT/'previews/data/crypto-tools-snapshot.json').read_text())
result={'schemaVersion':4,'kind':'recorded','source':'Bitget; OX editorial topics; archived CoinGecko market-cap metadata','capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'requestTime':tickers['requestTime'],'sectors':sectors,'taxonomyVersion':'ox-crypto-31-topics-20261007','coins':prior.get('coins',{}),'instruments':verified['instruments'],'tickers':verified['tickers'],'candles':{},'trades':{},'funding':{},'ratios':{},'errors':errors}
def candles(symbol):
 path=f'/api/v2/mix/market/candles?symbol={symbol}&productType=USDT-FUTURES&granularity=15m&limit=200'
 try:
  response=bg(path)
  if len(response['data'])<20:raise ValueError('Insufficient closed candles')
  return symbol,{'path':path,'response':response}
 except Exception as e:return symbol,{'path':path,'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
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
result['previousTickers']=prior['tickers']
result['captureCompletedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
(ROOT/'previews/data/crypto-tools-snapshot.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
print('SAVED',len(symbols),len(sectors),flush=True)

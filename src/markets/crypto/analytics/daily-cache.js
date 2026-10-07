// A normal market snapshot has its own complete scan marker. It is not a
// completed daily scan until it actually holds verified daily BTC candles.
export function freshDaily(value,now){
 const captured=Date.parse(value?.captureCompletedAt);
 return value?.scan?.complete===true&&value.dailyCandles?.BTCUSDT?.response?.data?.length>0&&
   Number.isFinite(captured)&&now>=captured-10000&&
   now<Math.floor(captured/86400000)*86400000+86400000+120000;
}

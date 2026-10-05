// Hosted single/batch responses expose interval metadata in different fields.
// Accept only provider-confirmed identities; never infer a frame from a request.
export function confirmedChart(chart, symbol, interval) {
  const actualInterval = chart?.interval ?? chart?.meta?.dataGranularity;
  if (chart?.symbol !== symbol || actualInterval !== interval || !Array.isArray(chart?.candles)
      || (chart.meta?.symbol && chart.meta.symbol !== symbol)
      || (chart.meta?.dataGranularity && chart.meta.dataGranularity !== interval))
    throw Error(`Unexpected source identity or candle schema for ${symbol}/${interval}`);
  return { ...chart, interval: actualInterval, range: chart.range ?? chart.meta?.range ?? null };
}

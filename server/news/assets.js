// Crypto assets recognised in headlines. Shared by the collector and the live
// endpoint (/api/v1/news/latest) so both tag the same assets.
export const CRYPTO_ASSETS = [
  ['BTC', '比特幣', ['Bitcoin', '比特币'], 'bitcoin'], ['ETH', '以太坊', ['Ethereum', '以太幣', '以太币'], 'ethereum'],
  ['SOL', 'Solana', ['索拉納'], 'solana'], ['APT', 'Aptos', ['阿普托斯'], 'aptos'], ['XRP', 'XRP', ['Ripple', '瑞波'], 'xrp'],
  ['BNB', 'BNB', ['Binance Coin', '幣安幣'], 'bnb'], ['DOGE', '狗狗幣', ['Dogecoin', '狗狗币'], 'dogecoin'],
  ['ADA', 'Cardano', ['艾達幣'], 'cardano'], ['LINK', 'Chainlink', ['鏈結幣'], 'chainlink'], ['AVAX', 'Avalanche', ['雪崩'], 'avalanche'],
  ['AAVE', 'Aave', [], 'aave'], ['UNI', 'Uniswap', [], 'uniswap'], ['NEAR', 'NEAR Protocol', ['NEAR Intents'], 'near'],
  ['SUI', 'Sui', [], 'sui'], ['ARB', 'Arbitrum', [], 'arbitrum'], ['OP', 'Optimism', [], 'optimism'],
  ['USDT', 'Tether', ['泰達幣'], 'tether'], ['USDC', 'USD Coin', [], 'usd-coin'], ['TRX', 'TRON', ['波場'], 'tron']
].map(([symbol, name, aliases, projectId]) => ({ id: `crypto:${projectId}`, market: 'crypto', symbol, name, aliases: [...aliases, projectId], projectId, venueSymbol: ['USDT', 'USDC'].includes(symbol) ? null : `${symbol}USDT` }));
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function identifyAssets(title, markets, catalog = []) {
  const assets = [];
  for (const asset of [...catalog, ...CRYPTO_ASSETS]) {
    if (asset.market !== 'crypto' || !markets.includes(asset.market)) continue;
    const named = [asset.name, ...(asset.aliases || [])].filter(n => n.length >= 2 && !['near', 'op', 'one', 'gas'].includes(n.toLowerCase())).some(name => /[\u4e00-\u9fff]/.test(name) ? title.includes(name) : new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, 'i').test(title));
    const symbol = !['OP', 'NEAR', 'LINK'].includes(asset.symbol) && new RegExp(`(?<![A-Za-z0-9])\\$?${escape(asset.symbol)}(?![A-Za-z0-9])`).test(title);
    if (named || symbol) assets.push(asset);
  }
  return [...new Map(assets.map(a => [a.id, a])).values()];
}

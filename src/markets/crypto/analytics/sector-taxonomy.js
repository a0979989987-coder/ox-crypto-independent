// OX editorial observation groups requested on 2026-10-07. Membership can
// overlap; it is not a CoinGecko category feed or an investment classification.
// A candidate is used for calculations only after Bitget confirms an online
// crypto USDT perpetual contract, a matching base coin, and a positive ticker.
export const SECTOR_GROUPS = Object.freeze([
  ['pow', 'BTC／PoW', 'BTC LTC BCH DOGE KAS ETC'],
  ['l1', 'Layer 1', 'ETH SOL BNB SUI ADA AVAX TON NEAR APT SEI HBAR'],
  ['l2', 'Layer 2', 'ARB OP STRK MNT ZK METIS IMX MANTA'],
  ['defi', 'DeFi', 'AAVE UNI SKY CRV PENDLE ENA LDO COMP'],
  ['dex', 'DEX', 'HYPE UNI JUP CAKE RAY CRV 1INCH RUNE'],
  ['lending', '借貸 Lending', 'AAVE MORPHO COMP SKY SPK FLUID'],
  ['derivatives', '永續／衍生品', 'HYPE DYDX GMX DRIFT APEX'],
  ['liquid-staking', 'Liquid Staking', 'LDO JTO RPL ANKR BNC'],
  ['restaking', 'Restaking', 'EIGEN ETHFI SSV PUFFER PENDLE'],
  ['rwa', 'RWA', 'LINK ONDO QNT XLM SYRUP CFG POLYX'],
  ['oracle', 'Oracle／Data', 'LINK PYTH BAND API3 TRB GRT DIA'],
  ['bridge', '跨鏈／互操作', 'ZRO W AXL ZETA SYN'],
  ['modular', 'Modular／DA', 'TIA AVAIL EIGEN SKL MOVE'],
  ['ai', 'AI', 'TAO NEAR FET/ASI RENDER AKT VIRTUAL KAITO ARKM'],
  ['depin', 'DePIN', 'TAO RENDER FIL HNT GRASS AKT AIOZ'],
  ['storage', '去中心化儲存／運算', 'FIL AR STORJ AIOZ WAL'],
  ['gamefi', 'GameFi', 'IMX RON GALA BEAM AXS SAND MANA YGG'],
  ['meme', 'Meme', 'DOGE SHIB PEPE BONK WIF FLOKI PENGU PUMP'],
  ['privacy', 'Privacy／ZK', 'ZEC XMR SCRT ROSE MINA ZK STRK'],
  ['nft', 'NFT／Consumer', 'APE PENGU BLUR LOOKS'],
  ['socialfi', 'SocialFi', 'KAITO ZORA DEGEN MASK'],
  ['payments', '支付', 'XRP XLM LTC BCH XNO CELO'],
  ['cex', 'CEX 交易所幣', 'BNB BGB OKB CRO KCS GT LEO WBT'],
  ['btcfi', 'BTCFi／Bitcoin 生態', 'STX CORE BABY SOLV ORDI SATS']
].map(([id,name,bases])=>Object.freeze({id,name,bases:Object.freeze(bases.split(' '))})));

const candidates = base => base === 'FET/ASI' ? ['FET', 'ASI'] : [base];
const eligible = contract => contract?.symbolType === 'crypto' && contract.type === 'perpetual'
  && contract.status === 'online' && contract.quoteCoin === 'USDT';

export function verifiedSectorUniverse(instruments = [], tickers = []) {
  const contracts = new Map(instruments.filter(eligible).map(row=>[row.symbol,row]));
  const quotes = new Map(tickers.filter(row=>Number(row.usdtVolume)>0).map(row=>[row.symbol,row]));
  const sectors = SECTOR_GROUPS.map(group=>{
    const members = group.bases.flatMap(base=>{
      const selected=candidates(base).find(candidate=>{
        const symbol=candidate+'USDT';
        return contracts.get(symbol)?.baseCoin===candidate && quotes.has(symbol);
      });
      return selected ? [selected+'USDT'] : [];
    });
    return {id:group.id,name:group.name,members,requestedBases:group.bases,
      source:'https://www.bitget.com/docs/catalog/market/market-data',mapping:'OX editorial overlap; Bitget verified contracts and tickers'};
  });
  const symbols=['BTCUSDT',...new Set(sectors.flatMap(group=>group.members).filter(symbol=>symbol!=='BTCUSDT'))];
  return {sectors,symbols,instruments:symbols.map(symbol=>contracts.get(symbol)).filter(Boolean),
    tickers:symbols.map(symbol=>quotes.get(symbol)).filter(Boolean)};
}

export const withSectorCatalog = snapshot => ({...snapshot,
  sectors:verifiedSectorUniverse(snapshot.instruments,snapshot.tickers).sectors,
  taxonomyVersion:'ox-crypto-24-20261007'});

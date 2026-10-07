// Translate familiar labels while preserving ticker symbols and original text.
const terms=[['Ethereum Ecosystem Summit','以太坊生態高峰會'],['TOKEN2049 Singapore','TOKEN2049 新加坡峰會'],['Bitcoin Core','比特幣核心客戶端'],['Hunter Biden','杭特・拜登'],['Ethos Network','Ethos 網路'],['Sonic Labs','Sonic 實驗室'],['CME Group','芝加哥商品交易所'],['Frontiers','前沿峰會'],['Singapore','新加坡'],['Pre-IPO','上市前'],['Annual','年度']];
export function localizeNewsText(value){let text=String(value??'');for(const [original,translation] of terms)text=text.replaceAll(original,translation);return text;}

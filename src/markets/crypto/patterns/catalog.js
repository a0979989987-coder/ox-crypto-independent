// Template paths are drawings, never market candles. y increases with price.
const points = values => values.map((y, i) => ({ x: i / (values.length - 1), y }));
const item = (id, name, group, values, rule = id) => ({ id, name, group, points: points(values), rule });
export const PATTERNS = [
  item('horizontal-resistance', '水平阻力', '水平阻力／支撐', [.5,.5], 'level-resistance'),
  item('horizontal-support', '水平支撐', '水平阻力／支撐', [.5,.5], 'level-support'),
  item('trend-up', '上升趨勢線', '趨勢線', [0,1], 'trend-support'),
  item('trend-down', '下降趨勢線', '趨勢線', [1,0], 'trend-resistance'),
  item('w', 'W 底・雙底', '常見型態', [1, 0, .8, .06, 1]),
  item('m', 'M 頂・雙頂', '常見型態', [0, 1, .2, .94, 0]),
  item('triangle', '對稱三角收斂', '常見型態', [1, 0, .86, .17, .7, .32, .56]),
  item('ascending', '上升三角・水平壓力', '常見型態', [1, 0, .99, .28, 1, .56, .98]),
  item('descending', '下降三角・水平支撐', '常見型態', [0, 1, .01, .72, 0, .44, .02]),
  item('range', '箱型・水平整理', '常見型態', [1, 0, .97, .03, 1, .02, .98]),
  item('ihs', '頭肩底', '反轉型態', [1, .3, .82, 0, .8, .32, 1]),
  item('hs', '頭肩頂', '反轉型態', [0, .7, .18, 1, .2, .68, 0]),
  item('triple-bottom', '三重底', '反轉型態', [1, 0, .85, .04, .86, .02, 1]),
  item('triple-top', '三重頂', '反轉型態', [0, 1, .15, .96, .14, .98, 0]),
  item('falling-wedge', '下降楔形', '整理與延續', [1, .22, .72, .11, .44, 0, .21]),
  item('rising-wedge', '上升楔形', '整理與延續', [0, .78, .28, .89, .56, 1, .79]),
  item('broadening', '擴散三角・喇叭口', '整理與延續', [.55, .4, .72, .23, .86, .08, 1]),
  item('channel-up', '上升通道', '整理與延續', [0, .42, .18, .63, .38, .82, .6, 1]),
  item('channel-down', '下降通道', '整理與延續', [1, .58, .82, .37, .62, .18, .4, 0]),
  item('flag-up', '多頭旗形', '整理與延續', [0, 1, .6, .85, .48, .72, .36]),
  item('flag-down', '空頭旗形', '整理與延續', [1, 0, .4, .15, .52, .28, .64]),
  item('pennant-up', '多頭三角旗', '整理與延續', [0, 1, .5, .89, .6, .79, .68]),
  item('pennant-down', '空頭三角旗', '整理與延續', [1, 0, .5, .11, .4, .21, .32]),
  item('v-bottom', 'V 型反轉向上', '走勢路徑', [1, .65, .26, 0, .28, .67, 1], 'path'),
  item('v-top', '倒 V 反轉向下', '走勢路徑', [0, .35, .74, 1, .72, .33, 0], 'path'),
  item('round-bottom', '圓弧底', '走勢路徑', [1, .55, .22, .05, 0, .05, .22, .55, 1], 'path'),
  item('round-top', '圓弧頂', '走勢路徑', [0, .45, .78, .95, 1, .95, .78, .45, 0], 'path'),
  item('cup', '杯柄・向上路徑', '走勢路徑', [1, .45, .08, 0, .08, .45, .96, .7, 1], 'path'),
  item('cup-down', '倒杯柄・向下路徑', '走勢路徑', [0, .55, .92, 1, .92, .55, .04, .3, 0], 'path'),
  item('retest-up', '突破後回踩', '走勢路徑', [.1, .6, .18, .6, .28, 1, .6, .86], 'path'),
  item('retest-down', '跌破後反抽', '走勢路徑', [.9, .4, .82, .4, .72, 0, .4, .14], 'path'),
  item('stairs-up', '高低點階梯上升', '走勢路徑', [0, .35, .2, .65, .48, 1, .82], 'path'),
  item('stairs-down', '高低點階梯下降', '走勢路徑', [1, .65, .8, .35, .52, 0, .18], 'path'),
];
// Ratio constraints are deliberately separate from visual similarity.
// Fixed Fibonacci targets: ±5% relative tolerance; ranges retain hard boundaries.
const harmonics = [
  ['gartley', '加特利 Gartley', [0, 1, .382, .832, .214], { ab:[.618,.618], bc:[.382,.886], cd:[1.13,1.618], ad:[.786,.786], equal:[1,1] }],
  ['bat', '蝙蝠 Bat', [0, 1, .5, .8, .114], { ab:[.382,.618], bc:[.382,.886], cd:[1.618,2.618], ad:[.886,.886], equal:[1,1.618] }],
  ['butterfly', '蝴蝶 Butterfly', [0, 1, .214, .714, -.27], { ab:[.786,.786], bc:[.382,.886], cd:[1.618,2.24], ad:[1.27,1.27], equal:[1,1.618] }],
  ['crab', '螃蟹 Crab', [0, 1, .4, .9, -.618], { ab:[.382,.618], bc:[.382,.886], cd:[2.618,3.618], ad:[1.618,1.618], equal:[1,4] }],
  ['deep-crab', '深蟹 Deep Crab', [0, 1, .114, .69, -.618], { ab:[.886,.886], bc:[.382,.886], cd:[2.24,3.618], ad:[1.618,1.618], equal:[1,2] }],
  ['alt-bat', '延伸蝙蝠 Alternate Bat', [0, 1, .65, .93, -.13], { ab:[.2,.382], bc:[.382,.886], cd:[2,4.236], ad:[1.13,1.13], equal:[1.618,4] }],
  ['abcd', '等幅 AB＝CD', [1, 0, .618, -.382], { bc:[.382,.886], cd:[1.13,2.618], equal:[1,1] }],
  ['abcd127', '延伸 CD＝1.27 AB', [1, 0, .618, -.652], { bc:[.382,.886], cd:[1.13,3.618], equal:[1.27,1.27] }],
  ['abcd1618', '延伸 CD＝1.618 AB', [1, 0, .618, -1], { bc:[.382,.886], cd:[1.13,4.236], equal:[1.618,1.618] }],
];
for (const [id,name,values,ratios] of harmonics) {
  for (const bullish of [true,false]) PATTERNS.push({
    ...item(`${id}-${bullish?'bull':'bear'}`, `${name}・${bullish?'多':'空'}`, '諧波比例', values.map(y=>bullish?y:1-y), 'harmonic'), ratios,
    labels: values.length===5?['X','A','B','C','D']:['A','B','C','D'],
  });
}
export const patternById = id => PATTERNS.find(p => p.id === id);
export const TIMEFRAMES = Object.freeze({ '1m':60, '3m':180, '5m':300, '15m':900, '30m':1800, '1H':3600, '4H':14400, '6H':21600, '12H':43200, '1D':86400, '1W':604800 });
// Bitget 1Wutc opens Monday 00:00 UTC; Unix weeks otherwise begin Thursday.
export const candleBoundary=(ms,frame)=>{
  const seconds=TIMEFRAMES[frame],offset=frame==='1W'?345600:0;
  return Math.floor((ms/1000-offset)/seconds)*seconds+offset;
};

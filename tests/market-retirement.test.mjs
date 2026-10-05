import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {MARKET_IDS} from '../src/core/config.js';
import {retireMarketStorage} from '../src/app/storage-migrations.js';
test('only supported markets are registered and retired endpoints/files are absent',()=>{
  assert.deepEqual(MARKET_IDS,['crypto']);
  for(const path of ['src/markets/tw','server/markets/tw','api/v1/tw/[endpoint].js','src/markets/us','server/markets/us','api/v1/us/[endpoint].js','data/us-directory.json','.github/workflows/update-us.yml'])
    assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path);
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/data-market-choice="(?:us|tw)"|markets\/(?:us|tw)|us2-/);
});
test('retired local preferences are removed without touching accounts or remaining watchlists',()=>{
  const area=Object.assign(Object.create({removeItem(key){delete this[key];},getItem(key){return this[key];},setItem(key,value){this[key]=value;}}),{
    'ox-us-v2:watchlist':'[]','ox-us-data-api-base':'old','ox-active-market':'us','ox-watchlist':'crypto','ox-tw-watchlist':'tw','account-token':'private','ox-theme-mode':'light'});
  let deleted;retireMarketStorage(area,{}, {deleteDatabase(name){deleted=name;}});
  assert.equal(deleted,'ox-us-device');assert.equal(area['ox-active-market'],'crypto');
  assert.equal(area['ox-us-v2:watchlist'],undefined);assert.equal(area['ox-us-data-api-base'],undefined);
  assert.equal(area['ox-watchlist'],'crypto');assert.equal(area['ox-tw-watchlist'],'tw');assert.equal(area['account-token'],'private');assert.equal(area['ox-theme-mode'],'light');
});

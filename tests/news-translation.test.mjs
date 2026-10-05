import test from 'node:test';import assert from 'node:assert/strict';
import {translateHeadlines} from '../scripts/news-translation.mjs';
test('headlines receive Traditional Chinese translations while reviewed titles and numeric placeholders stay untouched',async()=>{
 const items=[{title:'Crypto market update'},{title:'Reviewed headline',titleZh:'已核對標題'},{title:'00416a'}];let calls=0;const result=await translateHeadlines(items,{fetcher:async url=>{calls++;assert.equal(url.searchParams.get('tl'),'zh-TW');return {ok:true,json:async()=>[[['加密市場動態','Crypto market update']]]};}});assert.equal(calls,1);assert.equal(items[0].titleZh,'加密市場動態');assert.equal(items[0].translationMethod,'machine-title-only');assert.equal(items[1].titleZh,'已核對標題');assert.equal(result.translated,1);
});
test('translation errors never claim completion or fabricate an original-language title',async()=>{const items=[{title:'English news'}];await translateHeadlines(items,{fetcher:async()=>({ok:true,json:async()=>[[['English news']]]})});assert.equal(items[0].titleZh,undefined);assert.equal(items[0].translationStatus,undefined);});

import test from 'node:test';
import assert from 'node:assert/strict';
import {repairCatalogTitleCollectionTruth as repair} from '../title-collection-truth-v18.mjs';
test('existing Persian spelling does not prevent looking up a prefixed collection id',async t=>{
 const urls=[];t.mock.method(globalThis,'fetch',async url=>{urls.push(url);return {ok:true,json:async()=>({name:'مجموعهٔ ستاره‌های شب'})}});
 const item={type:'movie',name:'Night One',nameFa:'شب اول',collectionId:'tmdb:123456',collectionName:'Custom Night Collection',collectionNameFa:'کالکشن کاستوم نایت'};
 await repair({items:[item]},{token:'mock',requestDelayMs:1}); assert.match(urls[0],/\/collection\/123456\?language=fa-IR$/);assert.match(item.collectionNameFa,/ستاره/);assert.equal(item.collectionNameFaSource,'tmdb-fa:tmdb:123456');
});

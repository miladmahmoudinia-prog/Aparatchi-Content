import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('function collectEpisodes(value)'), source.indexOf('function translateGenres(value)'));
const collect = vm.runInNewContext(block + '\ncollectEpisodes');
test('series detail recommendations cannot become archive episodes', () => {
  const result = collect({season: {'1': [{id:'real',episode:1,series_id:'target'}]}, similar:[{id:'unrelated',episode:20,type:'series'}], offer:[{id:'offer',episode:0}], casts:[{id:'person',series_id:'target'}]});
  assert.deepEqual(Array.from(result, x=>x.id), ['real']);
});
test('nested season pages retain all real episodes while rejecting zero-number title rows', () => {
  const result = collect({data:{season:{data:[{id:'e2',episode_number:2},{id:'e3',episodeNumber:3},{id:'series-row',episode:'0'}]}}});
  assert.deepEqual(Array.from(result,x=>x.id), ['e2','e3']);
});
test('explicit special episodes and paginated episode lists are retained', () => {
  const result = collect({episodes:[{id:'special',type:'episode',episode:0},{id:'e1',episode:1}]});
  assert.deepEqual(Array.from(result,x=>x.id), ['special','e1']);
});
const keys = source.slice(source.indexOf('const AFFILIATE_URL_KEYS ='), source.indexOf('const PERSIAN_EPISODE_ORDINAL'));
const extraction = source.slice(source.indexOf('function extractAffiliateLinkRecords'),source.indexOf('function panelTrafficFlag'));
const extract = vm.runInNewContext(keys + extraction + '\nextractAffiliateLinkRecords', {cleanText:x=>String(x||'').trim(),isHttp:x=>/^https?:\/\//.test(x),uniqueStrings:x=>[...new Set(x)]});
test('a record preserves both download and online-only URLs with pricing evidence',()=>{
 const rows=extract({download_url:'https://cdn.test/a.mp4',hls:'https://cdn.test/a.m3u8',amount:0});
 assert.equal(rows.length,2);assert.deepEqual(Array.from(rows,x=>x.link),['https://cdn.test/a.mp4','https://cdn.test/a.m3u8']);assert.ok(rows.every(x=>x.amount===0));
});
test('nested player records retain explicit paid evidence',()=>{
 const rows=extract({player:{url:'https://cdn.test/paid.m3u8',amount:2000}});
 assert.equal(rows.length,1);assert.equal(rows[0].amount,2000);
});

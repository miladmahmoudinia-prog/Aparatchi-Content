import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../enrich-tmdb.mjs', import.meta.url), 'utf8');

test('TMDB details include translations together with cast and crew', () => {
  assert.ok(source.includes("append_to_response: 'aggregate_credits,keywords,images,translations'"));
  assert.ok(source.includes("append_to_response: 'credits,keywords,images,translations'"));
  assert.ok(source.includes('function buildTmdbPeople(details, mediaType)'));
});

test('missing overview prefers Persian TMDB translation and falls back to TMDB overview', () => {
  assert.ok(source.includes("cleanText(entry?.iso_639_1).toLowerCase() === 'fa'"));
  assert.ok(source.includes('const overview = translatedOverview || cleanText(details?.overview);'));
  assert.ok(source.includes('...(overview ? { overview } : {})'));
});

test('provider placeholder overview is treated as missing and gets a v2 audit', () => {
  assert.ok(source.includes('function isMissingOverview(value)'));
  assert.ok(source.includes('توضیحی\\s+ثبت\\s+نشده'));
  assert.ok(source.includes('Number(cached?.metadata?.overviewAuditVersion || 0) >= 2'));
  assert.ok(source.includes('overviewAuditVersion: 2'));
  assert.ok(source.includes('if (isMissingOverview(item.overview) && metadataOverview) item.overview = metadataOverview;'));
});

test('a real existing overview is still never overwritten', () => {
  const assignment = 'if (isMissingOverview(item.overview) && metadataOverview) item.overview = metadataOverview;';
  assert.ok(source.includes(assignment));
  assert.ok(!source.includes('if (metadataOverview) item.overview = metadataOverview;'));
});

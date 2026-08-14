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

test('overview audit invalidates old TMDB cache once without overwriting existing descriptions', () => {
  assert.ok(source.includes('Number(cached?.metadata?.overviewAuditVersion || 0) >= 1'));
  assert.ok(source.includes('overviewAuditVersion: 1'));
  assert.ok(source.includes('if (!cleanText(item.overview) && metadataOverview) item.overview = metadataOverview;'));
});

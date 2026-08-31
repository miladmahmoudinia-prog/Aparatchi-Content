import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { classifyCatalogItem } from '../classification.mjs';

test('Az Be stays documentary even when Drama is also present', () => {
  const item = classifyCatalogItem({
    type: 'series',
    ir: true,
    nameFa: 'از بی',
    name: 'Az Be',
    genres: ['مستند', 'درام'],
  });
  assert.equal(item.isDocumentary, true);
  assert.ok(item.categoryKeys.includes('documentaries'));
  assert.ok(!item.categoryKeys.includes('iranian-series'));
});

test('The Westies is never classified as Iranian series from stale flags', () => {
  const item = classifyCatalogItem({
    type: 'series',
    ir: true,
    nameFa: 'وستی ها',
    name: 'The Westies',
    genres: ['درام'],
  });
  assert.ok(!item.categoryKeys.includes('iranian-series'));
});

test('sync source has no Persian UI fallback named نسخه اصلی', () => {
  const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');
  assert.ok(!source.includes("return 'نسخه اصلی'"));
  assert.ok(source.includes('MEDIA_LANGUAGE_AUDIT_VERSION = 8'));
  assert.ok(source.includes("UPERA_SYNC_MODE || 'AUTO'"));
});

test('Iranian lane is independent, exact-country and sequential for one new title', () => {
  const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes("syncModeSetting === 'IRANIAN'"));
  assert.ok(source.includes("country: 'IR'"));
  assert.ok(source.includes('if (existing && !isLocked)'));
  assert.ok(source.includes('state.iranianSeriesActiveId'));
  assert.ok(source.includes('IRANIAN_SERIES_REBUILD_VERSION = 1'));
});


test('language audit preserves existing direct media and never guesses extensionless portals', () => {
  const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('const mergedMedia = options.replaceMedia === true'));
  assert.ok(source.includes('return isDownloadableMediaUrl(link?.link);'));
  assert.ok(source.includes('reconcileStoredLanguageSections'));
});

test('Iranian sequential cursor has a persistent active source id', () => {
  const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('iranianSeriesActiveId'));
  assert.ok(source.includes('const lockedId = cleanText(state.iranianSeriesActiveId'));
});


test('panel series season endpoint uses POST', () => {
  const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function fetchPanelSeriesEpisodes(seriesId)');
  const end = source.indexOf('\nasync function fetchScopedArchivePage', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.ok(block.includes("fetchPanelJson(url, { method: 'POST' })"));
  assert.ok(!block.includes('const json = await fetchPanelJson(url);'));
});

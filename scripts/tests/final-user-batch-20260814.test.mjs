import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const base = (extra = {}) => ({
  id: 'x', type: 'movie', ir: false, nameFa: 'آزمون', name: 'Test', year: 2026,
  poster: 'https://img.test/a.jpg', backdrop: 'https://img.test/b.jpg',
  overview: 'test', genres: ['درام'], ...extra,
});

test('client languages come from actual links, never stale badges', () => {
  const item = base({ availableLanguages: ['dubbed','subtitled'], downloads: [{ id: 's', title: 'زیرنویس فارسی', files: [
    { id: 'f', mode: 'download', url: 'https://cdn.test/sub.mp4', language: 'subtitled' },
  ]}] });
  const { index } = buildClientCatalogArtifacts({ items: [item] });
  assert.deepEqual(index.items[0].availableLanguages, ['subtitled']);
});

test('one URL cannot create both dubbed and subtitled choices', () => {
  const item = base({ downloads: [{ id: 's', files: [
    { id: 'd', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'dubbed' },
    { id: 'u', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'subtitled' },
  ]}] });
  const { index } = buildClientCatalogArtifacts({ items: [item] });
  assert.equal(index.items.length, 0);
});

test('foreign unlabeled original media stays visible without fake language labels', () => {
  const item = base({ downloads: [{ id: 's', files: [
    { id: 'f', mode: 'download', url: 'https://cdn.test/original.mp4' },
  ]}] });
  const { index, detailFiles } = buildClientCatalogArtifacts({ items: [item] });
  assert.equal(index.items.length, 1);
  assert.deepEqual(index.items[0].availableLanguages, []);
  const detail = JSON.parse(detailFiles[0].serialized);
  assert.equal(detail.downloads[0].files[0].language, undefined);
});

test('unverified operator-only records are hidden', () => {
  const item = base({ operatorOnly: true, categoryKeys: ['mobile-operator'], downloads: [{ id: 'o', files: [
    { id: 'p', mode: 'operator-play', operatorOnly: true, panelVerified: false, trafficOo: 1, url: 'https://video.upera.tv/x' },
  ]}] });
  const { index } = buildClientCatalogArtifacts({ items: [item] });
  assert.equal(index.items.length, 0);
});

test('verified operator-only records stay visible and keep their badge category', () => {
  const item = base({ operatorOnly: true, categoryKeys: ['mobile-operator'], downloads: [{ id: 'o', files: [
    { id: 'p', mode: 'operator-play', operatorOnly: true, panelVerified: true, trafficOo: 1, url: 'https://video.upera.tv/x' },
  ]}] });
  const { index } = buildClientCatalogArtifacts({ items: [item] });
  assert.equal(index.items.length, 1);
  assert.equal(index.items[0].operatorOnly, true);
  assert.ok(index.items[0].categoryKeys.includes('mobile-operator'));
});


test('operator URL truth uses an actual HTTPS boolean check', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../client-catalog.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes("startsWith('https://')"));
  assert.ok(!source.includes('/^https:///i.test'));
});
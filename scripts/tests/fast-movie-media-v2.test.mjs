import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const baseMovie = (id, downloads, extra = {}) => ({
  id,
  type: 'movie',
  nameFa: id,
  name: id,
  ir: false,
  categoryKeys: ['movies', 'foreign-movies'],
  downloads,
  ...extra,
});

test('contradictory dubbed/subtitled URL is preserved neutrally instead of disappearing', () => {
  const shared = 'https://cdn.test/shared.mp4';
  const catalog = {
    version: 'fast-media', updatedAt: '2026-08-15T00:00:00.000Z',
    items: [baseMovie('conflict', [
      { id: 'dub', title: 'دوبله فارسی', files: [{ id: 'd', mode: 'download', language: 'dubbed', url: shared, quality: '720p' }] },
      { id: 'sub', title: 'زیرنویس فارسی', files: [{ id: 's', mode: 'play', language: 'subtitled', url: shared, quality: '720p' }] },
    ])],
  };
  const artifacts = buildClientCatalogArtifacts(catalog);
  assert.equal(artifacts.index.items.length, 1);
  const summary = artifacts.index.items[0];
  const summaryFiles = summary.downloads.flatMap((section) => section.files || []);
  assert.equal(summaryFiles.length, 1);
  assert.equal(summaryFiles[0].url, shared);
  assert.equal(summaryFiles[0].language, undefined);
  assert.deepEqual(summary.availableLanguages, []);

  const detail = JSON.parse(artifacts.detailFiles[0].serialized);
  const detailFiles = detail.downloads.flatMap((section) => section.files || []);
  assert.equal(detailFiles.length, 1);
  assert.equal(detailFiles[0].url, shared);
  assert.equal(detailFiles[0].language, undefined);
});

test('verified movie media is embedded compactly in client and bootstrap summaries', () => {
  const catalog = {
    version: 'fast-media', updatedAt: '2026-08-15T00:00:00.000Z',
    imdbTop100: { movies: [{ rank: 1, imdb: 'tt1', title: 'One' }], series: [{ rank: 1, imdb: 'tt2', title: 'Two' }] },
    items: [
      baseMovie('dubbed', [{
        id: 'dub', title: 'دوبله فارسی', files: [
          { id: 'd720', mode: 'download', language: 'dubbed', url: 'https://cdn.test/d720.mp4', quality: '720p', size: '1 GB' },
          { id: 'd1080', mode: 'download', language: 'dubbed', url: 'https://cdn.test/d1080.mp4', quality: '1080p', size: '2 GB' },
        ],
      }]),
      baseMovie('iranian-stream', [], { ir: true, countryCodes: ['IR'], categoryKeys: ['movies', 'iranian-movies'], streamUrl: 'https://cdn.test/iranian.m3u8', streamMode: 'hls' }),
    ],
  };
  const artifacts = buildClientCatalogArtifacts(catalog);
  const dubbed = artifacts.index.items.find((item) => item.id === 'dubbed');
  assert.ok(dubbed?.downloads?.length);
  assert.deepEqual(dubbed.availableLanguages, ['dubbed']);
  assert.equal(dubbed.downloads[0].files.length, 2);
  assert.equal('people' in dubbed, false);

  const iranian = artifacts.index.items.find((item) => item.id === 'iranian-stream');
  assert.equal(iranian?.streamUrl, 'https://cdn.test/iranian.m3u8');

  const bootstrapDubbed = artifacts.bootstrap.items.find((item) => item.id === 'dubbed');
  assert.ok(bootstrapDubbed?.downloads?.length);
});

test('real generated bootstrap stays bounded, complete for navigation, and contains immediate Home movie media after rebuild', async () => {
  if (process.env.EXPECT_GENERATED_FAST_MEDIA !== '1') return;
  const [bootstrapRaw, indexRaw] = await Promise.all([
    fs.readFile('catalog-bootstrap.json', 'utf8'),
    fs.readFile('catalog-index.json', 'utf8'),
  ]);
  const bootstrap = JSON.parse(bootstrapRaw);
  const index = JSON.parse(indexRaw);
  const movieMediaCount = (bootstrap.items || []).filter((item) => item.type === 'movie' && (
    (item.downloads || []).some((section) => (section.files || []).some((file) => /^https?:\/\//i.test(String(file.url || '')))) ||
    /^https?:\/\//i.test(String(item.streamUrl || ''))
  )).length;
  assert.equal(bootstrap.items.length, index.items.length, 'bootstrap must include every client-visible navigation item');
  const count = (payload, key) => payload.items.filter((item) => (item.categoryKeys || []).includes(key)).length;
  assert.equal(count(bootstrap, 'dubbed'), count(index, 'dubbed'), 'bootstrap dubbed category must not be sampled/truncated');
  assert.ok(Buffer.byteLength(bootstrapRaw) < 10_000_000, 'Complete navigation bootstrap must remain under 10 MB');
  assert.ok(Buffer.byteLength(bootstrapRaw) < Buffer.byteLength(indexRaw), 'bootstrap must stay smaller than the full client index');
  assert.ok(movieMediaCount >= 5, `expected immediate media for rich Home movies, found ${movieMediaCount}`);
});

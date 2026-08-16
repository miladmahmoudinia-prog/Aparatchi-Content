import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';
import { applyVerifiedPersianTitleOverrides } from '../persian-title-overrides.mjs';

const usableMovieMedia = (item) => item?.type === 'movie' && Array.isArray(item.downloads) && item.downloads.length > 0;

test('verified Twisted Metal Persian display title is the proper translation', () => {
  const catalog = { items: [{ id: 'twisted', type: 'series', name: 'Twisted Metal', nameFa: 'تویستد متال' }] };
  const changes = applyVerifiedPersianTitleOverrides(catalog);
  assert.ok(changes.titleChanges >= 1);
  assert.equal(catalog.items[0].nameFa, 'فلز درهم‌تنیده');
  assert.equal(catalog.items[0].nameFaSource, 'verified-override');
});

test('bootstrap carries immediate lightweight actions for every media-equipped client movie', async () => {
  const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
  const artifacts = buildClientCatalogArtifacts(catalog);
  const clientMovies = artifacts.index.items.filter(usableMovieMedia);
  const bootstrapMovies = artifacts.bootstrap.items.filter(usableMovieMedia);
  assert.equal(bootstrapMovies.length, clientMovies.length);
  for (const item of bootstrapMovies) {
    const files = item.downloads.flatMap((section) => section.files || []);
    assert.ok(files.length > 0, 'every media-equipped client movie has an immediate bootstrap action');
  }
  const bootstrapBytes = Buffer.byteLength(JSON.stringify(artifacts.bootstrap));
  const clientBytes = Buffer.byteLength(JSON.stringify(artifacts.index));
  assert.ok(bootstrapBytes < clientBytes, 'bootstrap remains smaller than the full client index');
  console.log(JSON.stringify({ clientMovies: clientMovies.length, bootstrapMovies: bootstrapMovies.length, bootstrapBytes, clientBytes }));
});

test('client ordering is real add/update freshness, not production year', () => {
  const media = (id) => [{ id: `${id}-media`, files: [{ id: `${id}-file`, mode: 'download', url: `https://cdn.test/${id}.mp4` }] }];
  const catalog = { items: [
    { id: 'new-year-old-update', type: 'movie', name: 'New Year', nameFa: 'سال جدید', year: 2026, poster: 'https://img.test/a.jpg', backdrop: 'https://img.test/a-bg.jpg', downloads: media('a'), firstSeenAt: '2026-08-01T00:00:00Z' },
    { id: 'old-year-fresh-update', type: 'series', name: 'Old Year Fresh', nameFa: 'قدیمی تازه', year: 2015, poster: 'https://img.test/b.jpg', backdrop: 'https://img.test/b-bg.jpg', downloads: [{ id: 'e1', seasonNumber: 1, episodeNumber: 1, files: [{ id: 'e1f', mode: 'download', url: 'https://cdn.test/e1.mp4' }] }], meaningfulUpdatedAt: '2026-08-16T10:00:00Z', updateLabel: 'قسمت ۱ اضافه شد', publicationStatus: 'published' },
  ] };
  const artifacts = buildClientCatalogArtifacts(catalog);
  assert.equal(artifacts.index.items[0].id, 'old-year-fresh-update');
});

test('episode frame generation seeks to the actual episode midpoint', async () => {
  const source = await fs.readFile('scripts/sync-upera.mjs', 'utf8');
  assert.match(source, /'ffprobe'[\s\S]*format=duration/);
  assert.match(source, /duration \* 0\.5/);
  assert.doesNotMatch(source, /String\(45 \+ \(\(Number\(group\?\.episodeNumber/);
});

test('hourly sync gives episode artwork a real bounded repair budget', async () => {
  const workflow = await fs.readFile('.github/workflows/sync-upera.yml', 'utf8');
  assert.match(workflow, /APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '120'/);
  assert.match(workflow, /APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN: '160'/);
  assert.match(workflow, /APARATCHI_RUN_TIME_LIMIT_MINUTES: '12'/);
});

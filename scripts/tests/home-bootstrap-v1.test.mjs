import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const playableMovie = (id, categoryKeys, updatedAt = '2026-08-15T00:00:00.000Z') => ({
  id,
  type: 'movie',
  ir: categoryKeys.includes('iranian-movies'),
  nameFa: id,
  name: id,
  categoryKeys,
  meaningfulUpdatedAt: updatedAt,
  downloads: [{ id: `${id}-download`, files: [{ id: `${id}-file`, mode: 'download', url: `https://cdn.test/${id}.mp4` }] }],
});

const playableSeries = (id, categoryKeys, updatedAt = '2026-08-15T00:00:00.000Z') => ({
  id,
  type: 'series',
  ir: categoryKeys.includes('iranian-series'),
  nameFa: id,
  name: id,
  categoryKeys,
  publicationStatus: 'published',
  archiveComplete: true,
  meaningfulUpdatedAt: updatedAt,
  downloads: [{ id: `${id}-episode`, seasonNumber: 1, episodeNumber: 1, files: [{ id: `${id}-file`, mode: 'download', url: `https://cdn.test/${id}.mp4` }] }],
});

test('bootstrap contains real Home category samples and IMDb without peopleWorks bulk', () => {
  const items = [];
  for (let i = 0; i < 20; i += 1) items.push(playableMovie(`foreign-${i}`, ['movies', 'foreign-movies']));
  for (let i = 0; i < 20; i += 1) items.push(playableMovie(`iranian-${i}`, ['movies', 'iranian-movies']));
  for (let i = 0; i < 20; i += 1) items.push(playableSeries(`series-${i}`, ['series', 'foreign-series']));
  items.push({
    ...playableMovie('operator-1', ['movies', 'iranian-movies', 'mobile-operator']),
    operatorOnly: true,
    downloads: [{
      id: 'operator-download',
      files: [{
        id: 'operator-file',
        mode: 'operator-play',
        operatorOnly: true,
        panelVerified: true,
        trafficOo: 1,
        url: 'https://upera.tv/stream/movie/operator-1',
      }],
    }],
  });
  items.push(playableMovie('animation-1', ['movies', 'foreign-movies', 'animation-movies']));
  items.push(playableMovie('updated-old-index', ['movies', 'foreign-movies'], '2026-08-16T00:00:00.000Z'));

  const catalog = {
    version: 'bootstrap-test',
    updatedAt: '2026-08-16T00:00:00.000Z',
    featuredPeople: [{ id: 'p1', nameFa: 'نمونه' }],
    imdbTop100: { updatedAt: '2026-08-16T00:00:00.000Z', movies: [{ rank: 1, imdb: 'tt1', title: 'One' }], series: [{ rank: 1, imdb: 'tt2', title: 'Two' }] },
    items,
  };

  const artifacts = buildClientCatalogArtifacts(catalog);
  const ids = new Set(artifacts.bootstrap.items.map((item) => item.id));
  assert.ok(ids.has('foreign-0'));
  assert.ok(ids.has('iranian-0'));
  assert.ok(ids.has('series-0'));
  assert.ok(ids.has('operator-1'));
  assert.ok(ids.has('animation-1'));
  assert.ok(ids.has('updated-old-index'));
  assert.equal('peopleWorks' in artifacts.bootstrap, false);
  assert.equal(artifacts.bootstrap.imdbTop100.movies.length, 1);
  assert.equal(artifacts.bootstrap.imdbTop100.series.length, 1);
  assert.ok(artifacts.bootstrapSizeBytes < artifacts.clientSizeBytes);
  assert.match(artifacts.bootstrapRevision, /^[a-f0-9]{64}$/);
});

test('real generated bootstrap stays bounded and carries IMDb when current catalog has it', async () => {
  let raw;
  try {
    raw = await fs.readFile('catalog-bootstrap.json', 'utf8');
  } catch {
    return; // The workflow rebuild step performs the real-file assertions after generation.
  }
  const bootstrap = JSON.parse(raw);
  assert.ok(Array.isArray(bootstrap.items));
  assert.ok(bootstrap.items.length > 20);
  assert.ok(Buffer.byteLength(raw) < 1_500_000, 'bootstrap must remain small enough for first paint');
  assert.ok(Array.isArray(bootstrap.imdbTop100?.movies) && bootstrap.imdbTop100.movies.length > 0);
  assert.ok(Array.isArray(bootstrap.imdbTop100?.series) && bootstrap.imdbTop100.series.length > 0);
});

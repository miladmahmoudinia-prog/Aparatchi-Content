import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const MAX_BOOTSTRAP_BYTES = 10 * 1024 * 1024;

const playableMovie = (id, categoryKeys, firstSeenAt = '2026-08-15T00:00:00.000Z') => ({
  id,
  type: 'movie',
  ir: categoryKeys.includes('iranian-movies'),
  nameFa: id,
  name: id,
  categoryKeys,
  firstSeenAt,
  poster: `https://img.test/${id}.jpg`,
  backdrop: `https://img.test/${id}-bg.jpg`,
  overview: `خلاصه فارسی ${id}`,
  downloads: [{ id: `${id}-download`, files: [{ id: `${id}-file`, mode: 'download', url: `https://cdn.test/${id}.mp4` }] }],
});

const playableSeries = (id, categoryKeys, firstSeenAt = '2026-08-15T00:00:00.000Z') => ({
  id,
  type: 'series',
  ir: categoryKeys.includes('iranian-series'),
  nameFa: id,
  name: id,
  categoryKeys,
  publicationStatus: 'published',
  archiveComplete: true,
  firstSeenAt,
  poster: `https://img.test/${id}.jpg`,
  backdrop: `https://img.test/${id}-bg.jpg`,
  overview: `خلاصه فارسی ${id}`,
  latestEpisode: { id: `${id}-ep`, seasonNumber: 1, episodeNumber: 1 },
  episodeCount: 1,
  downloads: [{ id: `${id}-episode`, seasonNumber: 1, episodeNumber: 1, files: [{ id: `${id}-file`, mode: 'download', url: `https://cdn.test/${id}.mp4` }] }],
});

const count = (payload, key) => payload.items.filter((item) => (item.categoryKeys || []).includes(key)).length;

test('bootstrap contains the complete navigation catalog, IMDb and bounded first-screen previews', () => {
  const items = [];
  for (let i = 0; i < 20; i += 1) items.push(playableMovie(`foreign-${i}`, ['movies', 'foreign-movies']));
  for (let i = 0; i < 20; i += 1) items.push(playableMovie(`iranian-${i}`, ['movies', 'iranian-movies']));
  for (let i = 0; i < 20; i += 1) items.push(playableSeries(`series-${i}`, ['series', 'foreign-series']));
  items.push({
    ...playableMovie('operator-1', ['movies', 'iranian-movies', 'mobile-operator'], '2026-08-17T00:00:00.000Z'),
    operatorOnly: true,
    tmdbId: 12345,
    downloads: [{
      id: 'operator-media',
      files: [{
        id: 'operator-file',
        mode: 'operator-play',
        operatorOnly: true,
        panelVerified: true,
        trafficOo: 1,
        url: 'https://cdn.test/operator-1.mp4',
      }],
    }],
  });
  items.push(playableMovie('animation-1', ['movies', 'foreign-movies', 'animation-movies'], '2026-08-17T01:00:00.000Z'));

  const catalog = {
    version: 'bootstrap-test',
    updatedAt: '2026-08-17T02:00:00.000Z',
    featuredPeople: [{ id: 'p1', nameFa: 'نمونه' }],
    imdbTop100: { updatedAt: '2026-08-17T02:00:00.000Z', movies: [{ rank: 1, imdb: 'tt1', title: 'One' }], series: [{ rank: 1, imdb: 'tt2', title: 'Two' }] },
    items,
  };

  const artifacts = buildClientCatalogArtifacts(catalog);
  assert.equal(artifacts.bootstrap.items.length, artifacts.index.items.length, 'startup catalog sampled/truncated client navigation');
  assert.equal(artifacts.bootstrap.clientRevision, artifacts.clientRevision);
  assert.ok(count(artifacts.bootstrap, 'foreign-movies') >= 10);
  assert.ok(count(artifacts.bootstrap, 'iranian-movies') >= 10);
  assert.ok(count(artifacts.bootstrap, 'foreign-series') >= 10);
  assert.ok(artifacts.bootstrap.items.some((item) => item.id === 'operator-1'));
  assert.ok(artifacts.bootstrap.items.some((item) => item.id === 'animation-1'));
  assert.equal('peopleWorks' in artifacts.bootstrap, false);
  assert.equal(artifacts.bootstrap.imdbTop100.movies.length, 1);
  assert.equal(artifacts.bootstrap.imdbTop100.series.length, 1);
  for (const item of artifacts.bootstrap.items) {
    assert.ok(!Array.isArray(item.people) || item.people.length <= 8);
    if (item.type === 'movie') {
      const files = (item.downloads || []).flatMap((section) => section.files || []);
      assert.ok(files.length <= 2, `movie bootstrap action preview became unbounded for ${item.id}`);
    }
    for (const section of item.downloads || []) assert.ok((section.files || []).length <= 2);
  }
  assert.ok(artifacts.bootstrapSizeBytes < artifacts.clientSizeBytes);
  assert.ok(artifacts.bootstrapSizeBytes < MAX_BOOTSTRAP_BYTES);
  assert.match(artifacts.bootstrapRevision, /^[a-f0-9]{64}$/);
});

test('real generated bootstrap stays compact while preserving every current title', async () => {
  let bootstrapRaw;
  let indexRaw;
  try {
    [bootstrapRaw, indexRaw] = await Promise.all([
      fs.readFile('catalog-bootstrap.json', 'utf8'),
      fs.readFile('catalog-index.json', 'utf8'),
    ]);
  } catch {
    return;
  }
  const bootstrap = JSON.parse(bootstrapRaw);
  const index = JSON.parse(indexRaw);
  const manifest = JSON.parse(await fs.readFile('catalog-manifest.json', 'utf8'));
  assert.ok(Array.isArray(bootstrap.items));
  assert.ok(Array.isArray(index.items));
  assert.equal(bootstrap.items.length, index.items.length, 'real startup catalog sampled/truncated the current index');
  assert.equal(bootstrap.clientRevision, manifest.clientRevision, 'published bootstrap is not bound to the published manifest');
  assert.equal(index.items.length, manifest.clientItemCount, 'published index count drifted from the manifest');
  assert.equal(bootstrap.items.length, manifest.bootstrapItemCount, 'published bootstrap count drifted from the manifest');
  for (const key of ['iranian-movies', 'foreign-movies', 'iranian-series', 'foreign-series', 'korean-movies', 'korean-series', 'indian-movies']) {
    assert.equal(count(bootstrap, key), count(index, key), `startup catalog underfilled ${key}`);
  }
  const bootstrapBytes = Buffer.byteLength(bootstrapRaw);
  const indexBytes = Buffer.byteLength(indexRaw);
  assert.ok(bootstrapBytes < indexBytes * 0.5, 'complete startup navigation is no longer materially smaller than the detail-rich index');
  assert.ok(bootstrapBytes < MAX_BOOTSTRAP_BYTES, 'complete startup navigation exceeded the 10 MiB safety bound');
  assert.ok(Array.isArray(bootstrap.imdbTop100?.movies) && bootstrap.imdbTop100.movies.length > 0);
  assert.ok(Array.isArray(bootstrap.imdbTop100?.series) && bootstrap.imdbTop100.series.length > 0);
});

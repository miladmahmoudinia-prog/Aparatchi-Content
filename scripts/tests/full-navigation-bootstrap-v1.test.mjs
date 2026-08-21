import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const catalog = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));
const artifacts = buildClientCatalogArtifacts(catalog);
const index = artifacts.index;
const bootstrap = artifacts.bootstrap;
const manifest = JSON.parse(fs.readFileSync('catalog-manifest.json', 'utf8'));
const publishedIndex = JSON.parse(fs.readFileSync('catalog-index.json', 'utf8'));
const publishedBootstrap = JSON.parse(fs.readFileSync('catalog-bootstrap.json', 'utf8'));
const MAX_BOOTSTRAP_BYTES = 10 * 1024 * 1024;

const categoryCount = (payload, key) => payload.items.filter((item) =>
  Array.isArray(item?.categoryKeys) && item.categoryKeys.includes(key)
).length;

test('bootstrap is the complete current navigation archive in compact form', () => {
  assert.ok(index.items.length > 1000, 'full client index unexpectedly tiny');
  assert.equal(bootstrap.items.length, index.items.length, 'startup navigation sampled/truncated the archive');
  assert.equal(manifest.clientItemCount, publishedIndex.items.length, 'manifest client count drifted from the published index');
  assert.equal(manifest.bootstrapItemCount, publishedBootstrap.items.length, 'manifest startup count drifted from the published bootstrap');
  assert.equal(manifest.clientRevision, publishedBootstrap.clientRevision, 'published bootstrap is not bound to the manifest revision');
  assert.equal(bootstrap.clientRevision, artifacts.clientRevision, 'bootstrap is not bound to the exact client index revision');
  assert.ok(artifacts.bootstrapSizeBytes < MAX_BOOTSTRAP_BYTES,
    `startup navigation grew beyond 10 MiB: ${artifacts.bootstrapSizeBytes}`);

  const clientIds = new Set(index.items.map((item) => String(item.id)));
  for (const item of bootstrap.items) {
    assert.ok(item?.id && item?.type && item?.detailPath, 'Home bootstrap row cannot hydrate detail');
    assert.ok(clientIds.has(String(item.id)), `bootstrap contains non-client item ${item.id}`);
    assert.ok(!Array.isArray(item.people) || item.people.length <= 8, `people preview is unbounded for ${item.id}`);
    assert.ok(!item.overview || typeof item.overview === 'string', `overview preview is invalid for ${item.id}`);
    assert.ok(!item.genres || Array.isArray(item.genres), `genre preview is invalid for ${item.id}`);
  }
});

test('startup navigation has no fixed title-count ceiling', () => {
  const items = Array.from({ length: 5003 }, (_, index) => ({
    id: `future-${index}`,
    type: 'movie',
    nameFa: `عنوان ${index}`,
    name: `Title ${index}`,
    poster: `https://img.test/${index}.jpg`,
    categoryKeys: ['movies', 'foreign-movies'],
    downloads: [{ files: [{ mode: 'download', url: `https://cdn.test/${index}.mp4` }] }],
  }));
  const future = buildClientCatalogArtifacts({ version: 'future', updatedAt: 'future', items });
  assert.equal(future.index.items.length, 5003);
  assert.equal(future.bootstrap.items.length, 5003);
  assert.equal(future.clientItemCount, 5003);
  assert.equal(future.bootstrapItemCount, 5003);
});

test('startup navigation keeps every row for every populated shelf', () => {
  for (const key of ['kids', 'iranian-movies', 'foreign-movies', 'iranian-series', 'foreign-series', 'korean-movies', 'korean-series', 'indian-movies', 'dubbed', 'subtitled', 'documentaries', 'wildlife', 'programs']) {
    if (categoryCount(index, key) > 0) {
      assert.equal(categoryCount(bootstrap, key), categoryCount(index, key), `startup navigation truncated ${key}`);
    }
  }
});

test('bootstrap carries the complete Iranian-series lane in newest-first order', () => {
  const indexSeries = index.items.filter((item) => item.categoryKeys?.includes('iranian-series'));
  const bootstrapSeries = bootstrap.items.filter((item) => item.categoryKeys?.includes('iranian-series'));
  assert.equal(bootstrapSeries.length, indexSeries.length);
  assert.deepEqual(
    bootstrapSeries.map((item) => item.id),
    indexSeries.map((item) => item.id),
  );
});

test('Home movie action previews are immediate but strictly bounded', () => {
  for (const item of bootstrap.items.filter((candidate) => candidate?.type === 'movie')) {
    const files = (Array.isArray(item.downloads) ? item.downloads : [])
      .flatMap((section) => Array.isArray(section?.files) ? section.files : []);
    assert.ok(files.length <= 2, `Home action preview became unbounded for ${item.id}: ${files.length}`);
    assert.ok(files.every((file) => /^https?:\/\//i.test(String(file?.url || ''))),
      `Home action preview exposed a non-HTTP URL for ${item.id}`);
  }
});

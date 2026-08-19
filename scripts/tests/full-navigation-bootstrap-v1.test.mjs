import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const catalog = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));
const artifacts = buildClientCatalogArtifacts(catalog);
const index = artifacts.index;
const bootstrap = artifacts.bootstrap;
const MAX_BOOTSTRAP_BYTES = 1500 * 1024;

const categoryCount = (payload, key) => payload.items.filter((item) =>
  Array.isArray(item?.categoryKeys) && item.categoryKeys.includes(key)
).length;

test('bootstrap is a bounded current Home snapshot, not the whole navigation archive', () => {
  assert.ok(index.items.length > 1000, 'full client index unexpectedly tiny');
  assert.ok(bootstrap.items.length >= 50, 'Home bootstrap unexpectedly tiny');
  assert.ok(bootstrap.items.length < 400, 'Home bootstrap contains too many titles');
  assert.ok(bootstrap.items.length < index.items.length, 'bootstrap regressed to the whole archive');
  assert.equal(bootstrap.clientRevision, artifacts.clientRevision, 'bootstrap is not bound to the exact client index revision');
  assert.ok(artifacts.bootstrapSizeBytes < MAX_BOOTSTRAP_BYTES,
    `startup bootstrap grew beyond 1.5 MiB: ${artifacts.bootstrapSizeBytes}`);

  const clientIds = new Set(index.items.map((item) => String(item.id)));
  for (const item of bootstrap.items) {
    assert.ok(item?.id && item?.type && item?.detailPath, 'Home bootstrap row cannot hydrate detail');
    assert.ok(clientIds.has(String(item.id)), `bootstrap contains non-client item ${item.id}`);
    assert.ok(!Array.isArray(item.people) || item.people.length <= 4, `people preview is unbounded for ${item.id}`);
  }
});

test('Home bootstrap keeps a first-screen sample for every populated Home shelf', () => {
  for (const key of ['kids', 'iranian-movies', 'foreign-movies', 'iranian-series', 'foreign-series', 'korean-movies', 'korean-series', 'indian-movies', 'dubbed', 'subtitled', 'documentaries', 'wildlife', 'programs']) {
    if (categoryCount(index, key) > 0) {
      assert.ok(categoryCount(bootstrap, key) > 0, `bootstrap lost Home shelf ${key}`);
    }
  }
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

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

test('bootstrap is a bounded fresh Home snapshot instead of the whole navigation archive', () => {
  assert.ok(index.items.length > 1000, 'full client index unexpectedly tiny');
  assert.ok(bootstrap.items.length > 30, 'Home bootstrap unexpectedly tiny');
  assert.ok(bootstrap.items.length < index.items.length, 'bootstrap must not duplicate the whole client index');
  assert.ok(bootstrap.items.length <= 400, `Home bootstrap grew too many rows: ${bootstrap.items.length}`);
  for (const item of index.items.slice(0, 5)) {
    assert.ok(bootstrap.items.some((candidate) => candidate.id === item.id), `bootstrap lost newest item ${item.id}`);
  }
});

test('Home bootstrap keeps enough rows for the visible shelves and every row can hydrate detail', () => {
  for (const key of ['iranian-movies', 'foreign-movies', 'iranian-series', 'foreign-series', 'korean-movies', 'korean-series', 'indian-movies']) {
    const expected = Math.min(10, categoryCount(index, key));
    assert.ok(categoryCount(bootstrap, key) >= expected, `${key} Home shelf was truncated below ${expected}`);
  }
  const broken = bootstrap.items.filter((item) => !item?.id || !item?.type || !item?.detailPath);
  assert.deepEqual(broken.map((item) => item?.id), []);
  assert.ok(bootstrap.items.every((item) => !Array.isArray(item.downloads) || item.downloads.length === 0),
    'startup bootstrap must not carry episode/download archives');
});

test('bootstrap is small enough to stop competing with the full index at cold start', () => {
  assert.ok(artifacts.bootstrapSizeBytes < artifacts.clientSizeBytes * 0.12,
    `bootstrap ${artifacts.bootstrapSizeBytes} is too large versus index ${artifacts.clientSizeBytes}`);
  assert.ok(artifacts.bootstrapSizeBytes < MAX_BOOTSTRAP_BYTES,
    `bootstrap grew beyond 1.5 MiB: ${artifacts.bootstrapSizeBytes}`);
});

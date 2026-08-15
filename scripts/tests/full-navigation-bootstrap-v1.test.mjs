import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const catalog = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));
const artifacts = buildClientCatalogArtifacts(catalog);
const index = artifacts.index;
const bootstrap = artifacts.bootstrap;

const categoryCount = (payload, key) => payload.items.filter((item) =>
  Array.isArray(item?.categoryKeys) && item.categoryKeys.includes(key)
).length;

test('bootstrap is a complete navigation catalog, not a Home sample', () => {
  assert.equal(bootstrap.items.length, index.items.length, 'bootstrap must carry every visible title');
  assert.ok(bootstrap.items.length > 1000, 'bootstrap unexpectedly tiny');
  assert.equal(categoryCount(bootstrap, 'dubbed'), categoryCount(index, 'dubbed'), 'dubbed category was truncated');
  assert.equal(categoryCount(bootstrap, 'subtitled'), categoryCount(index, 'subtitled'), 'subtitled category was truncated');
  assert.equal(categoryCount(bootstrap, 'iranian-movies'), categoryCount(index, 'iranian-movies'), 'Iranian movies were truncated');
  assert.equal(categoryCount(bootstrap, 'foreign-movies'), categoryCount(index, 'foreign-movies'), 'foreign movies were truncated');
  assert.equal(categoryCount(bootstrap, 'iranian-series'), categoryCount(index, 'iranian-series'), 'Iranian series were truncated');
  assert.equal(categoryCount(bootstrap, 'foreign-series'), categoryCount(index, 'foreign-series'), 'foreign series were truncated');
});

test('every bootstrap navigation row can hydrate its real detail', () => {
  const broken = bootstrap.items.filter((item) => !item?.id || !item?.type || !item?.detailPath);
  assert.deepEqual(broken.map((item) => item?.id), []);
});

test('bootstrap remains materially smaller than full client index', () => {
  assert.ok(artifacts.bootstrapSizeBytes < artifacts.clientSizeBytes * 0.65,
    `bootstrap ${artifacts.bootstrapSizeBytes} is not compact versus index ${artifacts.clientSizeBytes}`);
  assert.ok(artifacts.bootstrapSizeBytes < 5_000_000,
    `bootstrap grew beyond 5 MB: ${artifacts.bootstrapSizeBytes}`);
});

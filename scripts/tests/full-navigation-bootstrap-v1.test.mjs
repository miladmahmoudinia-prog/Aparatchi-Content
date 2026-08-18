import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const catalog = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));
const artifacts = buildClientCatalogArtifacts(catalog);
const index = artifacts.index;
const bootstrap = artifacts.bootstrap;
const MAX_BOOTSTRAP_BYTES = 10 * 1024 * 1024;

const categoryCount = (payload, key) => payload.items.filter((item) =>
  Array.isArray(item?.categoryKeys) && item.categoryKeys.includes(key)
).length;

test('bootstrap is the complete compact first-navigation catalog', () => {
  assert.ok(index.items.length > 1000, 'full client index unexpectedly tiny');
  assert.equal(bootstrap.items.length, index.items.length, 'bootstrap lost client-visible navigation items');
  assert.deepEqual(bootstrap.items.map((item) => item.id), index.items.map((item) => item.id));
});

test('complete bootstrap preserves category truth and every row can hydrate detail', () => {
  for (const key of ['kids', 'iranian-movies', 'foreign-movies', 'iranian-series', 'foreign-series', 'korean-movies', 'korean-series', 'indian-movies', 'dubbed', 'subtitled']) {
    assert.equal(categoryCount(bootstrap, key), categoryCount(index, key), `bootstrap changed ${key} category membership`);
  }
  const broken = bootstrap.items.filter((item) => !item?.id || !item?.type || !item?.detailPath);
  assert.deepEqual(broken.map((item) => item?.id), []);
});

test('complete navigation bootstrap remains materially smaller than the full index', () => {
  assert.ok(artifacts.bootstrapSizeBytes < artifacts.clientSizeBytes * 0.55,
    `bootstrap ${artifacts.bootstrapSizeBytes} is too large versus index ${artifacts.clientSizeBytes}`);
  assert.ok(artifacts.bootstrapSizeBytes < MAX_BOOTSTRAP_BYTES,
    `bootstrap grew beyond 10 MiB: ${artifacts.bootstrapSizeBytes}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCatalogItem } from '../classification.mjs';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const classify = (overrides = {}) => classifyCatalogItem({
  type: 'movie', name: 'Sample', nameFa: 'نمونه', genres: ['Drama'],
  originalLanguage: 'en', countryCodes: ['US'], tmdbValidationVersion: 7,
  ...overrides,
});

const playableMovie = (id, freshness, extra = {}) => ({
  id, slug: id, type: 'movie', name: id, nameFa: id, ir: false,
  categoryKeys: ['movies', 'foreign-movies'], categoryLabels: ['فیلم‌ها', 'فیلم خارجی'],
  firstSeenAt: freshness.firstSeenAt, sourceCreatedAt: freshness.sourceCreatedAt,
  createdAt: freshness.createdAt, updatedAt: freshness.updatedAt, sourceUpdatedAt: freshness.sourceUpdatedAt,
  poster: 'https://example.test/' + id + '.jpg', backdrop: 'https://example.test/' + id + '-backdrop.jpg',
  downloads: [{ id: id + '-media', files: [{ id: id + '-file', mode: 'download', url: 'https://cdn.test/' + id + '.mp4' }] }],
  ...extra,
});

test('trusted narrative and animation titles escape stale documentary flags', () => {
  for (const sample of [
    { name: 'The Bikeriders', genres: ['Crime', 'Drama'] },
    { name: 'Miracles from Heaven', genres: ['Drama', 'Family'] },
  ]) {
    const result = classify({ ...sample, isDocumentary: true, contentKind: 'documentary', categoryKeys: ['documentaries'] });
    assert.equal(result.isDocumentary, false);
    assert.ok(result.categoryKeys.includes('foreign-movies'));
    assert.ok(!result.categoryKeys.includes('documentaries'));
  }
  const minions = classify({
    name: 'Minions: The Rise of Gru', genres: ['Animation', 'Comedy', 'Family'],
    isAnimation: true, isDocumentary: true, contentKind: 'documentary', categoryKeys: ['documentaries'],
  });
  assert.equal(minions.isDocumentary, false);
  assert.ok(minions.categoryKeys.includes('animation-movies'));
  assert.ok(!minions.categoryKeys.includes('documentaries'));
});

test('snake, crocodile and alligator documentaries route to Wildlife', () => {
  for (const name of ['The Ultimate Guide: Snakes', 'Safari: The Alligator & American Crocodile']) {
    const result = classify({ name, genres: ['Documentary'], isDocumentary: true });
    assert.equal(result.isWildlife, true);
    assert.ok(result.categoryKeys.includes('wildlife'));
    assert.ok(!result.categoryKeys.includes('documentaries'));
  }
});

test('explicit country beats stale language and legacy Iranian flags', () => {
  const son = classify({ name: 'The Son', originalLanguage: 'fa', countryCodes: ['US', 'GB'], ir: true });
  assert.equal(son.ir, false);
  assert.ok(son.categoryKeys.includes('foreign-movies'));
  const moon = classify({ name: 'The Moon', originalLanguage: 'ko', countryCodes: ['KR'], ir: true });
  assert.equal(moon.ir, false);
  assert.ok(moon.categoryKeys.includes('korean-movies'));
});

test('catalog ordering uses discovery and meaningful episode freshness, not metadata touch timestamps', () => {
  const oldTouched = playableMovie('old-touched', {
    firstSeenAt: '2026-07-01T00:00:00.000Z', sourceCreatedAt: '2026-07-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-08-17T23:00:00.000Z', sourceUpdatedAt: '2026-08-17T23:00:00.000Z',
  });
  const newlyAdded = playableMovie('newly-added', {
    firstSeenAt: '2026-08-17T22:00:00.000Z', sourceCreatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-08-17T22:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', sourceUpdatedAt: '2026-01-01T00:00:00.000Z',
  });
  const catalog = { version: 'ordering-v11', updatedAt: '2026-08-17T23:30:00.000Z', items: [oldTouched, newlyAdded], imdbTop100: { movies: [], series: [] } };
  const artifacts = buildClientCatalogArtifacts(catalog);
  assert.equal(artifacts.index.items[0].id, 'newly-added');
  assert.equal(artifacts.bootstrap.items[0].id, 'newly-added');
  assert.equal(artifacts.bootstrap.items[0].backdrop, newlyAdded.backdrop);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientCatalogArtifacts, clientSummaryForItem } from '../client-catalog.mjs';

test('client index strips heavy media fields but preserves browse metadata', () => {
  const item = {
    id: 'series-1', type: 'series', slug: 'series-1', ir: false, year: 2025,
    nameFa: 'نمونه', name: 'Sample', poster: 'p.jpg', backdrop: 'b.jpg',
    overview: 'الف'.repeat(500), genres: ['درام'], access: 'free',
    publicationStatus: 'published', episodeCount: 20, categoryKeys: ['series', 'foreign-series'],
    downloads: [{ id: 'e1', files: [{ id: 'f1', url: 'https://example.test/a.mp4' }] }],
    people: [{ id: 'p1', nameFa: 'بازیگر', role: 'actor' }],
  };
  const { summary } = clientSummaryForItem(item);
  assert.equal(summary.id, item.id);
  assert.equal(summary.publicationStatus, 'published');
  assert.equal(summary.episodeCount, 20);
  assert.ok(summary.detailPath.startsWith('catalog-items/'));
  assert.equal('downloads' in summary, false);
  assert.equal('people' in summary, false);
  assert.ok(summary.overview.length < item.overview.length);
});

test('detail path changes when the full item changes', () => {
  const base = { id: 'movie-1', type: 'movie', nameFa: 'الف', name: 'A', downloads: [] };
  const first = clientSummaryForItem(base).summary.detailPath;
  const second = clientSummaryForItem({ ...base, downloads: [{ id: 'x', files: [] }] }).summary.detailPath;
  assert.notEqual(first, second);
});

test('client catalog remains much smaller by not embedding episode files and cast per item', () => {
  const heavyItem = {
    id: 's', type: 'series', slug: 's', ir: false, year: 2020, nameFa: 'سریال', name: 'Series',
    poster: 'p', backdrop: 'b', overview: 'شرح', genres: ['درام'], access: 'free', publicationStatus: 'published',
    downloads: Array.from({ length: 80 }, (_, index) => ({
      id: `e${index + 1}`,
      title: `قسمت ${index + 1}`,
      files: Array.from({ length: 4 }, (_v, q) => ({ id: `f${index}-${q}`, url: `https://cdn.test/${index}/${q}.mp4`, quality: `${q}` })),
    })),
    people: Array.from({ length: 25 }, (_, index) => ({ id: `p${index}`, nameFa: `نفر ${index}`, role: 'actor' })),
  };
  const catalog = { version: '1', updatedAt: 'now', items: [heavyItem] };
  const artifacts = buildClientCatalogArtifacts(catalog);
  const fullBytes = Buffer.byteLength(JSON.stringify(catalog));
  assert.ok(artifacts.clientSizeBytes < fullBytes * 0.25);
});

test('client index never exposes building archive series, but never drops a locked visible series', () => {
  const catalog = {
    version: '1', updatedAt: 'now',
    items: [
      { id: 'building', type: 'series', nameFa: 'در حال تکمیل', name: 'Building', publicationStatus: 'building-archive', archiveComplete: false },
      { id: 'locked', type: 'series', nameFa: 'قبلاً منتشرشده', name: 'Locked', publicationStatus: 'building-archive', archiveComplete: false, visibilityLocked: true },
      { id: 'published', type: 'series', nameFa: 'منتشرشده', name: 'Published', publicationStatus: 'published', archiveComplete: false },
      { id: 'movie', type: 'movie', nameFa: 'فیلم', name: 'Movie' },
    ],
  };
  const artifacts = buildClientCatalogArtifacts(catalog);
  assert.deepEqual(artifacts.index.items.map((item) => item.id), ['locked', 'published', 'movie']);
});

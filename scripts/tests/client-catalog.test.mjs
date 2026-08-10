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

test('client index hides zero-media movies/series but keeps previously visible series with usable media', () => {
  const playableEpisode = [{ id: 'e1', files: [{ id: 'f1', mode: 'download', url: 'https://cdn.test/e1.mp4' }] }];
  const catalog = {
    version: '1', updatedAt: 'now',
    items: [
      { id: 'building', type: 'series', nameFa: 'در حال تکمیل', name: 'Building', publicationStatus: 'building-archive', archiveComplete: false },
      { id: 'locked', type: 'series', nameFa: 'قبلاً منتشرشده', name: 'Locked', publicationStatus: 'building-archive', archiveComplete: false, visibilityLocked: true, downloads: playableEpisode },
      { id: 'published', type: 'series', nameFa: 'منتشرشده', name: 'Published', publicationStatus: 'published', archiveComplete: false, downloads: playableEpisode },
      { id: 'empty-published', type: 'series', nameFa: 'بدون لینک', name: 'Empty', publicationStatus: 'published', archiveComplete: false, visibilityLocked: true, downloads: [] },
      { id: 'movie', type: 'movie', nameFa: 'فیلم', name: 'Movie' },
    ],
  };
  const artifacts = buildClientCatalogArtifacts(catalog);
  assert.deepEqual(artifacts.index.items.map((item) => item.id), ['locked', 'published']);
  assert.equal(catalog.items.length, 5, 'server-side catalog records are never deleted by client filtering');
});

test('client summary carries lightweight dubbing and subtitle badges without media payloads', () => {
  const item = {
    id: 'movie-language', type: 'movie', nameFa: 'نمونه', name: 'Sample',
    downloads: [
      { id: 'dub', title: 'دوبله فارسی', files: [{ id: 'd', label: 'کیفیت 720 دوبله', url: 'https://cdn.test/d.mp4' }] },
      { id: 'sub', title: 'زیرنویس فارسی', files: [{ id: 's', label: '1080 subtitle', url: 'https://cdn.test/s.mp4' }] },
    ],
  };
  const { summary } = clientSummaryForItem(item);
  assert.deepEqual(summary.availableLanguages, ['dubbed', 'subtitled']);
  assert.equal('downloads' in summary, false);
});

test('client summary recognizes language from lightweight file metadata and carries collection identity', () => {
  const item = {
    id: 'collection-language', type: 'movie', nameFa: 'نمونه کالکشن', name: 'Collection Sample',
    collectionId: 'tmdb:42', collectionNameFa: 'مجموعه نمونه', collectionName: 'Sample Collection',
    downloads: [
      { id: 'dub', files: [{ id: 'd', language: 'dubbed', url: 'https://cdn.test/d.mp4' }] },
      { id: 'sub', files: [{ id: 's', language: 'subtitled', url: 'https://cdn.test/s.mp4' }] },
    ],
  };
  const { summary } = clientSummaryForItem(item);
  assert.deepEqual(summary.availableLanguages, ['dubbed', 'subtitled']);
  assert.equal(summary.collectionId, 'tmdb:42');
  assert.equal(summary.collectionNameFa, 'مجموعه نمونه');
});

test('movies without usable media stay server-side for repair but are hidden from the client index', () => {
  const catalog = {
    version: '1', updatedAt: 'now',
    items: [
      { id: 'dead', type: 'movie', nameFa: 'خراب', name: 'Dead', mediaAuditStatus: 'confirmed-unavailable' },
      { id: 'retry', type: 'movie', nameFa: 'در حال بررسی', name: 'Retry', mediaAuditStatus: 'broken-links' },
    ],
  };
  const artifacts = buildClientCatalogArtifacts(catalog);
  assert.deepEqual(artifacts.index.items.map((item) => item.id), []);
  assert.equal(catalog.items.length, 2);
});


test('client summary recognizes Persian dubbing variants that used to be missed', () => {
  const item = {
    id: 'dub-variants', type: 'movie', nameFa: 'نمونه دوبله', name: 'Dub Sample',
    downloads: [
      { id: 'dual', title: 'نسخه دو زبانه', files: [{ id: 'd1', label: 'Persian Audio 1080p', url: 'https://cdn.test/d1.mp4' }] },
      { id: 'sub', title: 'هارد ساب فارسی', files: [{ id: 's1', label: 'Farsi Sub 720p', url: 'https://cdn.test/s1.mp4' }] },
    ],
  };
  const { summary } = clientSummaryForItem(item);
  assert.deepEqual(summary.availableLanguages, ['dubbed', 'subtitled']);
});

test('client index accepts MKV direct downloads but rejects purchase-only links', () => {
  const catalog = {
    version: 'test', updatedAt: new Date(0).toISOString(), iranianSchedule: [], weeklySchedule: [],
    items: [
      {
        id: 'mkv', type: 'movie', nameFa: 'ام‌کی‌وی', name: 'MKV',
        downloads: [{ id: 'dub', files: [{ id: 'mkv-dub', mode: 'download', language: 'dubbed', url: 'https://cdn.test/movie.mkv' }] }],
      },
      {
        id: 'external', type: 'movie', nameFa: 'خارجی', name: 'External',
        downloads: [{ id: 'dub', files: [{ id: 'external-dub', mode: 'purchase', language: 'dubbed', url: 'https://cdn.test/acquire?id=1' }] }],
      },
    ],
  };
  const artifacts = buildClientCatalogArtifacts(catalog);
  assert.ok(artifacts.index.items.some((item) => item.id === 'mkv'));
  assert.equal(artifacts.index.items.some((item) => item.id === 'external'), false);
});

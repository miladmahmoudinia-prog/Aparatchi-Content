import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientCatalogArtifacts, clientSummaryForItem } from '../client-catalog.mjs';

test('client item summary keeps bounded episode action previews but strips duplicated cast identities', () => {
  const item = {
    id: 'series-1', type: 'series', slug: 'series-1', ir: false, year: 2025,
    nameFa: 'نمونه', name: 'Sample', poster: 'p.jpg', backdrop: 'b.jpg',
    overview: 'الف'.repeat(500), genres: ['درام'], access: 'free',
    publicationStatus: 'published', episodeCount: 20, categoryKeys: ['series', 'foreign-series'],
    downloads: [{ id: 'e1', seasonNumber: 1, episodeNumber: 1, files: [{ id: 'f1', mode: 'download', quality: '720p', url: 'https://example.test/a.mp4' }] }],
    people: [{
      id: 'p1', nameFa: 'بازیگر', name: 'Actor', role: 'actor', tmdbId: 42,
      image: 'https://image.test/p1.jpg', character: 'Hero', popularity: 99,
    }],
  };
  const { summary, stableDetailPath, stableDetailSerialized } = clientSummaryForItem(item);
  assert.equal(summary.id, item.id);
  assert.equal(summary.publicationStatus, 'published');
  assert.equal(summary.episodeCount, 20);
  assert.ok(summary.detailPath.startsWith('catalog-items/'));
  assert.ok(stableDetailPath.startsWith('catalog-stable/'));
  assert.match(stableDetailPath, /^catalog-stable\/[a-f0-9]{12}\.json$/);
  assert.deepEqual(JSON.parse(stableDetailSerialized), {
    schemaVersion: 1,
    type: summary.type,
    id: summary.id,
    detailPath: summary.detailPath,
  });
  assert.equal(summary.downloads?.length, 1);
  assert.equal(summary.downloads?.[0]?.episodeNumber, 1);
  assert.equal(summary.downloads?.[0]?.files?.length, 1);
  assert.equal('people' in summary, false);
  assert.ok(summary.overview.length < item.overview.length);
});

test('detail path changes when the full item changes', () => {
  const base = { id: 'movie-1', type: 'movie', nameFa: 'الف', name: 'A', downloads: [] };
  const first = clientSummaryForItem(base).summary.detailPath;
  const second = clientSummaryForItem({ ...base, downloads: [{ id: 'x', files: [] }] }).summary.detailPath;
  assert.notEqual(first, second);
});

test('client catalog stays bounded while carrying only compact episode previews and no full cast payloads', () => {
  const heavyItem = {
    id: 's', type: 'series', slug: 's', ir: false, year: 2020, nameFa: 'سریال', name: 'Series',
    poster: 'p', backdrop: 'b', overview: 'شرح', genres: ['درام'], access: 'free', publicationStatus: 'published',
    downloads: Array.from({ length: 80 }, (_, index) => ({
      id: `e${index + 1}`,
      seasonNumber: 1,
      episodeNumber: index + 1,
      title: `قسمت ${index + 1}`,
      files: Array.from({ length: 4 }, (_v, q) => ({ id: `f${index}-${q}`, url: `https://cdn.test/${index}/${q}.mp4`, quality: `${q}`, language: 'subtitled' })),
    })),
    people: Array.from({ length: 25 }, (_, index) => ({
      id: `p${index}`, nameFa: `نفر ${index}`, name: `Person ${index}`, role: 'actor', tmdbId: 1000 + index,
      image: `https://image.test/${index}.jpg`, character: `Character ${index}`, popularity: index,
    })),
  };
  const catalog = { version: '1', updatedAt: 'now', items: [heavyItem] };
  const artifacts = buildClientCatalogArtifacts(catalog);
  const fullBytes = Buffer.byteLength(JSON.stringify(catalog));
  assert.ok(artifacts.clientSizeBytes < fullBytes * 0.65);
  assert.ok(artifacts.index.items[0].downloads.every((section) => section.files.length > 0 && section.files.length <= 2));
  assert.equal('people' in artifacts.index.items[0], false);
  assert.deepEqual(artifacts.index.peopleWorks['tmdb:1000'], [0]);
  assert.ok(Object.values(artifacts.index.peopleWorks).every((indexes) => indexes.every(Number.isInteger)));
  assert.equal(artifacts.stableDetailFiles.length, 1);
  assert.match(artifacts.stableDetailFiles[0].path, /^catalog-stable\/[a-f0-9]{12}\.json$/);
  const stablePointer = JSON.parse(artifacts.stableDetailFiles[0].serialized);
  assert.equal(stablePointer.id, artifacts.index.items[0].id);
  assert.equal(stablePointer.type, artifacts.index.items[0].type);
  assert.equal(stablePointer.detailPath, artifacts.detailFiles[0].path);
  assert.ok(artifacts.stableDetailFiles[0].serialized.length < 300);
});

test('client index hides zero-media movies/series but keeps previously visible series with usable media', () => {
  const playableEpisode = [{ id: 'e1', seasonNumber: 1, episodeNumber: 1, files: [{ id: 'f1', mode: 'download', url: 'https://cdn.test/e1.mp4', language: 'subtitled' }] }];
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

test('client movie summary carries lightweight actionable media with language badges', () => {
  const item = {
    id: 'movie-language', type: 'movie', nameFa: 'نمونه', name: 'Sample',
    downloads: [
      { id: 'dub', title: 'دوبله فارسی', files: [{ id: 'd', label: 'کیفیت 720 دوبله', url: 'https://cdn.test/d.mp4' }] },
      { id: 'sub', title: 'زیرنویس فارسی', files: [{ id: 's', label: '1080 subtitle', url: 'https://cdn.test/s.mp4' }] },
    ],
  };
  const { summary } = clientSummaryForItem(item);
  assert.deepEqual(summary.availableLanguages, ['dubbed', 'subtitled']);
  assert.ok(Array.isArray(summary.downloads) && summary.downloads.length === 2);
  assert.equal(summary.downloads.flatMap((section) => section.files || []).length, 2);
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

test('series summary keeps every episode coordinate with at most two actionable preview files and bootstrap strips them', () => {
  const episode = (number) => ({
    id: `e${number}`,
    title: `قسمت ${number}`,
    seasonNumber: 1,
    episodeNumber: number,
    sourceEpisodeId: `source-${number}`,
    files: [
      { id: `d${number}-1080`, mode: 'download', quality: '1080p', url: `https://cdn.test/${number}/1080.mp4` },
      { id: `d${number}-720`, mode: 'download', quality: '720p', url: `https://cdn.test/${number}/720.mp4` },
      { id: `p${number}`, mode: 'play', quality: 'پخش', url: `https://cdn.test/${number}/master.m3u8` },
    ],
  });
  const catalog = {
    version: 'preview-test', updatedAt: '2026-01-01T00:00:00Z',
    items: [{
      id: 'series-preview', type: 'series', nameFa: 'نمونه سریال', name: 'Series Preview',
      publicationStatus: 'published', archiveComplete: true,
      downloads: [episode(1), episode(2), episode(3)],
    }],
  };
  const artifacts = buildClientCatalogArtifacts(catalog);
  const summary = artifacts.index.items[0];
  assert.deepEqual(summary.downloads.map((section) => section.episodeNumber), [1, 2, 3]);
  assert.ok(summary.downloads.every((section) => section.files.length > 0 && section.files.length <= 2));
  assert.deepEqual(summary.downloads.map((section) => section.sourceEpisodeId), ['source-1', 'source-2', 'source-3']);
  const sourceUrls = new Set(catalog.items[0].downloads.flatMap((section) => section.files.map((file) => file.url)));
  assert.ok(summary.downloads.flatMap((section) => section.files).every((file) => sourceUrls.has(file.url)));
  assert.equal('downloads' in artifacts.bootstrap.items[0], false, 'bootstrap must stay navigation-light for series');
  const detail = JSON.parse(artifacts.detailFiles[0].serialized);
  assert.equal(detail.downloads.flatMap((section) => section.files).length, 9, 'detail shard keeps every quality');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClientCatalogArtifacts,
  buildLiveCatalogBaseline,
  buildLiveCatalogDelta,
  clientSummaryForItem,
} from '../client-catalog.mjs';

test('client item summary keeps bounded episode actions and a compact first-screen people preview', () => {
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
  assert.equal(summary.people?.length, 1);
  assert.equal(summary.people?.[0]?.tmdbId, 42);
  assert.equal(summary.people?.[0]?.image, 'https://image.test/p1.jpg');
  assert.equal('popularity' in summary.people[0], false, 'heavy ranking metadata stays in the detail shard');
  assert.ok(summary.overview.length < item.overview.length);
});

test('detail path changes when the full item changes', () => {
  const base = { id: 'movie-1', type: 'movie', nameFa: 'الف', name: 'A', downloads: [] };
  const first = clientSummaryForItem(base).summary.detailPath;
  const second = clientSummaryForItem({ ...base, downloads: [{ id: 'x', files: [] }] }).summary.detailPath;
  assert.notEqual(first, second);
});

test('live catalog grows without a title cap and carries only cumulative changes', () => {
  const media = [{ files: [{ mode: 'download', url: 'https://cdn.test/movie.mp4' }] }];
  const first = buildClientCatalogArtifacts({
    version: 'base', updatedAt: 'base-time', items: [
      { id: 'a', type: 'movie', nameFa: 'الف', name: 'A', downloads: media },
      { id: 'b', type: 'movie', nameFa: 'ب', name: 'B', downloads: media },
    ],
  }).bootstrap;
  const baseline = buildLiveCatalogBaseline(first);
  const current = buildClientCatalogArtifacts({
    version: 'next', updatedAt: 'next-time', items: [
      { id: 'c', type: 'movie', nameFa: 'ج', name: 'C', downloads: media, firstSeenAt: '2026-08-21T00:00:00Z' },
      { id: 'a', type: 'movie', nameFa: 'الف تازه', name: 'A', downloads: media },
    ],
  }).bootstrap;
  const { live } = buildLiveCatalogDelta(current, baseline);

  assert.equal(live.itemCount, 2);
  assert.deepEqual(live.itemOrder, ['movie:c', 'movie:a']);
  assert.deepEqual(live.upserts.map((item) => item.id), ['c', 'a']);
  assert.ok(live.touchedKeys.includes('movie:b'), 'a removed baseline title remains cumulative truth');

  const restored = buildClientCatalogArtifacts({
    version: 'restored', updatedAt: 'restored-time', items: [
      { id: 'b', type: 'movie', nameFa: 'ب', name: 'B', downloads: media },
      { id: 'a', type: 'movie', nameFa: 'الف', name: 'A', downloads: media },
    ],
  }).bootstrap;
  const next = buildLiveCatalogDelta(restored, baseline, live).live;
  assert.ok(next.upserts.some((item) => item.id === 'b'), 'a restored title cannot disappear from an older installed app');
  assert.ok(next.upserts.some((item) => item.id === 'a'), 'a reverted title remains explicit after it was touched');
});

test('client catalog stays bounded with compact episode actions and at most eight lightweight people previews', () => {
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
  assert.ok(Array.isArray(artifacts.index.items[0].people));
  assert.equal(artifacts.index.items[0].people.length, 8);
  assert.ok(artifacts.index.items[0].people.every((person) => !('popularity' in person)));
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
    collectionId: 'collection-1', collectionNameFa: 'مجموعه نمونه', collectionName: 'Sample Collection', collectionOrder: 2,
    downloads: [{ id: 'dub', files: [{ id: 'd', url: 'https://cdn.test/d.mp4', language: 'dubbed' }] }],
  };
  const { summary } = clientSummaryForItem(item);
  assert.equal(summary.collectionId, 'collection-1');
  assert.equal(summary.collectionOrder, 2);
  assert.deepEqual(summary.availableLanguages, ['dubbed']);
});

test('movies without usable media stay server-side for repair but are hidden from the client index', () => {
  const catalog = {
    version: '1', updatedAt: 'now', items: [
      { id: 'bad', type: 'movie', nameFa: 'بدون رسانه', name: 'Bad', downloads: [{ id: 'x', files: [{ url: 'https://example.test/pay' }] }] },
    ],
  };
  const artifacts = buildClientCatalogArtifacts(catalog);
  assert.equal(artifacts.index.items.length, 0);
  assert.equal(catalog.items.length, 1);
});

test('client summary recognizes Persian dubbing variants that used to be missed', () => {
  const item = {
    id: 'dub-variant', type: 'movie', nameFa: 'نمونه', name: 'Sample',
    downloads: [{ id: 'd', title: 'صوت فارسی', files: [{ id: 'f', url: 'https://cdn.test/f.mp4' }] }],
  };
  const { summary } = clientSummaryForItem(item);
  assert.deepEqual(summary.availableLanguages, ['dubbed']);
});

test('client index accepts MKV direct downloads but rejects purchase-only links', () => {
  const catalog = {
    version: '1', updatedAt: 'now', items: [
      { id: 'mkv', type: 'movie', nameFa: 'ام‌کی‌وی', name: 'MKV', downloads: [{ id: 'd', files: [{ id: 'f', mode: 'download', url: 'https://cdn.test/file.mkv' }] }] },
      { id: 'purchase', type: 'movie', nameFa: 'خرید', name: 'Purchase', downloads: [{ id: 'p', files: [{ id: 'p1', mode: 'download', url: 'https://example.test/buy' }] }] },
    ],
  };
  const artifacts = buildClientCatalogArtifacts(catalog);
  assert.deepEqual(artifacts.index.items.map((item) => item.id), ['mkv']);
});

test('series summary and bootstrap keep every episode coordinate with bounded actionable previews', () => {
  const downloads = Array.from({ length: 5 }, (_, index) => ({
    id: `e${index + 1}`, seasonNumber: 1, episodeNumber: index + 1,
    files: [
      { id: `d${index}`, mode: 'download', url: `https://cdn.test/e${index}.mkv` },
      { id: `p${index}`, mode: 'play', url: `https://cdn.test/e${index}.m3u8` },
      { id: `x${index}`, mode: 'download', url: `https://cdn.test/e${index}-extra.mp4` },
    ],
  }));
  const item = {
    id: 'series-preview', type: 'series', nameFa: 'پیش‌نمایش', name: 'Preview',
    publicationStatus: 'published', latestEpisode: { episodeNumber: 5 }, episodeCount: 5,
    downloads,
  };
  const { summary } = clientSummaryForItem(item);
  assert.equal(summary.downloads.length, 5);
  assert.ok(summary.downloads.every((section) => section.files.length <= 2));
  const artifacts = buildClientCatalogArtifacts({ version: '1', updatedAt: 'now', items: [item] });
  assert.equal(artifacts.bootstrap.items[0].downloads.length, 5);
});

test('missing ir flag never makes a foreign title Iranian and keeps real media neutral', () => {
  const item = {
    id: 'foreign-neutral', type: 'movie', nameFa: 'خارجی', name: 'Foreign',
    countryCodes: ['US'], downloads: [{ id: 'd', files: [{ id: 'f', mode: 'download', url: 'https://cdn.test/f.mp4' }] }],
  };
  const artifacts = buildClientCatalogArtifacts({ version: '1', updatedAt: 'now', items: [item] });
  assert.equal(artifacts.index.items.length, 1);
  assert.deepEqual(artifacts.index.items[0].availableLanguages, []);
});

test('a real dubbed foreign download survives and is labelled dubbed', () => {
  const item = {
    id: 'foreign-dubbed', type: 'movie', nameFa: 'دوبله', name: 'Dubbed', countryCodes: ['US'],
    downloads: [{ id: 'd', title: 'دوبله فارسی', files: [{ id: 'f', mode: 'download', url: 'https://cdn.test/f.mp4' }] }],
  };
  const artifacts = buildClientCatalogArtifacts({ version: '1', updatedAt: 'now', items: [item] });
  assert.equal(artifacts.index.items[0].availableLanguages[0], 'dubbed');
});

test('same URL with contradictory languages survives once as neutral media', () => {
  const item = {
    id: 'conflict', type: 'movie', nameFa: 'تعارض', name: 'Conflict', countryCodes: ['US'],
    downloads: [
      { id: 'd', title: 'دوبله فارسی', files: [{ id: 'f1', mode: 'download', url: 'https://cdn.test/shared.mp4' }] },
      { id: 's', title: 'زیرنویس فارسی', files: [{ id: 'f2', mode: 'download', url: 'https://cdn.test/shared.mp4' }] },
    ],
  };
  const artifacts = buildClientCatalogArtifacts({ version: '1', updatedAt: 'now', items: [item] });
  const files = artifacts.index.items[0].downloads.flatMap((section) => section.files || []);
  assert.equal(files.length, 1);
  assert.equal(files[0].language, undefined);
});

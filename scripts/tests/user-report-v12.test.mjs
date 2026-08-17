import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const playable = (id, sourceUpdatedAt) => ({
  id: `g-${id}`,
  title: `قسمت ${id}`,
  seasonNumber: 1,
  episodeNumber: Number(id),
  sourceUpdatedAt,
  files: [{ id: `f-${id}`, quality: '720p', url: `https://example.com/${id}.mp4`, mode: 'download' }],
});

const baseSeries = (overrides = {}) => ({
  id: overrides.id || 'series-a',
  slug: overrides.id || 'series-a',
  type: 'series',
  ir: false,
  year: 2026,
  nameFa: overrides.nameFa || 'سریال آزمایشی',
  name: overrides.name || 'Test Series',
  poster: 'https://example.com/poster.jpg',
  backdrop: 'https://example.com/backdrop.jpg',
  overview: 'خلاصه فارسی معتبر برای آزمایش.',
  genres: ['درام'],
  access: 'free',
  categoryKeys: ['foreign-series'],
  categoryLabels: ['سریال‌های خارجی'],
  publicationStatus: 'published',
  archiveComplete: true,
  sourceEpisodeCount: 1,
  episodeCount: 1,
  latestEpisode: { id: 'ep', seasonNumber: 1, episodeNumber: 1 },
  downloads: [playable(1, overrides.episodeSourceUpdatedAt || '2026-08-01T00:00:00Z')],
  firstSeenAt: overrides.firstSeenAt || '2026-08-01T00:00:00Z',
  sourceCreatedAt: overrides.sourceCreatedAt || '2026-01-01T00:00:00Z',
  createdAt: overrides.createdAt || '2026-01-01T00:00:00Z',
  meaningfulUpdatedAt: overrides.meaningfulUpdatedAt,
  updateLabel: overrides.updateLabel,
  people: overrides.people || [],
});

const catalogOf = (items) => ({
  version: 'test',
  updatedAt: '2026-08-18T00:00:00Z',
  items,
  iranianSchedule: [],
  weeklySchedule: [],
  featuredPeople: [],
});

test('historical episode backfill cannot pin an old series ahead of a newer discovery', () => {
  const historicalBackfill = baseSeries({
    id: 'spider-like',
    name: 'Spider Like',
    firstSeenAt: '2026-08-11T12:03:50Z',
    meaningfulUpdatedAt: '2026-08-17T21:50:45Z',
    updateLabel: 'قسمت ۸ اضافه شد',
    episodeSourceUpdatedAt: '2026-06-16T08:20:08Z',
  });
  const genuinelyNew = baseSeries({
    id: 'newer-title',
    name: 'Newer Title',
    firstSeenAt: '2026-08-12T12:00:00Z',
    episodeSourceUpdatedAt: '2026-08-12T12:00:00Z',
  });
  const artifacts = buildClientCatalogArtifacts(catalogOf([historicalBackfill, genuinelyNew]));
  assert.equal(artifacts.index.items[0].id, 'newer-title');
});

test('a real forward episode update can move an older series to the front', () => {
  const realUpdate = baseSeries({
    id: 'real-update',
    firstSeenAt: '2026-08-01T00:00:00Z',
    meaningfulUpdatedAt: '2026-08-17T20:00:00Z',
    updateLabel: 'قسمت ۹ اضافه شد',
    episodeSourceUpdatedAt: '2026-08-17T19:58:00Z',
  });
  const newerDiscovery = baseSeries({
    id: 'new-title',
    firstSeenAt: '2026-08-12T00:00:00Z',
    episodeSourceUpdatedAt: '2026-08-12T00:00:00Z',
  });
  const artifacts = buildClientCatalogArtifacts(catalogOf([newerDiscovery, realUpdate]));
  assert.equal(artifacts.index.items[0].id, 'real-update');
});

test('client summary carries bounded people preview and discovery timestamp', () => {
  const people = Array.from({ length: 12 }, (_, index) => ({
    id: `p-${index}`,
    nameFa: `بازیگر ${index}`,
    name: `Actor ${index}`,
    role: index === 0 ? 'director' : 'actor',
    roleLabel: index === 0 ? 'کارگردان' : 'بازیگر',
    character: index ? `نقش ${index}` : undefined,
    image: `https://example.com/person-${index}.jpg`,
    order: index,
    tmdbId: 1000 + index,
  }));
  const item = baseSeries({ id: 'people-preview', people, firstSeenAt: '2026-08-15T00:00:00Z' });
  const artifacts = buildClientCatalogArtifacts(catalogOf([item]));
  const summary = artifacts.index.items[0];
  assert.equal(summary.firstSeenAt, '2026-08-15T00:00:00Z');
  assert.equal(summary.people.length, 8);
  assert.equal(summary.people[0].image, 'https://example.com/person-0.jpg');
  assert.equal(summary.people[0].roleLabel, 'کارگردان');
  assert.equal(summary.people[1].character, 'نقش 1');
  assert.equal(JSON.parse(artifacts.detailFiles[0].serialized).people.length, 12);
});

test('sync marks only forward-tail episode additions as meaningful', () => {
  const source = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');
  assert.ok(source.includes('let latestForwardEpisode = null;'));
  assert.ok(source.includes('if (isEpisodeAfterPublishedTail(episode, previousGroups))'));
  assert.ok(source.includes('const isMeaningfulEpisodeUpdate = Boolean(addedEpisodes > 0 && latestForwardEpisode && existing);'));
  assert.ok(!source.includes("updateLabel = 'بروزرسانی شد';"));
});

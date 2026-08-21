import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const person = (owner, index) => ({
  id: `${owner}-person-${index}`,
  nameFa: `بازیگر ${owner} ${index}`,
  role: index === 0 ? 'director' : 'actor',
  image: `https://img.test/${owner}-${index}.jpg`,
});

test('first-paint people and movie actions are not limited to the first 36 titles', () => {
  const items = Array.from({ length: 80 }, (_, index) => ({
    id: `movie-${index}`,
    type: 'movie',
    nameFa: `فیلم ${index}`,
    name: `Movie ${index}`,
    poster: `https://img.test/movie-${index}.jpg`,
    backdrop: `https://img.test/movie-${index}-backdrop.jpg`,
    overview: `داستان فارسی فیلم ${index}`,
    people: Array.from({ length: 7 }, (_value, personIndex) => person(index, personIndex)),
    downloads: [{ files: [{ mode: 'download', url: `https://cdn.test/movie-${index}.mp4` }] }],
  }));
  const { bootstrap } = buildClientCatalogArtifacts({ version: 'v45', updatedAt: 'now', items });

  assert.equal(bootstrap.items.length, 80);
  assert.ok(bootstrap.items.every((item) => item.people?.length === 4));
  assert.ok(bootstrap.items.every((item) => item.downloads?.[0]?.files?.length === 1));
});

test('series first paint carries only the newest actionable episode', () => {
  const downloads = Array.from({ length: 20 }, (_, index) => ({
    seasonNumber: index < 10 ? 1 : 2,
    episodeNumber: (index % 10) + 1,
    files: [{ mode: 'play', url: `https://cdn.test/episode-${index}.m3u8` }],
  }));
  const { bootstrap } = buildClientCatalogArtifacts({
    version: 'v45', updatedAt: 'now', items: [{
      id: 'series', type: 'series', nameFa: 'سریال', name: 'Series',
      publicationStatus: 'published', archiveComplete: true,
      people: Array.from({ length: 6 }, (_value, index) => person('series', index)),
      downloads,
    }],
  });

  assert.equal(bootstrap.items[0].people.length, 4);
  assert.equal(bootstrap.items[0].downloads.length, 1);
  assert.equal(bootstrap.items[0].downloads[0].seasonNumber, 2);
  assert.equal(bootstrap.items[0].downloads[0].episodeNumber, 10);
});

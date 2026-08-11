import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

test('client index exposes a compact reverse people-to-works map', () => {
  const media = [{ id: 'd', files: [{ id: 'f', mode: 'download', url: 'https://cdn.test/a.mp4' }] }];
  const person = { id: 'actor-1', tmdbId: 123, name: 'Test Actor', nameFa: 'بازیگر تست', role: 'actor' };
  const catalog = { version: 'test', updatedAt: 'now', featuredPeople: [], items: [
    { id: 'm1', type: 'movie', nameFa: 'یک', name: 'One', people: [person], downloads: media },
    { id: 'm2', type: 'movie', nameFa: 'دو', name: 'Two', people: [person], downloads: media },
  ] };
  const { index } = buildClientCatalogArtifacts(catalog);
  assert.deepEqual(index.peopleWorks['tmdb:123'], ['m1', 'm2']);
  assert.deepEqual(index.peopleWorks['name:test actor'], ['m1', 'm2']);
  assert.deepEqual(index.peopleWorks['name:بازیگر تست'], ['m1', 'm2']);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');
const start = source.indexOf('async function syncEpisodeArtworkMetadata(');
const end = source.indexOf('\nasync function syncPeopleMetadata(', start);
assert.ok(start >= 0 && end > start);

test('an episode metadata failure does not prevent generating episode stills', async () => {
  const item = { id: 'series-1', type: 'series', downloads: [{ episodeNumber: 1 }] };
  const attempted = [];
  const errors = [];
  const context = {
    episodeArtworkSeriesPerRun: 1,
    positiveInt: (value, fallback) => Number(value) || fallback,
    items: [item],
    catalogVariant: () => 'normal',
    episodeArtworkUsage: () => new Map(),
    episodeGroupNeedsGeneratedFrame: () => true,
    peopleCandidateTimestamp: () => 0,
    stats: { episodeArtworkCandidates: 0, episodeArtworkSeriesChecked: 0, episodeArtworkAdded: 0 },
    state: { episodeArtworkOffset: 0 },
    runTimeBudgetReached: () => false,
    fetchSeriesEpisodeArtworkMetadata: async () => { throw new Error('HTTP 400'); },
    baseCatalogId: (value) => value.id,
    hydrateEpisodeGroupArtwork: () => 0,
    generateMissingEpisodeFrames: async (value) => { attempted.push(value.id); },
    rememberError: (scope, error) => errors.push([scope, error.message]),
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.run = syncEpisodeArtworkMetadata;`, context);
  await context.run();
  assert.deepEqual(attempted, ['series-1']);
  assert.deepEqual(errors, [['episode-artwork-series-1', 'HTTP 400']]);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');
const body = source.slice(source.indexOf('async function syncIranianSeriesArchive()'), source.indexOf('async function syncOperatorPriorityDiscovery()'));
function harness({ retryLater = false, addedEpisodes = 0 } = {}) {
  const blocked = { id: 'stalled', type: 'series', name: 'stalled', publicationStatus: 'building-archive' };
  const next = { id: 'next', type: 'series', name: 'next' };
  const state = { iranianSeriesPage: 1, iranianSeriesOffset: 0, iranianSeriesActiveId: 'stalled', iranianSeriesNoProgress: {} };
  const calls = [];
  const ctx = {
    state, items: [blocked], affiliateBudgetExhausted: false, affiliateScopeExhausted: false,
    iranianSeriesPagesPerRun: 1, priorityEpisodesPerSeries: 8,
    stats: { iranianSeriesCandidates: 0, iranianSeriesPagesProcessed: 0 },
    normalizeIdentityName: String, cleanText: v => String(v || ''),
    positiveInt: (v,d) => Number(v) > 0 ? Number(v) : d,
    nonNegativeInt: (v,d) => Number(v) >= 0 ? Number(v) : d,
    nextPage: () => 1, runTimeBudgetReached: () => false,
    fetchIranianSeriesPage: async () => ({ items: [blocked,next], lastPage: 1 }),
    dedupeCandidates: v => v, inferIranian: () => true, baseCatalogId: v => v.id,
    findExistingItem: v => ctx.items.find(i => i.id === v.id),
    classifyCatalogRules: () => ({ categoryKeys: ['iranian-series'] }),
    rememberDiagnostic: () => {}, rememberError: (_,err) => { throw err; },
    persistSyncCheckpoint: async () => {},
    replaceItem: v => { ctx.items[ctx.items.findIndex(i => i.id === v.id)] = v; },
    processSeries: async candidate => {
      calls.push(candidate.id);
      if (candidate.id === 'stalled') return { added: true, addedEpisodes, retryLater, remainingEpisodeCount: 4 };
      ctx.items.push({ ...next, archiveComplete: true, publicationStatus: 'published' });
      return { added: true, addedEpisodes: 3, remainingEpisodeCount: 0 };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(body, ctx);
  return { ctx, state, calls, run: () => ctx.syncIranianSeriesArchive() };
}
test('metadata-only writes release a stalled Iranian title after bounded retries', async () => {
  const h = harness();
  assert.equal(await h.run(), false);
  assert.equal(h.state.iranianSeriesNoProgress.stalled, 1);
  assert.equal(await h.run(), true);
  assert.deepEqual(h.calls, ['stalled', 'stalled', 'next']);
  assert.equal(h.ctx.items.find(i => i.id === 'stalled').archiveAuditStatus, 'blocked');
});
test('new episodes retain the active title for archive completion', async () => {
  const h = harness({ addedEpisodes: 1 });
  assert.equal(await h.run(), false);
  assert.equal(h.state.iranianSeriesActiveId, 'stalled');
  assert.equal(h.state.iranianSeriesNoProgress.stalled, 0);
});
test('a retryable request does not skip the active title', async () => {
  const h = harness({ retryLater: true });
  assert.equal(await h.run(), false);
  assert.equal(h.state.iranianSeriesActiveId, 'stalled');
  assert.equal(h.state.iranianSeriesNoProgress.stalled, 0);
});

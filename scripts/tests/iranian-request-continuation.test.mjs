import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');
const workflow = fs.readFileSync('.github/workflows/sync-upera.yml', 'utf8');
const positiveInt = (v, d) => Number(v) > 0 ? Number(v) : d;

test('new Iranian archive probes find playable tail beyond eight dead initial episodes', () => {
  const helper = source.slice(source.indexOf('function selectOperatorProbeEpisodes('), source.indexOf('async function processSeries('));
  const start = source.indexOf('  if (options.onlyEpisodeId)', source.indexOf('async function processSeries('));
  const selection = source.slice(start, source.indexOf('  let processedEpisodes', start));
  const episodes = Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), episodeNumber: i + 1 }));
  const ctx = { episodes, selectedEpisodes: [], options: { operatorProbe: true, episodeStrategy: 'latest', episodeLimit: 8, onlyMissing: true }, positiveInt, operatorProbeEpisodesPerSeries: 3, compareEpisodes: (a,b) => a.episodeNumber-b.episodeNumber, cleanText: String };
  vm.createContext(ctx);
  vm.runInContext(helper + selection, ctx);
  assert.ok(ctx.selectedEpisodes.some(e => e.episodeNumber === 30));
  assert.ok(ctx.selectedEpisodes.some(e => e.episodeNumber === 1));
  assert.equal(ctx.selectedEpisodes.length, 8);
  assert.equal(new Set(ctx.selectedEpisodes.map(e => e.id)).size, 8);
  // As soon as a title exists, missing episodes are filled in sequence.
  ctx.options.operatorProbe = false;
  ctx.missingEpisodes = episodes.slice(0, 29);
  ctx.priorityEpisodesPerSeries = 8;
  ctx.changedExistingEpisodes = [];
  vm.runInContext(selection, ctx);
  assert.equal(ctx.selectedEpisodes[0].episodeNumber, 1);
  assert.equal(ctx.selectedEpisodes[7].episodeNumber, 8);
  const lane = source.slice(source.indexOf('async function syncIranianSeriesArchive()'), source.indexOf('async function syncOperatorPriorityDiscovery()'));
  assert.match(lane, /operatorProbe: !existing/);
});

test('overlapping Iranian pages spend requests once per rejected title', async () => {
  const calls = [];
  const ctx = {
    state: { iranianSeriesPage: 1, iranianSeriesOffset: 0, iranianSeriesNoProgress: {} },
    items: [], affiliateBudgetExhausted: false, affiliateScopeExhausted: false,
    iranianSeriesPagesPerRun: 3, priorityEpisodesPerSeries: 8,
    stats: { iranianSeriesCandidates: 0, iranianSeriesPagesProcessed: 0 },
    normalizeIdentityName: String, cleanText: v => String(v || ''), positiveInt,
    nonNegativeInt: (v,d) => Number(v) >= 0 ? Number(v) : d,
    nextPage: (p,last) => p < last ? p+1 : 1, runTimeBudgetReached: () => false,
    fetchIranianSeriesPage: async p => ({ items: p === 1 ? [{id:'dead'}] : [{id:'dead'}, {id:'next'}], lastPage: 2 }),
    dedupeCandidates: v => v, inferIranian: () => true, baseCatalogId: v => v.id,
    findExistingItem: () => null, classifyCatalogRules: () => ({categoryKeys:[]}),
    rememberDiagnostic: () => {}, rememberError: (_,e) => {throw e;},
    persistSyncCheckpoint: async () => {},
    processSeries: async c => { calls.push(c.id); return {added:false, reason:'no-usable-links'}; },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('async function syncIranianSeriesArchive()'), source.indexOf('async function syncOperatorPriorityDiscovery()')), ctx);
  await ctx.syncIranianSeriesArchive();
  assert.deepEqual(calls, ['dead','next']);
});

test('scoped exhaustion resumes while a transient failure stops safely', () => {
  const match = workflow.match(/process\.stdout\.write\((\(last\.retryLater[^;]+)\);/);
  assert.ok(match);
  const decision = (r,last) => vm.runInNewContext(match[1], {r,last});
  assert.equal(decision({}, {retryLater:true,reason:'request-budget'}), 'no');
  assert.equal(decision({}, {retryLater:true,reason:'request-error'}), 'yes');
  assert.equal(decision({stoppedByTimeBudget:true}, {retryLater:true}), 'no');
  assert.match(workflow, /90000.*-ge.*APARATCHI_RUN_DEADLINE_AT_MS/);
});

test('every subprocess honors the same absolute deadline', () => {
  const start = source.indexOf('const localRunDeadlineAtMs');
  const body = source.slice(start, source.indexOf('const maxBackfillNoProgressRuns',start)) + '\nrunDeadlineAtMs;';
  const deadline = (env) => vm.runInNewContext(body, {runStartedAtMs:1000,runTimeLimitMinutes:10,process:{env}});
  assert.equal(deadline({}),601000);
  assert.equal(deadline({APARATCHI_RUN_DEADLINE_AT_MS:'101000'}),101000);
  assert.equal(deadline({APARATCHI_RUN_DEADLINE_AT_MS:'invalid'}),601000);
  assert.equal(deadline({APARATCHI_RUN_DEADLINE_AT_MS:'901000'}),601000);
});

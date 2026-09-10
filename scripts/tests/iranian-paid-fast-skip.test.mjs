import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');
test('Iranian source price never bypasses verified show_links discovery', () => {
  const processStart = source.indexOf('async function processSeries(');
  const processEnd = source.indexOf('async function fetchMoviePage(', processStart);
  const processBody = source.slice(processStart, processEnd);
  const laneStart = source.indexOf('async function syncIranianSeriesArchive()');
  const laneEnd = source.indexOf('async function syncOperatorPriorityDiscovery()', laneStart);
  const laneBody = source.slice(laneStart, laneEnd);
  assert.doesNotMatch(processBody, /episodesByCoordinate\.every\(sourceEpisodeIsExplicitlyPaid\)/);
  assert.doesNotMatch(processBody, /reason: 'paid-only-source'/);
  assert.doesNotMatch(laneBody, /'paid-only-source'/);
  assert.match(processBody, /await fetchAffiliateLinks\(episode\.id, 'episode'\)/);
});

test('dead candidates are deferred so later pages can be reached in following passes', () => {
  const lane = source.indexOf('async function syncIranianSeriesArchive()');
  const laneStart = source.indexOf('  const IRANIAN_DISCOVERY_RETRY_MS', lane);
  const laneEnd = source.indexOf('  const suppressed', laneStart);
  const context = {
    state: { iranianSeriesDeferredAt: { dead: '2026-09-10T00:00:00.000Z' } },
    cleanText: (value) => String(value ?? '').trim(),
  };
  vm.createContext(context);
  vm.runInContext(source.slice(laneStart, laneEnd).replace('  const iranianDiscoveryDeferred', '  this.iranianDiscoveryDeferred'), context);
  assert.equal(context.iranianDiscoveryDeferred('dead', Date.parse('2026-09-10T05:59:59.000Z')), true);
  assert.equal(context.iranianDiscoveryDeferred('dead', Date.parse('2026-09-10T06:00:01.000Z')), false);
  assert.equal(context.state.iranianSeriesDeferredAt.dead, undefined);
});

test('legacy Iranian detail HTTP 400 can recover from panel episodes', () => {
  const processStart = source.indexOf('async function processSeries(');
  const processEnd = source.indexOf('async function fetchMoviePage(', processStart);
  const processBody = source.slice(processStart, processEnd);
  assert.match(processBody, /options\.requireIranian === true && existingBeforeDetail && panelToken/);
  assert.match(processBody, /const panelEpisodes = await fetchPanelSeriesEpisodes\(id\)/);
  assert.match(processBody, /episodes: panelEpisodes/);
});

test('audited provider coordinates override invented numeric gaps', () => {
  const deficitStart = source.indexOf('function seriesArchiveDeficit(');
  const deficitEnd = source.indexOf('function archiveEpisodeCoordinateKey(', deficitStart);
  const deficitBody = source.slice(deficitStart, deficitEnd);
  assert.match(deficitBody, /const rawMissing = episodeGapsForGroups\(groups\)/);
  assert.match(deficitBody, /const missing = auditedDiscoveryComplete \? \[\] : rawMissing/);
});

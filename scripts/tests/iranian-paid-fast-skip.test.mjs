import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');
const start = source.indexOf('function sourceEpisodeIsExplicitlyPaid(');
const end = source.indexOf('function isUperaPrimaryMediaVariant(', start);
const context = {
  cleanText: (value) => String(value ?? '').trim(),
  normalizedMediaAmount: (value) => {
    if (value === undefined || value === null || value === '') return 0;
    const normalized = String(value).replace(/[^\d.+-]+/g, '');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  },
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

test('explicit TVOD episode rows are recognized without link requests', () => {
  assert.equal(context.sourceEpisodeIsExplicitlyPaid({ free: 0, price: 15000, tvod_price: 15000 }), true);
  assert.equal(context.sourceEpisodeIsExplicitlyPaid({ free: false, amount: '6500' }), true);
});

test('free or ambiguous episode rows still reach verified link discovery', () => {
  assert.equal(context.sourceEpisodeIsExplicitlyPaid({ free: 1, price: 15000 }), false);
  assert.equal(context.sourceEpisodeIsExplicitlyPaid({ free: 0, price: 0 }), false);
  assert.equal(context.sourceEpisodeIsExplicitlyPaid({ price: 15000 }), false);
  assert.equal(context.sourceEpisodeIsExplicitlyPaid({ free: 0 }), false);
});

test('Iranian discovery advances immediately past paid-only source titles', () => {
  const processStart = source.indexOf('async function processSeries(');
  const processEnd = source.indexOf('async function fetchMoviePage(', processStart);
  const processBody = source.slice(processStart, processEnd);
  const laneStart = source.indexOf('async function syncIranianSeriesArchive()');
  const laneEnd = source.indexOf('async function syncOperatorPriorityDiscovery()', laneStart);
  const laneBody = source.slice(laneStart, laneEnd);
  assert.match(processBody, /episodesByCoordinate\.every\(sourceEpisodeIsExplicitlyPaid\)/);
  assert.match(processBody, /reason: 'paid-only-source'/);
  assert.match(laneBody, /'paid-only-source'/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');

const between = (startNeedle, endNeedle) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `missing source block: ${startNeedle}`);
  return source.slice(start, end);
};

test('a completed recent Iranian title with zero new episodes cannot starve the archive queue', () => {
  const recent = between(
    'async function syncRecentIranianSeriesDiscovery()',
    'function archiveItemYear(item)',
  );
  assert.ok(recent.includes('for (const { candidate, existing, sourceId, timestamp } of candidates)'));
  assert.ok(recent.includes('const meaningfulRecentProgress = Boolean('));
  assert.ok(recent.includes('if (meaningfulRecentProgress) return true;'));
  assert.ok(!recent.includes('return Boolean(result?.added);'));

  const mode = between(
    "} else if (effectiveSyncMode === 'IRANIAN') {",
    "} else if (effectiveSyncMode === 'BACKFILL') {",
  );
  assert.match(
    mode,
    /await syncRecentIranianSeriesDiscovery\(\);[\s\S]*if \(!affiliateBudgetExhausted && !affiliateScopeExhausted\) \{[\s\S]*await syncIranianSeriesArchive\(\);/,
  );
  assert.ok(!mode.includes('if (!handledRecent'));
});

test('Iranian recent rows persist their newest page timestamp', () => {
  const processSeries = between(
    'async function processSeries(',
    'async function fetchMoviePage(page)',
  );
  assert.match(
    processSeries,
    /updated_at: maxDate\([\s\S]*detail\.series\?\.updated_at[\s\S]*candidate\?\.updated_at/,
  );
  assert.ok(processSeries.includes('newlyPublished: Boolean('));
});


test('terminal Iranian recent rows are not re-fetched until their source timestamp changes', () => {
  const recent = between(
    'async function syncRecentIranianSeriesDiscovery()',
    'function archiveItemYear(item)',
  );
  assert.ok(recent.includes('state.iranianRecentSeriesCheckedAt?.[sourceId]'));
  assert.ok(recent.includes('if (timestamp > 0 && checkedTimestamp >= timestamp) return false;'));
  assert.ok(recent.includes('const terminalRecentCheck = Boolean('));
  assert.ok(recent.includes('(!meaningfulRecentProgress || result?.archiveComplete)'));
  assert.ok(recent.includes('.slice(0, 96)'));
});

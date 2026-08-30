import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');

test('newly published episodes request an exact frame in the same sync run', () => {
  assert.match(
    source,
    /if \(latestForwardEpisode\) \{[\s\S]*findEpisodeGroup\(mergedGroups, latestForwardEpisode\)[\s\S]*await generateEpisodeFrameArtwork\(\{ id \}, latestForwardGroup\);/,
  );
});

test('episode artwork backlog renders newest episodes before old gaps', () => {
  const start = source.indexOf('async function generateMissingEpisodeFrames(item)');
  const end = source.indexOf('async function syncEpisodeArtworkMetadata', start);
  const block = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(block.includes('.sort((a, b) => compareEpisodeGroups(b, a));'));
});

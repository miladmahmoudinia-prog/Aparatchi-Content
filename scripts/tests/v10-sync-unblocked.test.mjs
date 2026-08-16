import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('hourly sync can reach midpoint episode artwork and immediate movie bootstrap code', async () => {
  const sync = await fs.readFile('scripts/sync-upera.mjs', 'utf8');
  const client = await fs.readFile('scripts/client-catalog.mjs', 'utf8');
  assert.match(sync, /'ffprobe'[\s\S]*format=duration/);
  assert.match(sync, /duration \* 0\.5/);
  assert.match(client, /compactBootstrapMovieActionPreview/);
});

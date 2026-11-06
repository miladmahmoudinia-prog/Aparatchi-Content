import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('TMDB publication stages both generated live v2 files before rebasing', () => {
  const workflow = fs.readFileSync('.github/workflows/enrich-tmdb-cast.yml', 'utf8');
  const stage = workflow.indexOf('git add -A -- catalog-live-v2.json catalog-live-v2-baseline.json');
  const rebase = workflow.indexOf('git pull --rebase origin main');
  assert.ok(stage >= 0 && rebase > stage);
});

test('sync reports failed checks after attempting to save progress', () => {
  const workflow = fs.readFileSync('.github/workflows/sync-upera.yml', 'utf8');
  assert.match(workflow, /group: aparatchi-content-write-lock\s+cancel-in-progress: false/);
  const commit = workflow.indexOf('name: Commit Iranian-series progress');
  const status = workflow.indexOf('name: Report failed validation or sync');
  assert.ok(commit >= 0 && status > commit);
  assert.match(workflow, /REGRESSION_OUTCOME: \$\{\{ steps\.regression_tests\.outcome \}\}/);
  assert.match(workflow, /NORMAL_OUTCOME: \$\{\{ steps\.normal_sync\.outcome \}\}/);
  assert.match(workflow, /IRANIAN_OUTCOME: \$\{\{ steps\.iranian_sync\.outcome \}\}/);
  assert.match(workflow, /FFMPEG_OUTCOME: \$\{\{ steps\.install_ffmpeg\.outcome \}\}/);
  assert.ok(workflow.indexOf('name: Install ffmpeg for episode artwork') < workflow.indexOf('name: Discover new movies and series first'));
  assert.match(workflow.slice(status), /exit 1/);
});

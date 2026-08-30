import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const syncWorkflow = fs.readFileSync('.github/workflows/sync-upera.yml', 'utf8');
const repairWorkflow = fs.readFileSync('.github/workflows/repair-iranian-series.yml', 'utf8');
const repairPatch = fs.readFileSync('scripts/patch-iranian-visible-repair.mjs', 'utf8');

test('main Iranian lane owns historical publishing and skips noisy Persian-language feeds', () => {
  assert.match(syncWorkflow, /- name: Complete one Iranian series sequentially/);
  assert.match(
    syncWorkflow,
    /- name: Complete one Iranian series sequentially[\s\S]*?timeout-minutes: 30[\s\S]*?continue-on-error: true/,
  );
  assert.match(syncWorkflow, /UPERA_SYNC_MODE: 'IRANIAN'/);
  assert.match(syncWorkflow, /UPERA_OPERATOR_DISCOVERY_ENABLED: 'false'/);
  assert.match(syncWorkflow, /export APARATCHI_SKIP_IRANIAN_RECENT='true'/);
  assert.match(syncWorkflow, /for pass in \$\(seq 1 90\)/);
  assert.match(syncWorkflow, /Published Iranian series before/);
  assert.match(syncWorkflow, /Published Iranian series after/);
  assert.match(syncWorkflow, /country: 'IR'/);
  assert.doesNotMatch(syncWorkflow, /\{ free: 1, persian: 1, traffic: 1, noFreeFallback: true \}/);
  assert.match(syncWorkflow, /sync-report-iranian\.json/);
});

test('repair workflow is manual fallback only, so it cannot replace pending hourly sync work', () => {
  assert.match(repairWorkflow, /name: Repair Iranian Series Episodes/);
  assert.match(repairWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(repairWorkflow, /workflow_run:/);
  assert.doesNotMatch(repairWorkflow, /schedule:/);
  assert.match(repairWorkflow, /group: aparatchi-content-write-lock/);
  assert.match(repairWorkflow, /node scripts\/patch-iranian-visible-repair\.mjs "\$RUNTIME_SYNC"/);
  assert.match(repairWorkflow, /APARATCHI_SKIP_IRANIAN_RECENT: 'true'/);

  assert.match(repairPatch, /const iranianVisibleRepairCandidates/);
  assert.match(repairPatch, /expectedEpisodes > usableEpisodes/);
  assert.match(repairPatch, /iranian-visible-repair/);
  assert.match(repairPatch, /iranianVisibleRepairActiveId/);
  assert.match(repairPatch, /iranianVisibleRepairNoProgress/);
  assert.match(repairPatch, /iranianVisibleRepairDeferredAt/);
  assert.match(repairPatch, /episodeGroupHasUsableMedia/);
  assert.match(repairPatch, /processSeries\(\{ id, type: "series" \}, "iranian-visible-repair"/);
});

test('catalog discovery runs hourly', () => {
  assert.match(syncWorkflow, /cron: '34 \* \* \* \*'/);
});

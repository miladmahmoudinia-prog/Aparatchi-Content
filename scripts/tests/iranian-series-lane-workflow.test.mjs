import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const syncWorkflow = fs.readFileSync('.github/workflows/sync-upera.yml', 'utf8');
const repairWorkflow = fs.readFileSync('.github/workflows/repair-iranian-series.yml', 'utf8');
const repairPatch = fs.readFileSync('scripts/patch-iranian-visible-repair.mjs', 'utf8');

test('main Iranian lane remains sequential and skips terminal source rows inside one run', () => {
  assert.match(syncWorkflow, /- name: Complete one Iranian series sequentially/);
  assert.match(
    syncWorkflow,
    /- name: Complete one Iranian series sequentially[\s\S]*?timeout-minutes: 30[\s\S]*?continue-on-error: true/,
  );
  assert.match(syncWorkflow, /UPERA_SYNC_MODE: 'IRANIAN'/);
  assert.match(syncWorkflow, /UPERA_OPERATOR_DISCOVERY_ENABLED: 'false'/);
  assert.match(syncWorkflow, /APARATCHI_SKIP_IRANIAN_RECENT/);
  assert.match(syncWorkflow, /for pass in \$\(seq 1 24\)/);
  assert.match(syncWorkflow, /sync-report-iranian\.json/);
});

test('repair workflow prioritizes existing Iranian series with missing episode media', () => {
  assert.match(repairWorkflow, /name: Repair Iranian Series Episodes/);
  assert.match(repairWorkflow, /workflows:[\s\S]*?'Sync Upera Catalog'/);
  assert.match(repairWorkflow, /group: aparatchi-content-write-lock/);
  assert.match(repairWorkflow, /node scripts\/patch-iranian-visible-repair\.mjs "\$RUNTIME_SYNC"/);
  assert.match(repairWorkflow, /APARATCHI_SKIP_IRANIAN_RECENT: 'true'/);
  assert.match(repairWorkflow, /for pass in \$\(seq 1 24\)/);

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

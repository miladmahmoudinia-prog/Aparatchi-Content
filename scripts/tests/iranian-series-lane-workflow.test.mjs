import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/sync-upera.yml', 'utf8');

test('dedicated Iranian lane skips terminal non-Iranian rows within the same workflow run', () => {
  assert.match(workflow, /- name: Complete one Iranian series sequentially/);
  assert.match(workflow, /UPERA_SYNC_MODE: 'IRANIAN'/);
  assert.match(workflow, /UPERA_OPERATOR_DISCOVERY_ENABLED: 'false'/);
  assert.match(workflow, /for pass in \$\(seq 1 24\)/);
  assert.match(workflow, /sync-report-iranian\.json/);
  assert.match(workflow, /decision=\"\$\(node -e/);
  assert.match(workflow, /const newlyPublished=Boolean\(last&&last\.newlyPublished\)/);
  assert.match(workflow, /last\.result===\"completed\"&&newlyPublished/);
  assert.match(workflow, /last&&last\.result===\"completed\"\) process\.stdout\.write\(\"skip\"\)/);
  assert.match(workflow, /IRANIAN_COMPLETED=\$\(\(IRANIAN_COMPLETED \+ 1\)\)/);
  assert.match(workflow, /if \[ \"\$IRANIAN_COMPLETED\" -ge 3 \]; then/);
  assert.match(workflow, /if \[ \"\$decision\" != \"skip\" \]; then/);
});

test('catalog discovery runs hourly', () => {
  assert.match(workflow, /cron: '34 \* \* \* \*'/);
});

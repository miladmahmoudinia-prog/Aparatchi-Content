import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');

test('an unlabeled Upera row never manufactures the opposite media language', () => {
  assert.ok(!source.includes("const counterpart = explicit.has('dubbed') ? 'subtitled' : 'dubbed';"));
  assert.ok(source.includes('for (const link of unknown) link._drop_ambiguous_language = true;'));
  assert.ok(source.includes("file.language === 'dubbed' ||"));
});

test('language audits replace stale rows only from a usable fresh snapshot', () => {
  assert.ok(source.includes('MEDIA_LANGUAGE_AUDIT_VERSION = 7'));
  assert.ok(source.includes('freshHasUsableOrdinaryMedia'));
  assert.ok(source.includes("fullMediaAudit: true, replaceMedia: true"));
  assert.ok(source.includes('replaceMedia: hadUsableMedia'));
  assert.ok(source.includes('preservedVerifiedPortalFiles'));
  assert.ok(!source.includes("'backfill-language-repair'"));
});

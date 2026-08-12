import fs from 'node:fs/promises';

const path = 'scripts/tests/sync-upera-regression.test.mjs';
let source = await fs.readFile(path, 'utf8');
source = source.replaceAll('assert.equal(item.mediaLanguageAuditVersion, 5);', 'assert.equal(item.mediaLanguageAuditVersion, 6);');
source = source.replaceAll('assert.equal(repaired.mediaLanguageAuditVersion, 5);', 'assert.equal(repaired.mediaLanguageAuditVersion, 6);');
await fs.writeFile(path, source, 'utf8');
console.log('Aligned media-language audit regression expectations to v6.');

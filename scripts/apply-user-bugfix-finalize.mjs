import fs from 'node:fs/promises';

const path = 'scripts/tests/sync-upera-regression.test.mjs';
let source = await fs.readFile(path, 'utf8');
source = source.replaceAll('mediaLanguageAuditVersion, 5);', 'mediaLanguageAuditVersion, 6);');
await fs.writeFile(path, source, 'utf8');
console.log('Aligned all media-language audit regression expectations to v6.');

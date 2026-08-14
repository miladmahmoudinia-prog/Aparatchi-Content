import fs from 'node:fs/promises';

const syncPath = 'scripts/sync-upera.mjs';
let syncSource = await fs.readFile(syncPath, 'utf8');

const importLine = "import { applyVerifiedPersianTitleOverrides } from './persian-title-overrides.mjs';\n";
if (!syncSource.includes(importLine.trim())) {
  const anchor = "import { writeClientCatalogArtifacts } from './client-catalog.mjs';\n";
  if (!syncSource.includes(anchor)) throw new Error('sync import anchor not found');
  syncSource = syncSource.replace(anchor, `${anchor}${importLine}`);
}

const writerBefore = `async function writeCatalogAndManifest(value) {\n  const serialized = \`${'${JSON.stringify(value, null, 2)}'}\\n\`;`;
const writerAfter = `async function writeCatalogAndManifest(value) {\n  applyVerifiedPersianTitleOverrides(value);\n  const serialized = \`${'${JSON.stringify(value, null, 2)}'}\\n\`;`;
if (!syncSource.includes(writerAfter)) {
  if (!syncSource.includes(writerBefore)) throw new Error('sync writer anchor not found');
  syncSource = syncSource.replace(writerBefore, writerAfter);
}
await fs.writeFile(syncPath, syncSource, 'utf8');

const enrichPath = 'scripts/enrich-persian-titles.mjs';
let enrichSource = await fs.readFile(enrichPath, 'utf8');
const enrichImport = "import { applyVerifiedPersianTitleOverrides } from './persian-title-overrides.mjs';\n";
if (!enrichSource.includes(enrichImport.trim())) {
  const anchor = "import { createHash } from 'node:crypto';\n";
  if (!enrichSource.includes(anchor)) throw new Error('Persian enrich import anchor not found');
  enrichSource = enrichSource.replace(anchor, `${anchor}${enrichImport}`);
}

const beforeWrite = `cache.updatedAt = new Date().toISOString();\nif (changed) catalog.updatedAt = cache.updatedAt;`;
const afterWrite = `const verifiedOverrideResult = applyVerifiedPersianTitleOverrides(catalog);\nif (verifiedOverrideResult.titleChanges || verifiedOverrideResult.collectionChanges) {\n  changed = true;\n  titlesFilled += verifiedOverrideResult.titleChanges;\n}\n\ncache.updatedAt = new Date().toISOString();\nif (changed) catalog.updatedAt = cache.updatedAt;`;
if (!enrichSource.includes(afterWrite)) {
  if (!enrichSource.includes(beforeWrite)) throw new Error('Persian enrich write anchor not found');
  enrichSource = enrichSource.replace(beforeWrite, afterWrite);
}
await fs.writeFile(enrichPath, enrichSource, 'utf8');

console.log('Persistent Persian-title override repair applied.');

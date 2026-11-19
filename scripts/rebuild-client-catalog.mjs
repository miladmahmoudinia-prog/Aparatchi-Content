import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeClientCatalogArtifacts } from './client-catalog.mjs';

import { reviewedGeneralDocs } from './classification.mjs';
const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const manifestPath = path.join(root, 'catalog-manifest.json');
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
let corrected = false;
for (const item of catalog.items) {
  if (!reviewedGeneralDocs.has(item.id)) continue;
  const fields = { isDocumentary: true, isWildlife: false, contentKind: 'documentary',
    categoryKeys: [...new Set([...(item.categoryKeys || []).filter(k => k !== 'wildlife'), 'documentaries'])],
    categoryLabels: [...new Set([...(item.categoryLabels || []).filter(k => k !== 'حیات وحش'), 'مستند'])] };
  if (Object.entries(fields).some(([k,v]) => JSON.stringify(item[k]) !== JSON.stringify(v))) {
    Object.assign(item, fields); corrected = true;
  }
}
const catalogSerialized = `${JSON.stringify(catalog, null, 2)}\n`;
if (corrected) await fs.writeFile(catalogPath, catalogSerialized);
const result = await writeClientCatalogArtifacts(root, catalog);

// Rebuilding the compact client artifacts can change the visible item count,
// client revision and bootstrap revision without touching catalog.json. Keep
// the manifest bound to those freshly generated artifacts in the same step so
// regression tests and mobile clients never observe a stale manifest/index pair.
const manifest = {
  schemaVersion: 2,
  revision: createHash('sha256').update(catalogSerialized).digest('hex'),
  clientRevision: result.clientRevision,
  clientItemCount: result.clientItemCount,
  catalogVersion: String(catalog?.version || 'client-index').trim(),
  catalogUpdatedAt: String(catalog?.updatedAt || '').trim(),
  sizeBytes: Buffer.byteLength(catalogSerialized),
  clientSizeBytes: result.clientSizeBytes,
  clientIndex: 'catalog-index.json',
  bootstrapRevision: result.bootstrapRevision,
  bootstrapItemCount: result.bootstrapItemCount,
  bootstrapSizeBytes: result.bootstrapSizeBytes,
  bootstrapIndex: 'catalog-bootstrap.json',
  detailBase: 'catalog-items/',
};
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(
  `Client catalog rebuilt: items=${result.index.items.length}, indexChanged=${result.indexChanged}, detailFilesChanged=${result.changedDetailFiles}`,
);

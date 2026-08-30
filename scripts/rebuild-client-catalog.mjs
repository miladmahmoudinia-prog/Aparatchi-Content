import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeClientCatalogArtifacts } from './client-catalog.mjs';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const manifestPath = path.join(root, 'catalog-manifest.json');
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const catalogSerialized = `${JSON.stringify(catalog, null, 2)}\n`;
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

import fs from 'node:fs/promises';
import { writeClientCatalogArtifacts } from './client-catalog.mjs';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const artifacts = await writeClientCatalogArtifacts('.', catalog);

const manifestPath = 'catalog-manifest.json';
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
manifest.clientRevision = artifacts.clientRevision;
manifest.clientSizeBytes = artifacts.clientSizeBytes;
manifest.clientIndex = 'catalog-index.json';
manifest.detailBase = 'catalog-items/';
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  itemCount: artifacts.index.items.length,
  clientSizeBytes: artifacts.clientSizeBytes,
  clientRevision: artifacts.clientRevision,
  indexChanged: artifacts.indexChanged,
  changedDetailFiles: artifacts.changedDetailFiles,
}, null, 2));

import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { applyOperatorMetadataRepair } from './operator-metadata-repair.mjs';
import {
  classifyCatalogItem,
  isManagedCategoryKey,
  isManagedCategoryLabel,
} from './classification.mjs';
import { writeClientCatalogArtifacts } from './client-catalog.mjs';

const unique = (values) => [...new Set(values.filter(Boolean))];
const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const repairStats = applyOperatorMetadataRepair(catalog.items);

for (const item of Array.isArray(catalog.items) ? catalog.items : []) {
  if (!item || !['movie', 'series'].includes(item.type)) continue;
  const result = classifyCatalogItem(item);
  const preservedKeys = (Array.isArray(item.categoryKeys) ? item.categoryKeys : [])
    .filter((key) => !isManagedCategoryKey(key));
  const preservedLabels = (Array.isArray(item.categoryLabels) ? item.categoryLabels : [])
    .filter((label) => !isManagedCategoryLabel(label));
  item.categoryKeys = unique([...result.categoryKeys, ...preservedKeys]);
  item.categoryLabels = unique([...result.categoryLabels, ...preservedLabels]);
  item.contentKind = result.contentKind;
  item.ir = result.ir;
  item.isAnimation = result.isAnimation;
  item.isAnime = result.isAnime;
  item.isDocumentary = result.isDocumentary;
  item.isWildlife = result.isWildlife;
  item.isTalkShow = result.isTalkShow;
}

catalog.updatedAt = new Date().toISOString();
const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
await fs.writeFile('catalog.json', serialized, 'utf8');
const artifacts = await writeClientCatalogArtifacts(process.cwd(), catalog);
const manifest = {
  schemaVersion: 2,
  revision: createHash('sha256').update(serialized).digest('hex'),
  clientRevision: artifacts.clientRevision,
  catalogVersion: String(catalog.version || ''),
  catalogUpdatedAt: String(catalog.updatedAt || ''),
  sizeBytes: Buffer.byteLength(serialized),
  clientSizeBytes: artifacts.clientSizeBytes,
  clientIndex: 'catalog-index.json',
  bootstrapRevision: artifacts.bootstrapRevision,
  bootstrapSizeBytes: artifacts.bootstrapSizeBytes,
  bootstrapIndex: 'catalog-bootstrap.json',
  detailBase: 'catalog-items/',
};
await fs.writeFile('catalog-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  repairStats,
  catalogItems: catalog.items.length,
  clientItems: artifacts.index.items.length,
  bootstrapItems: artifacts.bootstrap.items.length,
  bootstrapSizeBytes: artifacts.bootstrapSizeBytes,
  clientRevision: artifacts.clientRevision,
  bootstrapRevision: artifacts.bootstrapRevision,
}, null, 2));

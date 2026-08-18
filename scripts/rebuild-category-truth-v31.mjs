import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  classifyCatalogItem,
  isManagedCategoryKey,
  isManagedCategoryLabel,
} from './classification.mjs';
import { writeClientCatalogArtifacts } from './client-catalog.mjs';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const items = Array.isArray(catalog.items) ? catalog.items : [];
const unique = (values) => [...new Set(values.filter(Boolean))];
let changed = 0;

for (const item of items) {
  const rules = classifyCatalogItem(item);
  const before = JSON.stringify({
    categoryKeys: item.categoryKeys,
    categoryLabels: item.categoryLabels,
    contentKind: item.contentKind,
    isAnimation: item.isAnimation,
    isAnime: item.isAnime,
    isDocumentary: item.isDocumentary,
    isWildlife: item.isWildlife,
    isTalkShow: item.isTalkShow,
    ir: item.ir,
  });
  item.categoryKeys = unique([
    ...(Array.isArray(item.categoryKeys) ? item.categoryKeys : []).filter((key) => !isManagedCategoryKey(key)),
    ...(rules.categoryKeys || []),
  ]);
  item.categoryLabels = unique([
    ...(Array.isArray(item.categoryLabels) ? item.categoryLabels : []).filter((label) => !isManagedCategoryLabel(label)),
    ...(rules.categoryLabels || []),
  ]);
  item.contentKind = rules.contentKind;
  item.isAnimation = rules.isAnimation;
  item.isAnime = rules.isAnime;
  item.isDocumentary = rules.isDocumentary;
  item.isWildlife = rules.isWildlife;
  item.isTalkShow = rules.isTalkShow;
  if (typeof rules.ir === 'boolean') item.ir = rules.ir;
  const after = JSON.stringify({
    categoryKeys: item.categoryKeys,
    categoryLabels: item.categoryLabels,
    contentKind: item.contentKind,
    isAnimation: item.isAnimation,
    isAnime: item.isAnime,
    isDocumentary: item.isDocumentary,
    isWildlife: item.isWildlife,
    isTalkShow: item.isTalkShow,
    ir: item.ir,
  });
  if (before !== after) changed += 1;
}

catalog.updatedAt = new Date().toISOString();
const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
await fs.writeFile(catalogPath, serialized, 'utf8');
const clientArtifacts = await writeClientCatalogArtifacts(root, catalog);
const catalogBytes = Buffer.from(serialized, 'utf8');
const indexBytes = await fs.readFile(path.join(root, 'catalog-index.json'));
const bootstrapBytes = await fs.readFile(path.join(root, 'catalog-bootstrap.json'));
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const manifest = {
  schemaVersion: 2,
  revision: hash(catalogBytes),
  clientRevision: hash(indexBytes),
  catalogVersion: String(catalog.version || '').trim(),
  catalogUpdatedAt: String(catalog.updatedAt || '').trim(),
  sizeBytes: catalogBytes.length,
  clientSizeBytes: indexBytes.length,
  clientIndex: 'catalog-index.json',
  bootstrapRevision: hash(bootstrapBytes),
  bootstrapSizeBytes: bootstrapBytes.length,
  bootstrapIndex: 'catalog-bootstrap.json',
  detailBase: 'catalog-items/',
  stableDetailBase: 'catalog-stable/',
};
await fs.writeFile(path.join(root, 'catalog-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ changed, items: items.length, clientRevision: clientArtifacts.clientRevision }, null, 2));

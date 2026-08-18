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
const manifestPath = path.join(root, 'catalog-manifest.json');
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const items = Array.isArray(catalog.items) ? catalog.items : [];
let changed = 0;

const unique = (values) => [...new Set(values.filter(Boolean))];
for (const item of items) {
  const rules = classifyCatalogItem(item);
  const oldKeys = Array.isArray(item.categoryKeys) ? item.categoryKeys : [];
  const oldLabels = Array.isArray(item.categoryLabels) ? item.categoryLabels : [];
  const categoryKeys = unique([
    ...oldKeys.filter((key) => !isManagedCategoryKey(key)),
    ...(rules.categoryKeys || []),
  ]);
  const categoryLabels = unique([
    ...oldLabels.filter((label) => !isManagedCategoryLabel(label)),
    ...(rules.categoryLabels || []),
  ]);
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
  item.categoryKeys = categoryKeys;
  item.categoryLabels = categoryLabels;
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
const manifest = {
  schemaVersion: 2,
  revision: createHash('sha256').update(serialized).digest('hex'),
  clientRevision: clientArtifacts.clientRevision,
  catalogVersion: String(catalog.version || '').trim(),
  catalogUpdatedAt: String(catalog.updatedAt || '').trim(),
  sizeBytes: Buffer.byteLength(serialized),
  clientSizeBytes: clientArtifacts.clientSizeBytes,
  clientIndex: 'catalog-index.json',
  clientBootstrap: 'catalog-bootstrap.json',
  generatedAt: new Date().toISOString(),
};
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ changed, items: items.length, clientRevision: clientArtifacts.clientRevision }, null, 2));

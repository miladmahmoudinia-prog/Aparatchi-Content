import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  classifyCatalogItem,
  isManagedCategoryKey,
  isManagedCategoryLabel,
} from './classification.mjs';
import { applyVerifiedPersianTitleOverrides } from './persian-title-overrides.mjs';
import { writeClientCatalogArtifacts } from './client-catalog.mjs';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const manifestPath = path.join(root, 'catalog-manifest.json');
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const items = Array.isArray(catalog.items) ? catalog.items : [];

applyVerifiedPersianTitleOverrides(catalog);

let changed = 0;
for (const item of items) {
  if (!item || !['movie', 'series'].includes(item.type)) continue;
  const rules = classifyCatalogItem(item);
  const preservedKeys = (Array.isArray(item.categoryKeys) ? item.categoryKeys : [])
    .filter((key) => !isManagedCategoryKey(key));
  const preservedLabels = (Array.isArray(item.categoryLabels) ? item.categoryLabels : [])
    .filter((label) => !isManagedCategoryLabel(label));
  const nextKeys = [...new Set([...rules.categoryKeys, ...preservedKeys].filter(Boolean))];
  const nextLabels = [...new Set([...rules.categoryLabels, ...preservedLabels].filter(Boolean))];
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
  item.categoryKeys = nextKeys;
  item.categoryLabels = nextLabels;
  item.contentKind = rules.contentKind;
  item.isAnimation = rules.isAnimation;
  item.isAnime = rules.isAnime;
  item.isDocumentary = rules.isDocumentary;
  item.isWildlife = rules.isWildlife;
  item.isTalkShow = rules.isTalkShow;
  item.ir = rules.ir;
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

// Make the artifact generation identity explicit so mobile startup cannot accept
// a previous bootstrap with the same catalog timestamp after this migration.
catalog.updatedAt = new Date().toISOString();
const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
await fs.writeFile(catalogPath, serialized, 'utf8');
const artifacts = await writeClientCatalogArtifacts(root, catalog);
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
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const korean = items.filter((item) => item.type === 'movie' && item.categoryKeys?.includes('korean-movies'));
const badKorean = korean.filter((item) => {
  const language = String(item.originalLanguage || '').toLowerCase();
  const primary = String(item.countryCodes?.[0] || '').toUpperCase();
  return language ? language !== 'ko' : primary !== 'KR';
});
const indianSeries = items.filter((item) => item.categoryKeys?.includes('indian-series'));
const springGarden = items.find((item) => String(item.name || '').toLowerCase() === 'spring garden');
const indianSeriesExample = items.find((item) => String(item.name || '').toLowerCase().includes('janaawar'));
const snakes = items.filter((item) => /ultimate guide:\s*snakes/i.test(String(item.name || '')));
const crocs = items.filter((item) => /alligator.*american crocodile|american crocodile.*alligator/i.test(String(item.name || '')));
const minions = items.filter((item) => /minions.*rise of gru/i.test(String(item.name || '')));

if (badKorean.length) throw new Error(`Still have ${badKorean.length} non-Korean rows in korean-movies`);
if (indianSeries.length) throw new Error(`Still have ${indianSeries.length} rows in removed indian-series`);
if (springGarden && springGarden.nameFa !== 'باغ بهاری') throw new Error(`Spring Garden title is still ${springGarden.nameFa}`);
if (indianSeriesExample && !indianSeriesExample.categoryKeys?.includes('foreign-series')) throw new Error('Indian series example did not move to foreign-series');
for (const item of [...snakes, ...crocs]) {
  if (!item.categoryKeys?.includes('wildlife') || item.categoryKeys?.includes('documentaries')) {
    throw new Error(`Wildlife classification still wrong for ${item.name}`);
  }
}
for (const item of minions) {
  if (item.categoryKeys?.includes('documentaries') || item.categoryKeys?.includes('wildlife')) {
    throw new Error(`Minions is still classified as documentary: ${item.name}`);
  }
}

console.log(JSON.stringify({
  reclassifiedItems: changed,
  koreanMovies: korean.length,
  badKorean: badKorean.length,
  indianSeries: indianSeries.length,
  springGarden: springGarden ? { nameFa: springGarden.nameFa, categoryKeys: springGarden.categoryKeys } : null,
  indianSeriesExample: indianSeriesExample ? { nameFa: indianSeriesExample.nameFa, categoryKeys: indianSeriesExample.categoryKeys } : null,
  wildlifeChecks: [...snakes, ...crocs].map((item) => ({ name: item.name, categoryKeys: item.categoryKeys })),
  minionsChecks: minions.map((item) => ({ name: item.name, categoryKeys: item.categoryKeys })),
}, null, 2));

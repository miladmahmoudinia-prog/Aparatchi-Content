import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const replaceOnce = (source, before, after, label) => {
  if (!source.includes(before)) throw new Error(`Missing v34 patch marker: ${label}`);
  return source.replace(before, after);
};

const classificationFile = 'scripts/classification.mjs';
let classification = await fs.readFile(classificationFile, 'utf8');
classification = replaceOnce(
  classification,
  "  const knownDocumentary = includesAny(titleText, [\n    'از بی', 'از به', 'az be',\n    'من ناصر حجازی هستم', 'i am nasser hejazi',\n    'deep sea 3d', 'دریای عمیق',\n  ]);",
  `  const exactTitleNames = [normalize(input.nameFa), normalize(input.name)].filter(Boolean);\n  const verifiedDocumentaryTitleYear = [\n    [2023, ['شاهد']],\n    [2025, ['عبای سوخته']],\n    [2026, ['زنگ میناب']],\n    [2024, ['شه بانو']],\n    [2025, ['فرزانه جلیسی']],\n    [2021, ['فاطمیه در کلیسا']],\n    [2024, ['غدیر از کانت تا وایسکه']],\n    [2024, ['نجیب زادگی', 'نجیب‌زادگی']],\n    [2025, ['سلطان ناصر']],\n  ].some(([year, names]) =>\n    Number(input.year || 0) === Number(year) &&\n    names.some((name) => exactTitleNames.includes(normalize(name)))\n  );\n  const knownDocumentary = verifiedDocumentaryTitleYear || includesAny(titleText, [\n    'از بی', 'از به', 'az be',\n    'من ناصر حجازی هستم', 'i am nasser hejazi',\n    'deep sea 3d', 'دریای عمیق',\n  ]);`,
  'verified operator documentary identities',
);
await fs.writeFile(classificationFile, classification, 'utf8');

const clientFile = 'scripts/client-catalog.mjs';
let client = await fs.readFile(clientFile, 'utf8');
client = replaceOnce(
  client,
  "  'countryCodes', 'originalLanguage', 'collectionId', 'collectionOrder',",
  "  'countryCodes', 'countryLabels', 'countryNames', 'originalLanguage', 'collectionId', 'collectionOrder',",
  'bootstrap country metadata',
);
client = replaceOnce(
  client,
  "  'poster', 'posterFallback', 'backdrop', 'backdropFallback', 'rate', 'access', 'operatorOnly', 'availableLanguages',",
  "  'poster', 'posterFallback', 'backdrop', 'backdropFallback', 'overview', 'genres', 'rate', 'access', 'operatorOnly', 'availableLanguages',",
  'bootstrap detail-first-paint metadata',
);
client = replaceOnce(
  client,
  "  // Keep only enough people metadata for the first visible cast row. The full\n  // detail shard remains authoritative and replaces this preview after hydration.\n  if (Array.isArray(item?.people) && item.people.length) {\n    compact.people = item.people.slice(0, 4);\n  }",
  "  // Carry the same bounded cast/director preview as the client index. Detail\n  // may enrich it later, but opening the screen must not create the section late.\n  if (Array.isArray(item?.people) && item.people.length) {\n    compact.people = item.people.slice(0, 8);\n  }",
  'bootstrap people preview',
);
await fs.writeFile(clientFile, client, 'utf8');

// Repair the current generated catalog now as well as future syncs. This makes
// the fix visible immediately after merge instead of waiting for a later lane.
const { applyOperatorMetadataRepair } = await import('./operator-metadata-repair.mjs?v34');
const {
  classifyCatalogItem,
  isManagedCategoryKey,
  isManagedCategoryLabel,
} = await import('./classification.mjs?v34');
const { writeClientCatalogArtifacts } = await import('./client-catalog.mjs?v34');

const catalogPath = 'catalog.json';
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const repairStats = applyOperatorMetadataRepair(catalog.items);
const unique = (values) => [...new Set(values.filter(Boolean))];

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
const catalogSerialized = `${JSON.stringify(catalog, null, 2)}\n`;
await fs.writeFile(catalogPath, catalogSerialized, 'utf8');
const artifacts = await writeClientCatalogArtifacts(process.cwd(), catalog);
const manifest = {
  schemaVersion: 2,
  revision: createHash('sha256').update(catalogSerialized).digest('hex'),
  clientRevision: artifacts.clientRevision,
  catalogVersion: String(catalog.version || ''),
  catalogUpdatedAt: String(catalog.updatedAt || ''),
  sizeBytes: Buffer.byteLength(catalogSerialized),
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
  clientItems: artifacts.index.items.length,
  bootstrapItems: artifacts.bootstrap.items.length,
  bootstrapSizeBytes: artifacts.bootstrapSizeBytes,
  clientRevision: artifacts.clientRevision,
}, null, 2));
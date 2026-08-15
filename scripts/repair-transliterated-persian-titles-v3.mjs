import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import {
  applyVerifiedPersianTitleOverrides,
  isLikelySyntheticPersianDisplayTitle,
} from './persian-title-overrides.mjs';
import { writeClientCatalogArtifacts } from './client-catalog.mjs';

const root = process.cwd();
const catalogPath = 'catalog.json';
const manifestPath = 'catalog-manifest.json';
const baselinePath = process.env.PRE_REPAIR_CATALOG;
if (!baselinePath) throw new Error('PRE_REPAIR_CATALOG is required.');

const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
const baselineById = new Map((baseline.items || []).filter(Boolean).map((item) => [String(item.id), item]));
const titles = (catalog.items || []).filter((item) => item && ['movie', 'series'].includes(item.type));

let restoredFalsePositives = 0;
for (const item of titles) {
  if (item.nameFaSource !== 'original-title-fallback') continue;
  const previous = baselineById.get(String(item.id));
  if (!previous || previous.nameFaGenerated === true || previous.nameFaSource === 'generated-transliteration') continue;
  const previousFa = String(previous.nameFa || '').trim();
  if (!/[\u0600-\u06FF]/.test(previousFa)) continue;
  if (isLikelySyntheticPersianDisplayTitle(previous)) continue;

  item.nameFa = previous.nameFa;
  if (previous.nameFaSource) item.nameFaSource = previous.nameFaSource;
  else delete item.nameFaSource;
  restoredFalsePositives += 1;
}

const suspiciousBefore = titles.filter(isLikelySyntheticPersianDisplayTitle);
console.log('CONSERVATIVE_SYNTHETIC_BEFORE=' + suspiciousBefore.length);
console.log('RESTORED_FALSE_POSITIVES=' + restoredFalsePositives);
if (suspiciousBefore.length) {
  console.log(JSON.stringify(suspiciousBefore.slice(0, 40).map((item) => ({
    id: item.id, name: item.name, nameFa: item.nameFa, source: item.nameFaSource,
  })), null, 2));
}

const result = applyVerifiedPersianTitleOverrides(catalog);
const remaining = titles.filter(isLikelySyntheticPersianDisplayTitle);
if (remaining.length) throw new Error(remaining.length + ' conservative transliteration candidates remain after repair.');

const generatedMarkers = titles.filter((item) => item.nameFaGenerated === true || item.nameFaSource === 'generated-transliteration');
if (generatedMarkers.length) throw new Error(generatedMarkers.length + ' legacy generated-title markers remain.');

// Regression against the accidental broad repair: only Latin-source short
// proper names count here. Native Persian source names such as *.mp4 labels
// are outside the English-to-Persian transliteration policy entirely.
const unrestoredShortNames = titles.filter((item) => {
  if (item.nameFaSource !== 'original-title-fallback') return false;
  const previous = baselineById.get(String(item.id));
  if (!previous || previous.nameFaGenerated === true || previous.nameFaSource === 'generated-transliteration') return false;
  const previousName = String(previous.name || '').trim().replace(/\.mp4$/i, '').trim();
  // The source itself must be a Latin title. Persian/native titles with a
  // Latin file extension are outside English-to-Persian transliteration.
  if (!/\p{Script=Latin}/u.test(previousName) || /[\u0600-\u06FF]/.test(previousName)) return false;
  const previousFa = String(previous.nameFa || '').trim();
  if (!/[\u0600-\u06FF]/.test(previousFa)) return false;
  const words = previousName.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return words.length < 3;
});
if (unrestoredShortNames.length) {
  console.log(JSON.stringify(unrestoredShortNames.slice(0, 30).map((item) => ({ id:item.id, name:item.name, nameFa:item.nameFa })), null, 2));
  throw new Error(unrestoredShortNames.length + ' short proper-name Persian titles are still erased.');
}

if (restoredFalsePositives || result.titleChanges || result.collectionChanges) catalog.updatedAt = new Date().toISOString();
const serialized = JSON.stringify(catalog, null, 2) + '\n';
await fs.writeFile(catalogPath, serialized, 'utf8');
const artifacts = await writeClientCatalogArtifacts(root, catalog);
let manifest = {};
try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch {}
manifest.schemaVersion = 2;
manifest.revision = createHash('sha256').update(serialized).digest('hex');
manifest.clientRevision = artifacts.clientRevision;
manifest.catalogVersion = String(catalog.version || '').trim();
manifest.catalogUpdatedAt = String(catalog.updatedAt || '').trim();
manifest.sizeBytes = Buffer.byteLength(serialized);
manifest.clientSizeBytes = artifacts.clientSizeBytes;
manifest.clientIndex = 'catalog-index.json';
manifest.detailBase = 'catalog-items/';
manifest.stableDetailBase = 'catalog-stable/';
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('TITLE_CHANGES=' + result.titleChanges);
console.log('COLLECTION_CHANGES=' + result.collectionChanges);
console.log('CONSERVATIVE_SYNTHETIC_AFTER=' + remaining.length);
console.log('GENERATED_MARKERS_AFTER=' + generatedMarkers.length);
console.log('UNRESTORED_SHORT_NAMES=' + unrestoredShortNames.length);

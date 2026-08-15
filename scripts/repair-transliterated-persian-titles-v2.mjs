import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { applyVerifiedPersianTitleOverrides, isLikelySyntheticPersianDisplayTitle } from './persian-title-overrides.mjs';
import { writeClientCatalogArtifacts } from './client-catalog.mjs';

const root = process.cwd();
const catalogPath = 'catalog.json';
const manifestPath = 'catalog-manifest.json';
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const titles = (catalog.items || []).filter((item) => item && ['movie', 'series'].includes(item.type));
const before = titles.filter(isLikelySyntheticPersianDisplayTitle);
console.log('TRANSLITERATION_LIKE_BEFORE=' + before.length);
if (before.length) {
  console.log(JSON.stringify(before.slice(0, 40).map((item) => ({
    id: item.id, name: item.name, nameFa: item.nameFa, source: item.nameFaSource, countryCodes: item.countryCodes,
  })), null, 2));
}

const result = applyVerifiedPersianTitleOverrides(catalog);
const after = titles.filter(isLikelySyntheticPersianDisplayTitle);
if (after.length) {
  console.log(JSON.stringify(after.slice(0, 40).map((item) => ({ id:item.id, name:item.name, nameFa:item.nameFa })), null, 2));
  throw new Error(after.length + ' transliteration-like Persian display titles remain after repair.');
}
const generatedMarkers = titles.filter((item) => item.nameFaGenerated === true || item.nameFaSource === 'generated-transliteration');
if (generatedMarkers.length) throw new Error(generatedMarkers.length + ' legacy generated-title markers remain.');

if (result.titleChanges || result.collectionChanges) catalog.updatedAt = new Date().toISOString();
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
console.log('TRANSLITERATION_LIKE_AFTER=' + after.length);
console.log('GENERATED_MARKERS_AFTER=' + generatedMarkers.length);

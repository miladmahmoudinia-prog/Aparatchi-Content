import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const items = Array.isArray(catalog?.items) ? catalog.items : [];

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const hasPersian = (value) => /[\u0600-\u06FF]/.test(clean(value));
const normalize = (value) => clean(value).toLowerCase().normalize('NFKC')
  .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const missingTitles = items
  .filter((item) => item && ['movie', 'series'].includes(item.type))
  .filter((item) => !hasPersian(item.nameFa))
  .map((item) => ({
    id: String(item.id || ''),
    type: item.type,
    year: item.year,
    nameFa: clean(item.nameFa),
    name: clean(item.name),
    ir: item.ir,
    countryCodes: item.countryCodes || [],
    collectionId: item.collectionId || null,
  }));

const collectionGroups = new Map();
for (const item of items) {
  if (!item?.collectionId) continue;
  const key = String(item.collectionId);
  if (!collectionGroups.has(key)) collectionGroups.set(key, []);
  collectionGroups.get(key).push(item);
}

const missingCollections = [];
for (const [collectionId, members] of collectionGroups) {
  const sample = members.find((item) => clean(item.collectionName)) || members[0];
  const collectionNameFa = clean(sample?.collectionNameFa);
  if (hasPersian(collectionNameFa)) continue;
  missingCollections.push({
    collectionId,
    collectionNameFa,
    collectionName: clean(sample?.collectionName),
    memberCount: members.length,
    members: members.slice(0, 4).map((item) => ({ id: item.id, nameFa: item.nameFa, name: item.name, year: item.year })),
  });
}

console.log(`CATALOG_ITEMS=${items.length}`);
console.log(`MISSING_PERSIAN_TITLES=${missingTitles.length}`);
console.log(`MISSING_PERSIAN_COLLECTIONS=${missingCollections.length}`);
console.log('--- TITLES ---');
console.log(JSON.stringify(missingTitles, null, 2));
console.log('--- COLLECTIONS ---');
console.log(JSON.stringify(missingCollections, null, 2));

if (missingTitles.length || missingCollections.length) {
  throw new Error(`${missingTitles.length} titles and ${missingCollections.length} collections still lack Persian display names.`);
}

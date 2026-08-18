import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const items = Array.isArray(catalog.items) ? catalog.items : [];
const hasPersian = (v) => /[\u0600-\u06FF]/.test(String(v || ''));
const hasLatin = (v) => /\p{Script=Latin}/u.test(String(v || ''));
const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
const key = (v) => clean(v).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const stripCollection = (v) => clean(v).replace(/^مجموعه\s+/u, '').trim();

const collectionMembers = items.filter((item) => item?.type === 'movie' && item?.collectionId);
const latinOwnTitleWithPersianCollection = collectionMembers.filter((item) => {
  const nameFa = clean(item.nameFa);
  return (!hasPersian(nameFa) || hasLatin(nameFa)) && hasPersian(item.collectionNameFa);
});
const persianCollectionLeaks = collectionMembers.filter((item) => {
  const title = stripCollection(item.nameFa);
  const collection = stripCollection(item.collectionNameFa);
  if (!title || !collection || !hasPersian(title)) return false;
  if (/^مجموعه\s+/u.test(clean(item.nameFa)) && !/\bcollection\b/i.test(clean(item.name))) return true;
  return key(title) === key(collection) && key(item.name) !== key(item.collectionName);
});

const groups = new Map();
for (const item of collectionMembers) {
  const id = String(item.collectionId);
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id).push(item);
}
const badFirstMembers = [];
for (const [id, members] of groups) {
  members.sort((a,b) => Number(a.collectionOrder || 0) - Number(b.collectionOrder || 0) || Number(a.year || 0) - Number(b.year || 0));
  const first = members[0];
  if (!hasPersian(first?.collectionNameFa) || !hasPersian(first?.nameFa) || hasLatin(first?.nameFa)) {
    badFirstMembers.push({ id, name: first?.name, nameFa: first?.nameFa, collectionName: first?.collectionName, collectionNameFa: first?.collectionNameFa });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  collectionMemberCount: collectionMembers.length,
  collectionGroupCount: groups.size,
  latinOwnTitleWithPersianCollectionCount: latinOwnTitleWithPersianCollection.length,
  persianCollectionLeakCount: persianCollectionLeaks.length,
  badFirstMemberCount: badFirstMembers.length,
  latinOwnTitleWithPersianCollection: latinOwnTitleWithPersianCollection.slice(0, 100).map(({id,name,nameFa,collectionName,collectionNameFa,collectionOrder}) => ({id,name,nameFa,collectionName,collectionNameFa,collectionOrder})),
  persianCollectionLeaks: persianCollectionLeaks.slice(0, 100).map(({id,name,nameFa,collectionName,collectionNameFa,collectionOrder}) => ({id,name,nameFa,collectionName,collectionNameFa,collectionOrder})),
  badFirstMembers: badFirstMembers.slice(0, 100),
};
await fs.writeFile('collection-title-v18-diagnostic.json', JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));

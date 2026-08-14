import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const cache = await readJson('persian-title-cache.json', { items: {} });
const items = Array.isArray(catalog?.items) ? catalog.items : [];
const cacheItems = cache?.items && typeof cache.items === 'object' ? cache.items : {};

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const hasPersian = (value) => /[\u0600-\u06FF]/.test(clean(value));
const normalize = (value) => clean(value)
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[\u064B-\u065F\u0670]/g, '')
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();
const normalizeImdb = (value) => String(value || '').match(/tt\d{6,12}/i)?.[0]?.toLowerCase() || '';
const isIranian = (item) => Boolean(
  item?.ir === true || item?.isIranian === true ||
  (item?.countryCodes || []).some((code) => String(code).toUpperCase() === 'IR') ||
  (item?.categoryKeys || []).some((key) => /^iranian-(?:movies|series)$/i.test(String(key)))
);
const cacheKey = (item) => String(item?.id || item?.slug || normalizeImdb(item?.imdb) || normalize(item?.name));
const needsTitle = (item) => !hasPersian(item?.nameFa) || normalize(item?.nameFa) === normalize(item?.name);
const freshHours = (value) => {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 3600000) : null;
};

const missing = items.filter((item) => item && ['movie', 'series'].includes(item.type) && needsTitle(item));
const groups = {
  iranian: missing.filter(isIranian),
  foreign: missing.filter((item) => !isIranian(item)),
  tmdb: missing.filter((item) => Number(item?.tmdb?.id || 0) > 0),
  imdb: missing.filter((item) => Boolean(normalizeImdb(item?.imdb))),
  noExternalId: missing.filter((item) => !Number(item?.tmdb?.id || 0) && !normalizeImdb(item?.imdb)),
};

let cacheRecord = 0;
let cachePersian = 0;
let cacheNoPersian = 0;
let cacheError = 0;
let cacheNoMatch = 0;
let cacheFreshNegative6h = 0;
let cacheFreshNegative72h = 0;
let topLevelPersianCandidate = 0;
const recoverableSourceSamples = [];
const negativeSamples = [];

for (const item of missing) {
  const record = cacheItems[cacheKey(item)];
  if (record) {
    cacheRecord += 1;
    if (hasPersian(record?.titleFa)) cachePersian += 1;
    else {
      cacheNoPersian += 1;
      const age = freshHours(record?.fetchedAt);
      if (age !== null && age <= 6) cacheFreshNegative6h += 1;
      if (age !== null && age <= 72) cacheFreshNegative72h += 1;
    }
    if (record?.error) cacheError += 1;
    if (!record?.tmdbId && !record?.titleFa && !record?.poster) cacheNoMatch += 1;
    if (!hasPersian(record?.titleFa) && negativeSamples.length < 30) {
      negativeSamples.push({
        id: item.id,
        type: item.type,
        year: item.year,
        name: item.name,
        nameFa: item.nameFa,
        iranian: isIranian(item),
        tmdb: item?.tmdb?.id || null,
        imdb: normalizeImdb(item?.imdb) || null,
        cache: {
          tmdbId: record?.tmdbId || null,
          error: record?.error || null,
          ageHours: freshHours(record?.fetchedAt),
        },
      });
    }
  }

  const candidates = Object.entries(item)
    .filter(([key, value]) => /(?:title|name|label|source)/i.test(key) && typeof value === 'string')
    .filter(([key]) => !/^nameFa$/i.test(key))
    .filter(([, value]) => hasPersian(value))
    .map(([key, value]) => [key, clean(value)]);
  if (candidates.length) {
    topLevelPersianCandidate += 1;
    if (recoverableSourceSamples.length < 40) {
      recoverableSourceSamples.push({ id: item.id, name: item.name, nameFa: item.nameFa, candidates });
    }
  }
}

const collectionGroups = new Map();
for (const item of items) {
  if (!item?.collectionId) continue;
  const key = String(item.collectionId);
  if (!collectionGroups.has(key)) collectionGroups.set(key, []);
  collectionGroups.get(key).push(item);
}

let missingCollections = 0;
let collectionsWithPersianMember = 0;
let collectionsWithFirstPersianMember = 0;
let collectionsAllMembersEnglish = 0;
const collectionSamples = [];
for (const [collectionId, members] of collectionGroups) {
  const sample = members.find((item) => clean(item?.collectionName)) || members[0];
  if (hasPersian(sample?.collectionNameFa)) continue;
  missingCollections += 1;
  const ordered = [...members].sort((a, b) => {
    const ao = Number(a?.collectionOrder || 0);
    const bo = Number(b?.collectionOrder || 0);
    if (ao > 0 && bo > 0 && ao !== bo) return ao - bo;
    if (Number(a?.year || 0) !== Number(b?.year || 0)) return Number(a?.year || 0) - Number(b?.year || 0);
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
  const persianMembers = ordered.filter((item) => hasPersian(item?.nameFa));
  if (persianMembers.length) collectionsWithPersianMember += 1;
  else collectionsAllMembersEnglish += 1;
  if (ordered[0] && hasPersian(ordered[0]?.nameFa)) collectionsWithFirstPersianMember += 1;
  if (collectionSamples.length < 50) {
    collectionSamples.push({
      collectionId,
      collectionName: clean(sample?.collectionName),
      collectionNameFa: clean(sample?.collectionNameFa),
      memberCount: members.length,
      first: ordered[0] ? { id: ordered[0].id, name: ordered[0].name, nameFa: ordered[0].nameFa, year: ordered[0].year, order: ordered[0].collectionOrder } : null,
      persianMemberCount: persianMembers.length,
    });
  }
}

const summary = {
  catalogItems: items.length,
  missingTitles: missing.length,
  missingIranianTitles: groups.iranian.length,
  missingForeignTitles: groups.foreign.length,
  missingWithTmdbId: groups.tmdb.length,
  missingWithImdbId: groups.imdb.length,
  missingWithoutExternalId: groups.noExternalId.length,
  cacheRecord,
  cachePersian,
  cacheNoPersian,
  cacheError,
  cacheNoMatch,
  cacheFreshNegative6h,
  cacheFreshNegative72h,
  topLevelPersianCandidate,
  missingCollections,
  collectionsWithPersianMember,
  collectionsWithFirstPersianMember,
  collectionsAllMembersEnglish,
};
console.log(JSON.stringify(summary, null, 2));
console.log('--- SOURCE-CANDIDATE SAMPLES ---');
console.log(JSON.stringify(recoverableSourceSamples, null, 2));
console.log('--- NEGATIVE-CACHE SAMPLES ---');
console.log(JSON.stringify(negativeSamples, null, 2));
console.log('--- COLLECTION SAMPLES ---');
console.log(JSON.stringify(collectionSamples, null, 2));

async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch { return fallback; }
}

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
const imdbId = (value) => String(value || '').match(/tt\d{6,12}/i)?.[0]?.toLowerCase() || '';
const cacheKey = (item) => String(item?.id || item?.slug || imdbId(item?.imdb) || normalize(item?.name));
const isIranian = (item) => Boolean(
  item?.ir === true || item?.isIranian === true ||
  (item?.countryCodes || []).some((code) => String(code).toUpperCase() === 'IR') ||
  (item?.categoryKeys || []).some((key) => /^iranian-(?:movies|series)$/i.test(String(key)))
);

const missing = items.filter((item) =>
  item && ['movie', 'series'].includes(item.type) && !hasPersian(item?.nameFa)
);

const byTmdb = new Map();
const bySignature = new Map();
for (const item of items) {
  const tmdb = Number(item?.tmdb?.id || 0);
  if (tmdb > 0) {
    const key = `${item.type}:${tmdb}`;
    if (!byTmdb.has(key)) byTmdb.set(key, []);
    byTmdb.get(key).push(item);
  }
  for (const name of new Set([normalize(item?.name), normalize(item?.nameFa)].filter(Boolean))) {
    const key = `${item.type}:${Number(item?.year || 0)}:${name}`;
    if (!bySignature.has(key)) bySignature.set(key, []);
    bySignature.get(key).push(item);
  }
}

let iranian = 0;
let foreign = 0;
let withTmdb = 0;
let withImdb = 0;
let withoutExternalId = 0;
let cacheRecord = 0;
let cacheHasPersian = 0;
let cacheNegative = 0;
let cacheError = 0;
let cacheMatchedTmdbNoPersian = 0;
let duplicatePersianByTmdb = 0;
let duplicatePersianByTitleYear = 0;
let sourceUrlCount = 0;
let operatorCount = 0;
const duplicateSamples = [];
const iranianSamples = [];
const cacheSamples = [];
const noIdSamples = [];

for (const item of missing) {
  const ir = isIranian(item);
  if (ir) iranian += 1; else foreign += 1;
  const tmdb = Number(item?.tmdb?.id || 0);
  const imdb = imdbId(item?.imdb);
  if (tmdb > 0) withTmdb += 1;
  if (imdb) withImdb += 1;
  if (!(tmdb > 0) && !imdb) withoutExternalId += 1;
  if (clean(item?.sourceUrl || item?.url || item?.sourcePage)) sourceUrlCount += 1;
  if (item?.operatorOnly || item?.operatorAccess || (item?.supportedOperators || []).length) operatorCount += 1;

  const cached = cacheItems[cacheKey(item)];
  if (cached) {
    cacheRecord += 1;
    if (hasPersian(cached?.titleFa)) cacheHasPersian += 1;
    else cacheNegative += 1;
    if (cached?.error) cacheError += 1;
    if (Number(cached?.tmdbId || 0) > 0 && !hasPersian(cached?.titleFa)) cacheMatchedTmdbNoPersian += 1;
    if (cacheSamples.length < 35) {
      cacheSamples.push({
        id: item.id, name: item.name, nameFa: item.nameFa, year: item.year, iranian: ir,
        tmdb: tmdb || null, imdb: imdb || null,
        cache: { tmdbId: cached?.tmdbId || null, titleFa: cached?.titleFa || '', error: cached?.error || null, fetchedAt: cached?.fetchedAt || null },
      });
    }
  }

  let twin = null;
  if (tmdb > 0) {
    twin = (byTmdb.get(`${item.type}:${tmdb}`) || []).find((candidate) => candidate !== item && hasPersian(candidate?.nameFa));
    if (twin) duplicatePersianByTmdb += 1;
  }
  if (!twin) {
    for (const name of new Set([normalize(item?.name), normalize(item?.nameFa)].filter(Boolean))) {
      const candidates = bySignature.get(`${item.type}:${Number(item?.year || 0)}:${name}`) || [];
      twin = candidates.find((candidate) => candidate !== item && hasPersian(candidate?.nameFa));
      if (twin) break;
    }
    if (twin) duplicatePersianByTitleYear += 1;
  }
  if (twin && duplicateSamples.length < 40) {
    duplicateSamples.push({ id: item.id, name: item.name, year: item.year, twinId: twin.id, twinNameFa: twin.nameFa });
  }
  if (ir && iranianSamples.length < 80) {
    iranianSamples.push({
      id: item.id, type: item.type, year: item.year, name: item.name, nameFa: item.nameFa,
      tmdb: tmdb || null, imdb: imdb || null, originalLanguage: item.originalLanguage || null,
      countryCodes: item.countryCodes || [], categoryKeys: item.categoryKeys || [],
    });
  }
  if (!(tmdb > 0) && !imdb && noIdSamples.length < 40) {
    noIdSamples.push({ id: item.id, type: item.type, year: item.year, name: item.name, nameFa: item.nameFa, iranian: ir });
  }
}

console.log(JSON.stringify({
  catalogItems: items.length,
  trueLatinDisplayTitles: missing.length,
  iranian,
  foreign,
  withTmdb,
  withImdb,
  withoutExternalId,
  cacheRecord,
  cacheHasPersian,
  cacheNegative,
  cacheError,
  cacheMatchedTmdbNoPersian,
  duplicatePersianByTmdb,
  duplicatePersianByTitleYear,
  sourceUrlCount,
  operatorCount,
}, null, 2));
console.log('--- DUPLICATE RECOVERY SAMPLES ---');
console.log(JSON.stringify(duplicateSamples, null, 2));
console.log('--- IRANIAN LATIN SAMPLES ---');
console.log(JSON.stringify(iranianSamples, null, 2));
console.log('--- CACHE SAMPLES ---');
console.log(JSON.stringify(cacheSamples, null, 2));
console.log('--- NO EXTERNAL ID SAMPLES ---');
console.log(JSON.stringify(noIdSamples, null, 2));

async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch { return fallback; }
}

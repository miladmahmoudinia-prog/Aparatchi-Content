import fs from 'node:fs/promises';
import path from 'node:path';
import { writeClientCatalogArtifacts } from './client-catalog.mjs';
import { createHash } from 'node:crypto';
import { applyVerifiedPersianTitleOverrides } from './persian-title-overrides.mjs';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const manifestPath = path.join(root, 'catalog-manifest.json');
const cachePath = path.join(root, 'persian-title-cache.json');
const token = String(process.env.TMDB_READ_ACCESS_TOKEN || '').trim();
const apiBase = String(process.env.TMDB_API_BASE || 'https://api.themoviedb.org/3').replace(/\/+$/, '');
const maxTitles = Math.max(1, Math.min(5000, positiveInt(process.env.PERSIAN_TITLE_MAX_TITLES_PER_RUN, 1200)));
const delayMs = Math.max(0, Math.min(2000, nonNegativeInt(process.env.PERSIAN_TITLE_REQUEST_DELAY_MS, 90)));
const cacheDays = Math.max(1, Math.min(180, positiveInt(process.env.PERSIAN_TITLE_CACHE_DAYS, 45)));
const negativeCacheHours = Math.max(1, Math.min(72, positiveInt(process.env.PERSIAN_TITLE_NEGATIVE_CACHE_HOURS, 6)));
const VERIFIED_PERSIAN_TITLE_OVERRIDES = new Map([
  ['dance with the jackals 4', 'رقص با شغال‌ها ۴'],
  ['the passage', 'گذرگاه'],
  ['the bloody hundredth', 'صدمین گروه خونین'],
  ['music by john williams', 'موسیقی از جان ویلیامز'],
  ["the devil's climb", 'صعود شیطان'],
  ['the lionheart', 'شیردل'],
  ['our father', 'پدر ما'],
  ['aunt nasrin and heavenly children', 'خاله نسرین و کودکان آسمانی'],
  ["aunt nasrin's songs for kids 4", 'ترانه‌های کودکانه خاله نسرین ۴'],
  ["aunt nasrin's songs for kids 5", 'ترانه‌های کودکانه خاله نسرین ۵'],
  ["aunt nasrin's songs for kids 7", 'ترانه‌های کودکانه خاله نسرین ۷'],
]);
const VERIFIED_PERSIAN_COLLECTION_OVERRIDES = new Map([
  ['dance with the jackals collection', 'مجموعه رقص با شغال‌ها'],
]);

if (!token) {
  console.log('TMDB token unavailable; Persian title repair skipped.');
  process.exit(0);
}

const catalog = await readJson(catalogPath, null);
if (!catalog || !Array.isArray(catalog.items)) {
  throw new Error('catalog.json پیدا نشد یا items معتبر نیست.');
}
const cache = await readJson(cachePath, { version: 1, items: {} });
if (!cache.items || typeof cache.items !== 'object' || Array.isArray(cache.items)) cache.items = {};
cache.version = 1;

let changed = false;
let considered = 0;
let processed = 0;
let titlesFilled = 0;
let postersFilled = 0;
let matched = 0;
let errors = 0;

for (const item of catalog.items) {
  const titleOverride = VERIFIED_PERSIAN_TITLE_OVERRIDES.get(normalizeTitle(item?.name));
  if (titleOverride && item.nameFa !== titleOverride) {
    item.nameFa = titleOverride;
    changed = true;
    titlesFilled += 1;
  }
  const collectionOverride = VERIFIED_PERSIAN_COLLECTION_OVERRIDES.get(normalizeTitle(item?.collectionName));
  if (collectionOverride && item.collectionNameFa !== collectionOverride) {
    item.collectionNameFa = collectionOverride;
    changed = true;
  }
}

const candidates = catalog.items
  .filter((item) => item && ['movie', 'series'].includes(item.type))
  .filter((item) => needsPersianTitle(item) || needsPersianCollection(item) || !isUsableArtwork(item.poster))
  .sort((a, b) => {
    const aMissingPoster = Number(!isUsableArtwork(a.poster));
    const bMissingPoster = Number(!isUsableArtwork(b.poster));
    if (aMissingPoster !== bMissingPoster) return bMissingPoster - aMissingPoster;
    const aMissingTitle = Number(needsPersianTitle(a));
    const bMissingTitle = Number(needsPersianTitle(b));
    if (aMissingTitle !== bMissingTitle) return bMissingTitle - aMissingTitle;
    return Number(b.year || 0) - Number(a.year || 0);
  });

for (const item of candidates) {
  considered += 1;
  const key = String(item.id || item.slug || normalizeImdbId(item.imdb) || normalizeTitle(item.name));
  const cached = cache.items[key];
  const cachedHasPersianTitle = containsPersian(cached?.titleFa);
  const cacheWindowDays = needsPersianTitle(item) && !cachedHasPersianTitle
    ? negativeCacheHours / 24
    : cacheDays;
  const freshCache = cached && isFresh(cached.fetchedAt, cacheWindowDays);

  if (freshCache) {
    const result = applyRepair(item, cached);
    if (result.changed) changed = true;
    titlesFilled += result.titleFilled;
    postersFilled += result.posterFilled;
    continue;
  }

  if (processed >= maxTitles) break;
  processed += 1;
  try {
    const metadata = await fetchPersianMetadata(item);
    if (metadata?.tmdbId) matched += 1;
    const record = {
      ...(metadata || {}),
      fetchedAt: new Date().toISOString(),
    };
    cache.items[key] = record;
    const result = applyRepair(item, record);
    if (result.changed) changed = true;
    titlesFilled += result.titleFilled;
    postersFilled += result.posterFilled;
  } catch (error) {
    errors += 1;
    cache.items[key] = {
      fetchedAt: new Date().toISOString(),
      error: cleanText(error instanceof Error ? error.message : String(error)).slice(0, 240),
    };
  }
}

const verifiedOverrideResult = applyVerifiedPersianTitleOverrides(catalog);
if (verifiedOverrideResult.titleChanges || verifiedOverrideResult.collectionChanges) {
  changed = true;
  titlesFilled += verifiedOverrideResult.titleChanges;
}

cache.updatedAt = new Date().toISOString();
if (changed) catalog.updatedAt = cache.updatedAt;
await Promise.all([
  writeCatalogAndManifest(catalog),
  fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8'),
]);

console.log(
  `Persian metadata repair: candidates=${candidates.length}, considered=${considered}, api=${processed}, ` +
  `matched=${matched}, titles=${titlesFilled}, posters=${postersFilled}, errors=${errors}.`,
);

function needsPersianTitle(item) {
  const value = cleanText(item?.nameFa);
  return !value || !containsPersian(value) || normalizeTitle(value) === normalizeTitle(item?.name);
}

function needsPersianCollection(item) {
  if (!item?.collectionId && !item?.collectionName) return false;
  const value = cleanText(item?.collectionNameFa);
  return !value || !containsPersian(value) || normalizeTitle(value) === normalizeTitle(item?.collectionName);
}

function applyRepair(item, metadata) {
  let didChange = false;
  let titleFilled = 0;
  let posterFilled = 0;
  const titleFa = cleanText(metadata?.titleFa);
  if (needsPersianTitle(item) && containsPersian(titleFa)) {
    item.nameFa = titleFa;
    titleFilled = 1;
    didChange = true;
  }
  const collectionNameFa = cleanText(metadata?.collectionNameFa);
  if (needsPersianCollection(item) && containsPersian(collectionNameFa)) {
    item.collectionNameFa = collectionNameFa;
    didChange = true;
  }
  const poster = cleanText(metadata?.poster);
  if (!isUsableArtwork(item.poster) && isUsableArtwork(poster)) {
    item.poster = poster;
    item.posterFallback = poster;
    posterFilled = 1;
    didChange = true;
  } else if (isUsableArtwork(poster) && !isUsableArtwork(item.posterFallback)) {
    item.posterFallback = poster;
    didChange = true;
  }
  return { changed: didChange, titleFilled, posterFilled };
}

async function fetchPersianMetadata(item) {
  const mediaType = item.type === 'series' ? 'tv' : 'movie';
  let candidate = null;
  const existingTmdbId = positiveInt(item?.tmdb?.id, 0);
  if (existingTmdbId > 0) {
    candidate = { id: existingTmdbId, media_type: mediaType };
  }

  const imdb = normalizeImdbId(item.imdb);
  if (!candidate && imdb) {
    const payload = await tmdbJson(`/find/${encodeURIComponent(imdb)}?external_source=imdb_id&language=fa-IR`);
    const list = mediaType === 'tv' ? payload?.tv_results : payload?.movie_results;
    const value = Array.isArray(list) ? list[0] : null;
    if (value?.id) candidate = { ...value, media_type: mediaType };
  }

  if (!candidate) {
    const query = cleanText(item.name || item.nameFa);
    if (!query) return {};
    const yearParam = mediaType === 'tv' ? 'first_air_date_year' : 'year';
    const year = positiveInt(item.year, 0);
    const payload = await tmdbJson(
      `/search/${mediaType}?language=fa-IR&include_adult=false&query=${encodeURIComponent(query)}` +
      (year > 0 ? `&${yearParam}=${year}` : ''),
    );
    const results = Array.isArray(payload?.results) ? payload.results : [];
    candidate = results.find((entry) => entry?.id) || null;
  }
  if (!candidate?.id) return {};

  const details = await tmdbJson(`/${mediaType}/${candidate.id}?language=fa-IR`);
  const localized = cleanText(details?.title || details?.name || candidate?.title || candidate?.name);
  let titleFa = containsPersian(localized) ? localized : '';
  let posterPath = cleanText(details?.poster_path || candidate?.poster_path);
  let collectionNameFa = '';
  const collectionId = positiveInt(details?.belongs_to_collection?.id || item?.collectionId, 0);
  if (collectionId > 0) {
    try {
      const collection = await tmdbJson(`/collection/${collectionId}?language=fa-IR`);
      const localizedCollection = cleanText(collection?.name);
      if (containsPersian(localizedCollection)) collectionNameFa = localizedCollection;
    } catch {
      // Collection translation is an enhancement; title repair must continue.
    }
  }

  if (!titleFa) {
    try {
      const translations = await tmdbJson(`/${mediaType}/${candidate.id}/translations`);
      const values = Array.isArray(translations?.translations) ? translations.translations : [];
      const fa = values.find((entry) => String(entry?.iso_639_1 || '').toLowerCase() === 'fa');
      const translated = cleanText(fa?.data?.title || fa?.data?.name);
      if (containsPersian(translated)) titleFa = translated;
    } catch {
      // Keep poster/details even if translations endpoint is unavailable.
    }
  }

  if (!titleFa) {
    try {
      const alternatives = await tmdbJson(`/${mediaType}/${candidate.id}/alternative_titles`);
      const values = [
        ...(Array.isArray(alternatives?.titles) ? alternatives.titles : []),
        ...(Array.isArray(alternatives?.results) ? alternatives.results : []),
      ];
      const iranian = values.find((entry) =>
        String(entry?.iso_3166_1 || '').toUpperCase() === 'IR' && containsPersian(entry?.title || entry?.name),
      );
      const anyPersian = values.find((entry) => containsPersian(entry?.title || entry?.name));
      const chosen = iranian || anyPersian;
      const alternative = cleanText(chosen?.title || chosen?.name);
      if (containsPersian(alternative)) titleFa = alternative;
    } catch {
      // Missing alternative-title metadata is not fatal.
    }
  }

  return {
    tmdbId: Number(candidate.id),
    ...(titleFa ? { titleFa } : {}),
    ...(collectionNameFa ? { collectionNameFa } : {}),
    ...(posterPath ? { poster: `https://image.tmdb.org/t/p/w500/${posterPath.replace(/^\/+/, '')}` } : {}),
  };
}

async function tmdbJson(pathname) {
  if (delayMs > 0) await sleep(delayMs);
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`);
  return response.json();
}

function isUsableArtwork(value) {
  const text = cleanText(value);
  if (!text || /example\.com|replace-with|placeholder/i.test(text)) return false;
  return /^https?:\/\//i.test(text) || /^(?:\.\/)?assets\/media\//i.test(text);
}

function containsPersian(value) {
  return /[\u0600-\u06FF]/.test(cleanText(value));
}

function normalizeTitle(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeImdbId(value) {
  const match = String(value || '').match(/tt\d{6,12}/i);
  return match ? match[0].toLowerCase() : '';
}

function isFresh(value, days) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) && Date.now() - timestamp < days * 86400000;
}

async function writeCatalogAndManifest(value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const clientArtifacts = await writeClientCatalogArtifacts(root, value);
  const manifest = {
    schemaVersion: 2,
    revision: createHash('sha256').update(serialized).digest('hex'),
    clientRevision: clientArtifacts.clientRevision,
    catalogVersion: cleanText(value?.version),
    catalogUpdatedAt: cleanText(value?.updatedAt),
    sizeBytes: Buffer.byteLength(serialized),
    clientSizeBytes: clientArtifacts.clientSizeBytes,
    clientIndex: 'catalog-index.json',
    detailBase: 'catalog-items/',
  };
  await Promise.all([
    fs.writeFile(catalogPath, serialized, 'utf8'),
    fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
  ]);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function positiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

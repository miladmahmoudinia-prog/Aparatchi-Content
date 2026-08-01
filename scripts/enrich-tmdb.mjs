import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const cachePath = path.join(root, 'tmdb-cache.json');
const reportPath = path.join(root, 'tmdb-enrichment-report.json');

const token = String(process.env.TMDB_READ_ACCESS_TOKEN || '').trim();
const apiBase = String(process.env.TMDB_API_BASE || 'https://api.themoviedb.org/3').replace(/\/+$/, '');
const requestDelayMs = positiveInt(process.env.TMDB_REQUEST_DELAY_MS, 280);
const maxTitlesPerRun = positiveInt(process.env.TMDB_MAX_TITLES_PER_RUN, 1200);
const refreshDays = positiveInt(process.env.TMDB_REFRESH_DAYS, 30);
const maxActors = positiveInt(process.env.TMDB_MAX_ACTORS, 18);
const maxDirectors = positiveInt(process.env.TMDB_MAX_DIRECTORS, 4);

const DAY_IDS_BY_JS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_SORT_ORDER = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const SCHEDULE_OVERRIDES = [
  { pattern: /(^|\s)بدنام($|\s)/i, day: 'friday' },
];


const COUNTRY_LABELS_FA = {
  IR: 'ایران', KR: 'کره جنوبی', IN: 'هند', JP: 'ژاپن', TR: 'ترکیه',
  US: 'آمریکا', GB: 'بریتانیا', CN: 'چین', HK: 'هنگ‌کنگ', FR: 'فرانسه',
  DE: 'آلمان', ES: 'اسپانیا', IT: 'ایتالیا', CA: 'کانادا', AU: 'استرالیا', RU: 'روسیه',
};

const COUNTRY_NAMES_EN = {
  IR: 'Iran', KR: 'South Korea', IN: 'India', JP: 'Japan', TR: 'Turkey',
  US: 'United States', GB: 'United Kingdom', CN: 'China', HK: 'Hong Kong', FR: 'France',
  DE: 'Germany', ES: 'Spain', IT: 'Italy', CA: 'Canada', AU: 'Australia', RU: 'Russia',
};


if (!token) {
  throw new Error('GitHub Secret با نام TMDB_READ_ACCESS_TOKEN در دسترس Workflow نیست.');
}

const catalog = await readJson(catalogPath, null);
if (!catalog || !Array.isArray(catalog.items)) {
  throw new Error('catalog.json پیدا نشد یا ساختار items معتبر نیست.');
}

const cache = await readJson(cachePath, {
  version: 7,
  updatedAt: null,
  items: {},
});
if (Number(cache.version || 0) !== 7 || !cache.items || typeof cache.items !== 'object' || Array.isArray(cache.items)) {
  cache.items = {};
}
cache.version = 7;

const report = {
  startedAt: new Date().toISOString(),
  totalTitles: catalog.items.length,
  considered: 0,
  apiProcessed: 0,
  cacheApplied: 0,
  enrichedTitles: 0,
  enrichedPeople: 0,
  classificationUpdated: 0,
  weeklyScheduleEntries: 0,
  skippedAlreadyComplete: 0,
  iranianMatched: 0,
  titleSearchMatched: 0,
  skippedNoMatch: 0,
  skippedLimit: 0,
  errors: [],
};

let lastRequestAt = 0;
let apiTitlesUsed = 0;
let catalogChanged = false;

for (const item of catalog.items) {
  if (!item || typeof item !== 'object') continue;
  report.considered += 1;

  const localClassificationChanged = applyLocalClassification(item);
  if (localClassificationChanged) {
    catalogChanged = true;
    report.classificationUpdated += 1;
  }

  const signature = itemSignature(item);
  const cacheKey = String(item.id || item.slug || signature);
  const cached = cache.items[cacheKey];

  if (cached && cached.signature === signature && !isCacheStale(cached.fetchedAt, refreshDays)) {
    report.cacheApplied += 1;

    if (cached.tmdb === null) {
      const sanitized = sanitizeInvalidTmdbData(item);
      if (sanitized) {
        catalogChanged = true;
        report.classificationUpdated += 1;
      }
      continue;
    }

    if (Array.isArray(cached.people) && cached.metadata) {
      const localPeople = removeTmdbPeople(item.people);
      const merged = mergeTmdbPeople(localPeople, cached.people);
      const peopleChanged = !deepEqualPeople(item.people, merged);
      const metadataChanged = applyTmdbMetadata(item, cached.metadata);
      const nextTmdb = compactTmdbRef(cached.tmdb);
      const tmdbChanged = JSON.stringify(item.tmdb || null) !== JSON.stringify(nextTmdb || null);
      if (peopleChanged || metadataChanged || tmdbChanged) {
        if (peopleChanged) item.people = merged;
        item.tmdb = nextTmdb;
        item.tmdbEnrichedAt = cached.fetchedAt;
        item.tmdbValidationVersion = 2;
        catalogChanged = true;
        report.enrichedTitles += 1;
        if (peopleChanged) report.enrichedPeople += merged.filter((person) => person?.image).length;
        if (metadataChanged) report.classificationUpdated += 1;
      }
      if (hasCompleteTmdbMetadata(item)) continue;
    }
  }

  if (
    hasCompleteTmdbPeople(item.people) &&
    hasCompleteTmdbMetadata(item) &&
    Number(item.tmdbValidationVersion || 0) >= 2
  ) {
    report.skippedAlreadyComplete += 1;
    continue;
  }

  if (apiTitlesUsed >= maxTitlesPerRun) {
    report.skippedLimit += 1;
    continue;
  }

  apiTitlesUsed += 1;
  report.apiProcessed += 1;

  try {
    let match = await resolveTmdbTitle(item);
    let details = match ? await fetchTitleDetails(match.mediaType, match.id) : null;

    if (match && details && !isTmdbDetailsCompatible(item, details, match.mediaType)) {
      match = await resolveTmdbTitle(item, { ignoreImdb: true });
      details = match ? await fetchTitleDetails(match.mediaType, match.id) : null;
    }

    if (!match || !details || !isTmdbDetailsCompatible(item, details, match.mediaType)) {
      report.skippedNoMatch += 1;
      const sanitized = sanitizeInvalidTmdbData(item);
      if (sanitized) {
        catalogChanged = true;
        report.classificationUpdated += 1;
      }
      cache.items[cacheKey] = {
        signature,
        fetchedAt: new Date().toISOString(),
        tmdb: null,
        people: [],
        metadata: null,
      };
      continue;
    }

    if (isIranianCatalogItem(item)) report.iranianMatched += 1;
    if (match.source.startsWith('title-search')) report.titleSearchMatched += 1;

    const tmdbPeople = buildTmdbPeople(details, match.mediaType);
    const metadata = buildTmdbMetadata(details, match.mediaType, item);
    const localPeople = removeTmdbPeople(item.people);
    const merged = mergeTmdbPeople(localPeople, tmdbPeople);
    const peopleChanged = !deepEqualPeople(item.people, merged);
    const metadataChanged = applyTmdbMetadata(item, metadata);

    cache.items[cacheKey] = {
      signature,
      fetchedAt: new Date().toISOString(),
      tmdb: {
        id: match.id,
        mediaType: match.mediaType,
        source: match.source,
      },
      people: tmdbPeople,
      metadata,
    };

    const nextTmdb = compactTmdbRef(cache.items[cacheKey].tmdb);
    const tmdbChanged = JSON.stringify(item.tmdb || null) !== JSON.stringify(nextTmdb || null);
    if (peopleChanged || metadataChanged || tmdbChanged) {
      if (peopleChanged) item.people = merged;
      item.tmdb = nextTmdb;
      item.tmdbEnrichedAt = cache.items[cacheKey].fetchedAt;
      item.tmdbValidationVersion = 2;
      catalogChanged = true;
      report.enrichedTitles += 1;
      if (peopleChanged) report.enrichedPeople += merged.filter((person) => person?.image).length;
      if (metadataChanged) report.classificationUpdated += 1;
    }
  } catch (error) {
    report.errors.push({
      id: String(item.id || item.slug || ''),
      title: cleanText(item.nameFa || item.name),
      message: error instanceof Error ? error.message : String(error),
    });
    if (report.errors.length > 100) report.errors.length = 100;
  }
}

const rebuiltWeeklySchedule = buildWeeklySchedule(catalog.items, catalog.weeklySchedule);
report.weeklyScheduleEntries = rebuiltWeeklySchedule.length;
if (JSON.stringify(Array.isArray(catalog.weeklySchedule) ? catalog.weeklySchedule : []) !== JSON.stringify(rebuiltWeeklySchedule)) {
  catalog.weeklySchedule = rebuiltWeeklySchedule;
  catalogChanged = true;
}

if (catalogChanged) {
  catalog.updatedAt = new Date().toISOString();
  catalog.tmdbEnrichedAt = catalog.updatedAt;
}

cache.updatedAt = new Date().toISOString();
report.finishedAt = new Date().toISOString();
report.changed = catalogChanged;
report.apiTitlesUsed = apiTitlesUsed;

await writeJson(cachePath, cache);
await writeJson(reportPath, report);
if (catalogChanged) await writeJson(catalogPath, catalog);

console.log(`TMDB: ${report.enrichedTitles} عنوان، ${report.enrichedPeople} تصویر و ${report.classificationUpdated} دسته‌بندی کشور/انیمه به‌روزرسانی شد.`);
console.log(`TMDB: ${report.cacheApplied} مورد از کش، ${report.apiProcessed} مورد از API، ${report.skippedNoMatch} مورد بدون تطبیق.`);
if (report.errors.length) {
  console.warn(`TMDB: ${report.errors.length} خطا ثبت شد؛ جزئیات در tmdb-enrichment-report.json است.`);
}

async function resolveTmdbTitle(item, options = {}) {
  const expectedType = item.type === 'series' ? 'tv' : 'movie';

  const imdbId = normalizeImdbId(item.imdb || item.imdbId || item.imdb_id);
  if (imdbId && options.ignoreImdb !== true) {
    const found = await tmdbGet(`/find/${encodeURIComponent(imdbId)}`, {
      external_source: 'imdb_id',
      language: 'en-US',
    });
    const expectedResults = expectedType === 'tv' ? found?.tv_results : found?.movie_results;
    const alternateResults = expectedType === 'tv' ? found?.movie_results : found?.tv_results;
    const exact = firstValidResult(expectedResults);
    if (exact) return { id: exact.id, mediaType: expectedType, source: 'imdb' };
    const alternate = firstValidResult(alternateResults);
    if (alternate) {
      return {
        id: alternate.id,
        mediaType: expectedType === 'tv' ? 'movie' : 'tv',
        source: 'imdb-alternate',
      };
    }
  }

  const year = positiveInt(item.year, 0);
  const titleCandidates = uniqueTexts([
    item.name,
    item.originalName,
    item.original_name,
    item.nameFa,
    item.title,
    item.titleFa,
  ]);

  for (const title of titleCandidates) {
    const searches = [
      year ? { withYear: true, source: 'title-search-year' } : null,
      { withYear: false, source: 'title-search' },
    ].filter(Boolean);

    for (const searchPlan of searches) {
      const params = {
        query: title,
        include_adult: 'false',
        language: 'en-US',
        page: '1',
        ...(searchPlan.withYear && year
          ? expectedType === 'tv'
            ? { first_air_date_year: String(year) }
            : { year: String(year) }
          : {}),
      };
      const search = await tmdbGet(`/search/${expectedType}`, params);
      const best = chooseSearchResult(search?.results, title, year, expectedType, item);
      if (best) return { id: best.id, mediaType: expectedType, source: searchPlan.source };
    }
  }

  return null;
}

async function fetchTitleDetails(mediaType, id) {
  if (mediaType === 'tv') {
    return tmdbGet(`/tv/${id}`, {
      language: 'en-US',
      append_to_response: 'aggregate_credits,keywords',
    });
  }
  return tmdbGet(`/movie/${id}`, {
    language: 'en-US',
    append_to_response: 'credits,keywords',
  });
}

function normalizeCountryCode(value) {
  const code = cleanText(value).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

function buildTmdbMetadata(details, mediaType, item) {
  const productionCountries = Array.isArray(details?.production_countries)
    ? details.production_countries
    : [];
  const originCountry = mediaType === 'tv' && Array.isArray(details?.origin_country)
    ? details.origin_country
    : [];
  const countryCodes = [...new Set([
    ...productionCountries.map((country) => normalizeCountryCode(country?.iso_3166_1)),
    ...originCountry.map(normalizeCountryCode),
  ].filter(Boolean))];
  const namesByCode = new Map(
    productionCountries
      .map((country) => [normalizeCountryCode(country?.iso_3166_1), cleanText(country?.name)])
      .filter(([code]) => Boolean(code)),
  );
  const originalLanguage = cleanText(details?.original_language || item?.originalLanguage).toLowerCase();
  const tmdbGenres = Array.isArray(details?.genres) ? details.genres : [];
  const isAnimation = Boolean(
    item?.isAnimation ||
    tmdbGenres.some((genre) => Number(genre?.id) === 16 || /animation|anime/i.test(cleanText(genre?.name))),
  );
  const keywordEntries = Array.isArray(details?.keywords?.keywords)
    ? details.keywords.keywords
    : Array.isArray(details?.keywords?.results)
      ? details.keywords.results
      : [];
  const keywordText = keywordEntries.map((entry) => cleanText(entry?.name)).join(' ');
  const titleText = [
    cleanText(details?.original_title || details?.original_name),
    cleanText(details?.title || details?.name),
    cleanText(item?.name),
    cleanText(item?.nameFa),
  ].join(' ');
  const animeKeyword = /(?:^|\b)(?:anime|manga|based on manga|shounen|shōnen|japanese animation)(?:\b|$)/i.test(keywordText);
  const knownAnimeTitle = /(?:jujutsu\s*kaisen|demon\s*slayer|kimetsu|attack\s*on\s*titan|one\s*piece|naruto|bleach|my\s*hero\s*academia|chainsaw\s*man|spy\s*[x×]\s*family|solo\s*leveling)/i.test(titleText);
  const hasJapaneseScript = /[\u3040-\u30ff\u31f0-\u31ff]/.test(titleText);
  const isAnime = Boolean(
    isAnimation && (
      countryCodes.includes('JP') ||
      originalLanguage === 'ja' ||
      animeKeyword ||
      knownAnimeTitle ||
      hasJapaneseScript
    ),
  );
  const isDocumentary = Boolean(
    item?.isDocumentary ||
    tmdbGenres.some((genre) => Number(genre?.id) === 99 || /documentary|مستند/i.test(cleanText(genre?.name))) ||
    /(?:^|\s)(?:documentary|مستند)(?:\s|$)/i.test([
      ...(Array.isArray(item?.genres) ? item.genres : []),
      ...(Array.isArray(item?.categoryLabels) ? item.categoryLabels : []),
      cleanText(item?.contentKind),
    ].join(' ')) ||
    /(?:^|\s)مرد\s+ابدی(?:\s|$)/i.test(cleanText(item?.nameFa)),
  );

  const nextEpisode = mediaType === 'tv' && details?.next_episode_to_air && typeof details.next_episode_to_air === 'object'
    ? details.next_episode_to_air
    : null;
  const lastEpisode = mediaType === 'tv' && details?.last_episode_to_air && typeof details.last_episode_to_air === 'object'
    ? details.last_episode_to_air
    : null;
  const status = cleanText(details?.status).toLowerCase();
  const isAiring = mediaType === 'tv' && Boolean(
    nextEpisode || details?.in_production === true || /returning|planned|pilot|in production/.test(status),
  );
  const nextEpisodeAirDate = cleanText(nextEpisode?.air_date);
  const fallbackAirDate = isAiring
    ? cleanText(lastEpisode?.air_date || details?.last_air_date || details?.first_air_date)
    : '';
  const scheduleDate = nextEpisodeAirDate || fallbackAirDate;
  const scheduleDay = dayIdFromDate(scheduleDate);
  const nextEpisodeNumber = positiveInt(nextEpisode?.episode_number, 0);

  return {
    countryCodes,
    countryLabels: countryCodes.map((code) => COUNTRY_LABELS_FA[code] || namesByCode.get(code) || code),
    countryNames: countryCodes.map((code) => namesByCode.get(code) || COUNTRY_NAMES_EN[code] || code),
    originalLanguage,
    isAnimation,
    isAnime,
    isDocumentary,
    validationVersion: 2,
    ...(mediaType === 'tv' ? {
      isAiring,
      airDays: scheduleDay ? [scheduleDay] : [],
      ...(nextEpisodeAirDate ? { nextEpisodeAirDate } : {}),
      ...(nextEpisodeNumber > 0 ? { nextEpisodeNumber } : {}),
    } : {}),
  };
}

function applyTmdbMetadata(item, metadataValue) {
  const metadata = metadataValue && typeof metadataValue === 'object' ? metadataValue : {};
  const countryCodes = Array.isArray(metadata.countryCodes)
    ? [...new Set(metadata.countryCodes.map(normalizeCountryCode).filter(Boolean))]
    : [];
  const originalLanguage = cleanText(metadata.originalLanguage || item.originalLanguage).toLowerCase();
  const inferredCountry = originalLanguage === 'fa'
    ? 'IR'
    : originalLanguage === 'ko'
      ? 'KR'
      : originalLanguage === 'hi'
        ? 'IN'
        : originalLanguage === 'ja'
          ? 'JP'
          : '';
  const effectiveCodes = [...new Set([
    ...(countryCodes.length
      ? countryCodes
      : Array.isArray(item.countryCodes) ? item.countryCodes.map(normalizeCountryCode).filter(Boolean) : []),
    inferredCountry,
  ].filter(Boolean))];
  const isAnimation = Boolean(metadata.isAnimation || item.isAnimation);
  const isAnime = Boolean(isAnimation && (
    metadata.isAnime ||
    effectiveCodes.includes('JP') ||
    originalLanguage === 'ja'
  ));
  const isDocumentary = Boolean(
    metadata.isDocumentary ||
    item.isDocumentary ||
    item.contentKind === 'documentary' ||
    (Array.isArray(item.genres) && item.genres.some((genre) => /مستند|documentary/i.test(cleanText(genre)))) ||
    /(?:^|\s)مرد\s+ابدی(?:\s|$)/i.test(cleanText(item.nameFa)),
  );
  const before = JSON.stringify({
    countryCodes: item.countryCodes,
    countryLabels: item.countryLabels,
    countryNames: item.countryNames,
    originalLanguage: item.originalLanguage,
    isAnimation: item.isAnimation,
    isAnime: item.isAnime,
    isDocumentary: item.isDocumentary,
    categoryKeys: item.categoryKeys,
    categoryLabels: item.categoryLabels,
    contentKind: item.contentKind,
    ir: item.ir,
    airDays: item.airDays,
    nextEpisodeAirDate: item.nextEpisodeAirDate,
    nextEpisodeNumber: item.nextEpisodeNumber,
    isAiring: item.isAiring,
  });

  if (effectiveCodes.length) {
    item.countryCodes = effectiveCodes;
    item.countryLabels = effectiveCodes.map((code, index) =>
      cleanText(metadata.countryLabels?.[index]) || COUNTRY_LABELS_FA[code] || code,
    );
    item.countryNames = effectiveCodes.map((code, index) =>
      cleanText(metadata.countryNames?.[index]) || COUNTRY_NAMES_EN[code] || code,
    );
  }
  if (originalLanguage) item.originalLanguage = originalLanguage;
  item.ir = effectiveCodes.includes('IR') || item.ir === true;
  item.isAnimation = isAnimation;
  item.isAnime = isAnime;
  item.isDocumentary = isDocumentary;
  item.tmdbValidationVersion = Math.max(
    Number(item.tmdbValidationVersion || 0),
    Number(metadata.validationVersion || 0),
  );

  const type = item.type === 'series' ? 'series' : 'movie';
  if (type === 'series') {
    const metadataAirDays = Array.isArray(metadata.airDays)
      ? [...new Set(metadata.airDays.map(normalizeDayId).filter(Boolean))]
      : [];
    if (metadataAirDays.length) item.airDays = metadataAirDays;
    const nextEpisodeAirDate = cleanText(metadata.nextEpisodeAirDate);
    if (nextEpisodeAirDate) item.nextEpisodeAirDate = nextEpisodeAirDate;
    else if (metadata.isAiring === false) delete item.nextEpisodeAirDate;
    const nextEpisodeNumber = positiveInt(metadata.nextEpisodeNumber, 0);
    if (nextEpisodeNumber > 0) item.nextEpisodeNumber = nextEpisodeNumber;
    else if (metadata.isAiring === false) delete item.nextEpisodeNumber;
    if (typeof metadata.isAiring === 'boolean') item.isAiring = metadata.isAiring;
  }

  const removedKeys = new Set([
    'korean-movies', 'korean-series', 'indian-movies', 'japanese-movies',
    'anime-movies', 'anime-series', 'animation-movies', 'animation-series',
    'documentaries',
  ]);
  const categoryKeys = (Array.isArray(item.categoryKeys) ? item.categoryKeys : [])
    .map(cleanText)
    .filter((key) => key && !removedKeys.has(key));
  if (type === 'movie' && effectiveCodes.includes('KR')) categoryKeys.push('korean-movies');
  if (type === 'series' && effectiveCodes.includes('KR')) categoryKeys.push('korean-series');
  if (type === 'movie' && effectiveCodes.includes('IN')) categoryKeys.push('indian-movies');
  if (type === 'movie' && effectiveCodes.includes('JP')) categoryKeys.push('japanese-movies');
  if (isAnimation) categoryKeys.push(isAnime
    ? type === 'movie' ? 'anime-movies' : 'anime-series'
    : type === 'movie' ? 'animation-movies' : 'animation-series');
  if (isDocumentary) categoryKeys.push('documentaries');
  item.categoryKeys = [...new Set(categoryKeys)];

  const classificationLabels = /^(فیلم (کره‌ای|هندی|ژاپنی)|سریال کره‌ای|انیمه (سینمایی|سریالی)|انیمیشن (سینمایی|سریالی)|مستند)$/;
  const categoryLabels = (Array.isArray(item.categoryLabels) ? item.categoryLabels : [])
    .map(cleanText)
    .filter((label) => label && !classificationLabels.test(label));
  if (type === 'movie' && effectiveCodes.includes('KR')) categoryLabels.push('فیلم کره‌ای');
  if (type === 'series' && effectiveCodes.includes('KR')) categoryLabels.push('سریال کره‌ای');
  if (type === 'movie' && effectiveCodes.includes('IN')) categoryLabels.push('فیلم هندی');
  if (type === 'movie' && effectiveCodes.includes('JP')) categoryLabels.push('فیلم ژاپنی');
  if (isAnimation) categoryLabels.push(isAnime
    ? type === 'movie' ? 'انیمه سینمایی' : 'انیمه سریالی'
    : type === 'movie' ? 'انیمیشن سینمایی' : 'انیمیشن سریالی');
  if (isDocumentary) categoryLabels.push('مستند');
  item.categoryLabels = [...new Set(categoryLabels)];

  if (isDocumentary) item.contentKind = 'documentary';
  else if (isAnime) item.contentKind = type === 'movie' ? 'anime-movie' : 'anime-series';
  else if (isAnimation) item.contentKind = type === 'movie' ? 'animation-movie' : 'animation-series';

  const languageTagsChanged = normalizeIranianLanguageTags(item);

  const after = JSON.stringify({
    countryCodes: item.countryCodes,
    countryLabels: item.countryLabels,
    countryNames: item.countryNames,
    originalLanguage: item.originalLanguage,
    isAnimation: item.isAnimation,
    isAnime: item.isAnime,
    isDocumentary: item.isDocumentary,
    categoryKeys: item.categoryKeys,
    categoryLabels: item.categoryLabels,
    contentKind: item.contentKind,
    ir: item.ir,
    airDays: item.airDays,
    nextEpisodeAirDate: item.nextEpisodeAirDate,
    nextEpisodeNumber: item.nextEpisodeNumber,
    isAiring: item.isAiring,
  });
  return before !== after || languageTagsChanged;
}

function hasCompleteTmdbMetadata(item) {
  const codes = Array.isArray(item?.countryCodes) ? item.countryCodes.filter(Boolean) : [];
  const originalLanguage = cleanText(item?.originalLanguage);
  if (!codes.length && !originalLanguage) return false;
  if (Number(item?.tmdbValidationVersion || 0) < 2) return false;
  if (item?.isAnimation && typeof item?.isAnime !== 'boolean') return false;
  if (typeof item?.isDocumentary !== 'boolean') return false;
  if (item?.type === 'series' && typeof item?.isAiring !== 'boolean') return false;
  return true;
}

function isIranianCatalogItem(item) {
  const labels = [
    ...(Array.isArray(item?.countryLabels) ? item.countryLabels : []),
    ...(Array.isArray(item?.countryNames) ? item.countryNames : []),
    ...(Array.isArray(item?.categoryLabels) ? item.categoryLabels : []),
    cleanText(item?.country),
  ].join(' ');
  return Boolean(
    item?.ir === true ||
    cleanText(item?.originalLanguage).toLowerCase() === 'fa' ||
    (Array.isArray(item?.countryCodes) && item.countryCodes.map(normalizeCountryCode).includes('IR')) ||
    /(?:^|\s)(?:ایران|iran)(?:\s|$)/i.test(labels),
  );
}

function localTitleText(item) {
  return [
    cleanText(item?.nameFa),
    cleanText(item?.name),
    cleanText(item?.originalName),
    ...(Array.isArray(item?.genres) ? item.genres : []),
    ...(Array.isArray(item?.categoryLabels) ? item.categoryLabels : []),
    ...(Array.isArray(item?.categoryKeys) ? item.categoryKeys : []),
    cleanText(item?.contentKind),
  ].join(' ');
}

function applyLocalClassification(item) {
  const text = localTitleText(item);
  const codes = Array.isArray(item?.countryCodes)
    ? item.countryCodes.map(normalizeCountryCode).filter(Boolean)
    : [];
  const originalLanguage = cleanText(item?.originalLanguage).toLowerCase();
  if (isIranianCatalogItem(item) && !codes.includes('IR')) codes.push('IR');
  if (originalLanguage === 'ko' && !codes.includes('KR')) codes.push('KR');
  if (originalLanguage === 'hi' && !codes.includes('IN')) codes.push('IN');
  if (originalLanguage === 'ja' && !codes.includes('JP')) codes.push('JP');

  const isAnimation = Boolean(
    item?.isAnimation ||
    /(?:انیمیشن|animation|anime|انیمه)/i.test(text),
  );
  const isAnime = Boolean(
    isAnimation && (
      item?.isAnime ||
      codes.includes('JP') ||
      originalLanguage === 'ja' ||
      /(?:انیمه|anime|jujutsu\s*kaisen|جوجوتسو|demon\s*slayer|kimetsu|شیطان\s*کش|attack\s*on\s*titan|one\s*piece|naruto|bleach|chainsaw\s*man|spy\s*[x×]\s*family|solo\s*leveling)/i.test(text) ||
      /[\u3040-\u30ff\u31f0-\u31ff]/.test(text)
    )
  );
  const isDocumentary = Boolean(
    item?.isDocumentary ||
    item?.contentKind === 'documentary' ||
    /(?:^|\s)(?:مستند|documentary)(?:\s|$)/i.test(text) ||
    /(?:^|\s)مرد\s+ابدی(?:\s|$)/i.test(cleanText(item?.nameFa)),
  );

  return applyTmdbMetadata(item, {
    countryCodes: codes,
    countryLabels: codes.map((code) => COUNTRY_LABELS_FA[code] || code),
    countryNames: codes.map((code) => COUNTRY_NAMES_EN[code] || code),
    originalLanguage,
    isAnimation,
    isAnime,
    isDocumentary,
  });
}

function normalizeIranianLanguageTags(item) {
  if (!isIranianCatalogItem(item)) return false;
  let changed = false;

  if (Array.isArray(item.availableLanguages)) {
    const next = item.availableLanguages.filter((language) => cleanText(language) !== 'dubbed');
    if (JSON.stringify(next) !== JSON.stringify(item.availableLanguages)) {
      item.availableLanguages = next;
      changed = true;
    }
  }

  if (Array.isArray(item.downloads)) {
    for (const section of item.downloads) {
      if (!section || typeof section !== 'object') continue;
      if (cleanText(section.language) === 'dubbed') {
        delete section.language;
        changed = true;
      }
      if (/دوبله/i.test(cleanText(section.badge))) {
        delete section.badge;
        changed = true;
      }
      if (Array.isArray(section.files)) {
        for (const file of section.files) {
          if (!file || typeof file !== 'object') continue;
          if (cleanText(file.language) === 'dubbed') {
            delete file.language;
            changed = true;
          }
          if (/دوبله/i.test(cleanText(file.label)) && !/زیرنویس/i.test(cleanText(file.label))) {
            file.label = cleanText(file.label).replace(/دوبله\s*(فارسی)?/gi, '').replace(/\s{2,}/g, ' ').trim();
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

function removeTmdbPeople(peopleValue) {
  return (Array.isArray(peopleValue) ? peopleValue : [])
    .filter((person) => cleanText(person?.source).toLowerCase() !== 'tmdb' && !/^tmdb-/i.test(cleanText(person?.id)));
}

function sanitizeInvalidTmdbData(item) {
  const before = JSON.stringify({
    people: item.people,
    tmdb: item.tmdb,
    tmdbEnrichedAt: item.tmdbEnrichedAt,
    countryCodes: item.countryCodes,
    countryLabels: item.countryLabels,
    countryNames: item.countryNames,
    originalLanguage: item.originalLanguage,
    categoryKeys: item.categoryKeys,
    categoryLabels: item.categoryLabels,
    contentKind: item.contentKind,
  });

  item.people = removeTmdbPeople(item.people);
  delete item.tmdb;
  delete item.tmdbEnrichedAt;

  if (isIranianCatalogItem(item)) {
    item.ir = true;
    item.countryCodes = ['IR'];
    item.countryLabels = ['ایران'];
    item.countryNames = ['Iran'];
    item.originalLanguage = 'fa';
  }

  applyLocalClassification(item);
  item.tmdbValidationVersion = 2;

  const after = JSON.stringify({
    people: item.people,
    tmdb: item.tmdb,
    tmdbEnrichedAt: item.tmdbEnrichedAt,
    countryCodes: item.countryCodes,
    countryLabels: item.countryLabels,
    countryNames: item.countryNames,
    originalLanguage: item.originalLanguage,
    categoryKeys: item.categoryKeys,
    categoryLabels: item.categoryLabels,
    contentKind: item.contentKind,
  });
  return before !== after;
}

function detailsCountryCodes(details, mediaType) {
  const production = Array.isArray(details?.production_countries)
    ? details.production_countries.map((country) => normalizeCountryCode(country?.iso_3166_1))
    : [];
  const origin = mediaType === 'tv' && Array.isArray(details?.origin_country)
    ? details.origin_country.map(normalizeCountryCode)
    : [];
  return [...new Set([...production, ...origin].filter(Boolean))];
}

function titleSimilarity(leftValue, rightValue) {
  const left = normalizeTitle(leftValue);
  const right = normalizeTitle(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.82;
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function isTmdbDetailsCompatible(item, details, mediaType) {
  if (!details || !positiveInt(details?.id, 0)) return false;
  const expectedType = item?.type === 'series' ? 'tv' : 'movie';
  if (mediaType !== expectedType) return false;

  const iranian = isIranianCatalogItem(item);
  const codes = detailsCountryCodes(details, mediaType);
  const originalLanguage = cleanText(details?.original_language).toLowerCase();
  if (iranian && originalLanguage !== 'fa' && !codes.includes('IR')) return false;

  const itemYear = positiveInt(item?.year, 0);
  const detailsDate = cleanText(
    mediaType === 'tv' ? details?.first_air_date : details?.release_date,
  );
  const detailsYear = positiveInt(detailsDate.slice(0, 4), 0);
  if (itemYear && detailsYear) {
    const maxDifference = iranian ? 2 : 3;
    if (Math.abs(itemYear - detailsYear) > maxDifference) return false;
  }

  const itemTitles = uniqueTexts([
    item?.name,
    item?.originalName,
    item?.original_name,
    item?.nameFa,
    item?.title,
    item?.titleFa,
  ]);
  const detailTitles = uniqueTexts([
    details?.title,
    details?.original_title,
    details?.name,
    details?.original_name,
  ]);
  const bestSimilarity = Math.max(
    0,
    ...itemTitles.flatMap((itemTitle) =>
      detailTitles.map((detailTitle) => titleSimilarity(itemTitle, detailTitle)),
    ),
  );

  if (iranian) {
    // Iranian titles are often absent from TMDB in Persian; matching country/language
    // and year is safer than accepting a foreign same-name result.
    return bestSimilarity >= 0.25 || (originalLanguage === 'fa' || codes.includes('IR'));
  }
  return bestSimilarity >= 0.45;
}

function normalizeDayId(value) {
  const day = cleanText(value).toLowerCase();
  return DAY_SORT_ORDER.includes(day) ? day : '';
}

function dayIdFromDate(value) {
  const timestamp = Date.parse(cleanText(value));
  if (!Number.isFinite(timestamp)) return '';
  return DAY_IDS_BY_JS[new Date(timestamp).getUTCDay()] || '';
}

function scheduleDayForItem(item) {
  const override = SCHEDULE_OVERRIDES.find(({ pattern }) => pattern.test(cleanText(item?.nameFa)));
  if (override) return override.day;
  const explicit = Array.isArray(item?.airDays)
    ? item.airDays.map(normalizeDayId).find(Boolean)
    : '';
  if (explicit) return explicit;
  const nextDay = dayIdFromDate(item?.nextEpisodeAirDate);
  if (nextDay) return nextDay;

  const recentValue = cleanText(
    item?.meaningfulUpdatedAt || item?.sourceUpdatedAt || item?.updatedAt || item?.sourceCreatedAt || item?.createdAt,
  );
  const recentTimestamp = Date.parse(recentValue);
  const recentlyUpdated = Number.isFinite(recentTimestamp) && Date.now() - recentTimestamp <= 45 * 24 * 60 * 60 * 1000;
  if (item?.isAiring === true || recentlyUpdated) return dayIdFromDate(recentValue);
  return '';
}

function buildWeeklySchedule(itemsValue, existingValue) {
  const items = Array.isArray(itemsValue) ? itemsValue : [];
  const generated = [];
  for (const item of items) {
    if (!item || item.type !== 'series') continue;
    const day = scheduleDayForItem(item);
    if (!day) continue;
    const updateValue = cleanText(
      item.nextEpisodeAirDate || item.meaningfulUpdatedAt || item.sourceUpdatedAt || item.updatedAt,
    );
    generated.push({
      id: `tmdb-schedule-${item.id}-${day}`,
      itemId: String(item.id),
      nameFa: cleanText(item.nameFa || item.name),
      poster: cleanText(item.poster),
      day,
      time: cleanText(item.airTime) || 'زمان نامشخص',
      ...(positiveInt(item.nextEpisodeNumber, 0) > 0 ? { episode: positiveInt(item.nextEpisodeNumber, 0) } : {}),
      region: item.ir === true || (Array.isArray(item.countryCodes) && item.countryCodes.includes('IR')) ? 'iranian' : 'foreign',
      sourceLabel: item.nextEpisodeAirDate ? 'TMDB next episode' : 'catalog update day',
      ...(updateValue ? { verifiedAt: updateValue } : {}),
    });
  }

  const merged = new Map();
  for (const entry of generated) merged.set(`${entry.itemId}:${entry.day}:${entry.region}`, entry);
  for (const entry of Array.isArray(existingValue) ? existingValue : []) {
    if (!entry || !entry.itemId || !normalizeDayId(entry.day)) continue;
    const generatedEntry = String(entry.id || '').startsWith('tmdb-schedule-') ||
      ['TMDB next episode', 'catalog update day'].includes(cleanText(entry.sourceLabel));
    if (generatedEntry) continue;
    const normalized = { ...entry, day: normalizeDayId(entry.day) };
    merged.set(`${normalized.itemId}:${normalized.day}:${normalized.region === 'foreign' ? 'foreign' : 'iranian'}`, normalized);
  }

  return [...merged.values()].sort((a, b) => {
    const dayDiff = DAY_SORT_ORDER.indexOf(a.day) - DAY_SORT_ORDER.indexOf(b.day);
    if (dayDiff) return dayDiff;
    const timeDiff = cleanText(a.time).localeCompare(cleanText(b.time));
    if (timeDiff) return timeDiff;
    return cleanText(a.nameFa).localeCompare(cleanText(b.nameFa), 'fa');
  });
}

function buildTmdbPeople(details, mediaType) {
  const credits = mediaType === 'tv' ? details?.aggregate_credits : details?.credits;
  const cast = Array.isArray(credits?.cast) ? credits.cast : [];
  const crew = Array.isArray(credits?.crew) ? credits.crew : [];
  const creators = mediaType === 'tv' && Array.isArray(details?.created_by) ? details.created_by : [];

  const people = [];
  const seen = new Set();

  for (const creator of creators.slice(0, maxDirectors)) {
    const person = tmdbPerson(creator, 'director', 'سازنده', people.length);
    if (person && !seen.has(person.id)) {
      seen.add(person.id);
      people.push(person);
    }
  }

  const directors = crew.filter((entry) => {
    if (mediaType === 'tv' && Array.isArray(entry?.jobs)) {
      return entry.jobs.some((job) => /director|directing/i.test(cleanText(job?.job || job?.department)));
    }
    return /director|directing/i.test(cleanText(entry?.job || entry?.department));
  });

  for (const entry of directors.slice(0, maxDirectors)) {
    const person = tmdbPerson(entry, 'director', 'کارگردان', people.length);
    if (person && !seen.has(person.id)) {
      seen.add(person.id);
      people.push(person);
    }
  }

  for (const entry of cast.slice(0, maxActors)) {
    const person = tmdbPerson(entry, 'actor', 'بازیگر', people.length);
    if (person && !seen.has(person.id)) {
      seen.add(person.id);
      people.push(person);
    }
  }

  return people;
}

function tmdbPerson(entry, role, roleLabel, fallbackOrder) {
  const id = positiveInt(entry?.id, 0);
  const name = cleanText(entry?.name || entry?.original_name);
  if (!id || !name) return null;

  const profilePath = cleanText(entry?.profile_path);
  const character = cleanText(
    entry?.character ||
    (Array.isArray(entry?.roles) ? entry.roles.map((roleEntry) => roleEntry?.character).filter(Boolean).join('، ') : ''),
  );
  const order = nonNegativeInt(entry?.order ?? entry?.cast_order, fallbackOrder);

  return {
    id: `${role}-tmdb-${id}`,
    tmdbId: id,
    nameFa: name,
    name,
    role,
    roleLabel,
    ...(character ? { character } : {}),
    ...(profilePath ? { image: tmdbProfileUrl(profilePath) } : {}),
    order,
    source: 'tmdb',
  };
}

function containsPersian(value) {
  return /[\u0600-\u06ff]/.test(cleanText(value));
}

function mergeTmdbPeople(existingValue, tmdbValue) {
  const existing = Array.isArray(existingValue) ? existingValue.filter(Boolean).map(compactPerson) : [];
  const tmdb = Array.isArray(tmdbValue) ? tmdbValue.filter(Boolean).map(compactPerson) : [];
  if (!tmdb.length) return existing;

  const usedExisting = new Set();
  const findLocalMatch = (person) => {
    const sameRole = existing
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate, index }) => candidate.role === person.role && !usedExisting.has(index));

    const byTmdb = person.tmdbId
      ? sameRole.find(({ candidate }) => Number(candidate.tmdbId || 0) === Number(person.tmdbId))
      : null;
    if (byTmdb) return byTmdb;

    const tmdbName = normalizeName(person.name || person.nameFa);
    const byName = sameRole.find(({ candidate }) => {
      const names = [candidate.name, candidate.nameFa].map(normalizeName).filter(Boolean);
      return tmdbName && names.includes(tmdbName);
    });
    if (byName) return byName;

    // Upera and TMDB commonly return cast in billing order. Use order only as a
    // conservative last fallback, so a Persian local name can stay attached to
    // the portrait without replacing an already matched person.
    return sameRole.find(({ candidate }) =>
      Number.isFinite(Number(candidate.order)) && Number(candidate.order) === Number(person.order),
    ) || null;
  };

  const mergedTmdb = tmdb.map((person) => {
    const match = findLocalMatch(person);
    if (match) usedExisting.add(match.index);
    const local = match?.candidate;
    const localFa = containsPersian(local?.nameFa)
      ? cleanText(local.nameFa)
      : containsPersian(local?.name)
        ? cleanText(local.name)
        : '';
    return compactPerson({
      ...local,
      ...person,
      id: person.id || local?.id,
      tmdbId: person.tmdbId || local?.tmdbId,
      nameFa: localFa || cleanText(local?.nameFa || person.nameFa || person.name),
      name: cleanText(person.name || local?.name || person.nameFa || local?.nameFa),
      image: cleanText(person.image || local?.image),
      character: cleanText(local?.character || person.character),
      roleLabel: cleanText(local?.roleLabel || person.roleLabel),
      source: 'tmdb',
    });
  });

  const unmatchedLocal = existing.filter((_, index) => !usedExisting.has(index));
  const seen = new Set();
  return [...mergedTmdb, ...unmatchedLocal]
    .filter((person) => {
      const key = person.tmdbId
        ? `${person.role}:tmdb:${person.tmdbId}`
        : `${person.role}:name:${normalizeName(person.name || person.nameFa)}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const roleDiff = (a.role === 'director' ? 0 : 1) - (b.role === 'director' ? 0 : 1);
      return roleDiff || nonNegativeInt(a.order, 0) - nonNegativeInt(b.order, 0);
    })
    .slice(0, maxDirectors + maxActors + 8);
}

function compactPerson(person) {
  const source = cleanText(person?.source || '');
  const englishName = cleanText(person?.name || person?.nameFa);
  const localNameFa = cleanText(person?.nameFa || englishName);
  const result = {
    id: cleanText(person?.id),
    nameFa: localNameFa,
    name: englishName,
    role: person?.role === 'director' ? 'director' : 'actor',
    roleLabel: cleanText(person?.roleLabel || (person?.role === 'director' ? 'کارگردان' : 'بازیگر')),
  };
  const tmdbId = positiveInt(person?.tmdbId, 0) || tmdbIdFromPersonId(person?.id);
  if (tmdbId) result.tmdbId = tmdbId;
  const image = cleanText(person?.image);
  if (image) result.image = image;
  const character = cleanText(person?.character);
  if (character) result.character = character;
  result.order = nonNegativeInt(person?.order, 0);
  result.source = source || (tmdbId ? 'tmdb' : 'upera');
  return result;
}

function chooseSearchResult(resultsValue, queryTitle, year, mediaType, item) {
  const results = Array.isArray(resultsValue) ? resultsValue : [];
  const query = normalizeTitle(queryTitle);
  const iranian = item?.ir === true || hasIranCountry(item);
  const scored = results
    .filter((entry) => positiveInt(entry?.id, 0))
    .map((entry, index) => {
      const title = normalizeTitle(entry?.title || entry?.name);
      const original = normalizeTitle(entry?.original_title || entry?.original_name);
      const date = cleanText(entry?.release_date || entry?.first_air_date);
      const resultYear = positiveInt(date.slice(0, 4), 0);
      const originCountries = Array.isArray(entry?.origin_country) ? entry.origin_country.map(cleanText) : [];
      const originalLanguage = cleanText(entry?.original_language).toLowerCase();
      let score = Math.max(0, 22 - index * 3);

      if (title === query || original === query) score += 100;
      else if (
        (title && query && (title.includes(query) || query.includes(title))) ||
        (original && query && (original.includes(query) || query.includes(original)))
      ) score += 38;

      if (year && resultYear) {
        const difference = Math.abs(year - resultYear);
        if (difference === 0) score += 48;
        else if (difference === 1) score += 22;
        else if (difference === 2) score += 6;
        else score -= 35;
      }

      const looksIranian = originalLanguage === 'fa' || originCountries.includes('IR');
      if (iranian && looksIranian) score += 65;
      if (iranian && !looksIranian) score -= 30;
      if (!iranian && looksIranian) score -= 8;

      score += Math.min(10, Number(entry?.popularity || 0) / 10);
      return { ...entry, score, resultYear, mediaType };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const threshold = iranian ? 75 : 92;
  return best && best.score >= threshold ? best : null;
}

async function tmdbGet(endpoint, params = {}) {
  await waitForRequestSlot();
  const url = new URL(`${apiBase}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) return response.json();
    const body = await response.text();
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Math.max(1, positiveInt(response.headers.get('retry-after'), attempt * 2));
      await sleep(retryAfter * 1000);
      continue;
    }
    throw new Error(`TMDB ${response.status}: ${body.slice(0, 240)}`);
  }
  throw new Error('TMDB پس از چند تلاش پاسخ معتبر نداد.');
}

async function waitForRequestSlot() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < requestDelayMs) await sleep(requestDelayMs - elapsed);
  lastRequestAt = Date.now();
}

function hasCompleteTmdbPeople(peopleValue) {
  const people = Array.isArray(peopleValue) ? peopleValue.filter(Boolean) : [];
  if (!people.length) return false;
  const actors = people.filter((person) => person?.role === 'actor');
  const directors = people.filter((person) => person?.role === 'director');
  const tmdbPeople = people.filter((person) => cleanText(person?.source) === 'tmdb');
  const actorPortraits = actors.filter((person) => isHttpUrl(person?.image)).length;
  const directorPortraits = directors.filter((person) => isHttpUrl(person?.image)).length;
  return tmdbPeople.length >= Math.min(people.length, Math.max(1, actors.length)) &&
    actorPortraits >= Math.min(6, Math.max(1, actors.length)) &&
    (directors.length === 0 || directorPortraits >= 1);
}

function uniqueTexts(values) {
  const seen = new Set();
  return values
    .map(cleanText)
    .filter((value) => {
      const key = normalizeTitle(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function hasIranCountry(item) {
  const codes = [
    ...(Array.isArray(item?.countryCodes) ? item.countryCodes : []),
    ...(Array.isArray(item?.countries) ? item.countries : []),
    item?.country,
  ].map((value) => cleanText(value).toUpperCase());
  return codes.some((value) => value === 'IR' || value.includes('IRAN') || value.includes('ایران'));
}

function firstValidResult(value) {
  return Array.isArray(value) ? value.find((entry) => positiveInt(entry?.id, 0)) || null : null;
}

function compactTmdbRef(value) {
  if (!value || !positiveInt(value.id, 0)) return undefined;
  return {
    id: positiveInt(value.id, 0),
    mediaType: value.mediaType === 'tv' ? 'tv' : 'movie',
    source: cleanText(value.source || 'tmdb'),
  };
}

function itemSignature(item) {
  return [
    'tmdb-v5-validated-country-anime-documentary',
    cleanText(item.id || item.slug),
    item.type === 'series' ? 'series' : 'movie',
    normalizeImdbId(item.imdb || item.imdbId || item.imdb_id),
    normalizeTitle(item.name || item.nameFa),
    positiveInt(item.year, 0),
  ].join('|');
}

function normalizeImdbId(value) {
  const match = cleanText(value).match(/tt\d{6,12}/i);
  return match ? match[0].toLowerCase() : '';
}

function tmdbIdFromPersonId(value) {
  const match = cleanText(value).match(/tmdb-(\d+)$/i);
  return match ? positiveInt(match[1], 0) : 0;
}

function tmdbProfileUrl(profilePath) {
  const clean = cleanText(profilePath);
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) return clean.replace(/^http:\/\//i, 'https://');
  return `https://image.tmdb.org/t/p/w342/${clean.replace(/^\/+/, '')}`;
}

function normalizeTitle(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeName(value) {
  return normalizeTitle(value);
}

function isCacheStale(value, days) {
  const time = Date.parse(String(value || ''));
  return !Number.isFinite(time) || Date.now() - time > days * 86400000;
}

function isHttpUrl(value) {
  return /^https:\/\//i.test(cleanText(value));
}

function deepEqualPeople(a, b) {
  return JSON.stringify(Array.isArray(a) ? a : []) === JSON.stringify(Array.isArray(b) ? b : []);
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

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

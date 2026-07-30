import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const cachePath = path.join(root, 'tmdb-cache.json');
const reportPath = path.join(root, 'tmdb-enrichment-report.json');

const token = String(process.env.TMDB_READ_ACCESS_TOKEN || '').trim();
const apiBase = String(process.env.TMDB_API_BASE || 'https://api.themoviedb.org/3').replace(/\/+$/, '');
const requestDelayMs = positiveInt(process.env.TMDB_REQUEST_DELAY_MS, 280);
const maxTitlesPerRun = positiveInt(process.env.TMDB_MAX_TITLES_PER_RUN, 300);
const refreshDays = positiveInt(process.env.TMDB_REFRESH_DAYS, 30);
const maxActors = positiveInt(process.env.TMDB_MAX_ACTORS, 18);
const maxDirectors = positiveInt(process.env.TMDB_MAX_DIRECTORS, 4);

if (!token) {
  throw new Error('GitHub Secret با نام TMDB_READ_ACCESS_TOKEN در دسترس Workflow نیست.');
}

const catalog = await readJson(catalogPath, null);
if (!catalog || !Array.isArray(catalog.items)) {
  throw new Error('catalog.json پیدا نشد یا ساختار items معتبر نیست.');
}

const cache = await readJson(cachePath, {
  version: 2,
  updatedAt: null,
  items: {},
});
if (!cache.items || typeof cache.items !== 'object' || Array.isArray(cache.items)) {
  cache.items = {};
}

const report = {
  startedAt: new Date().toISOString(),
  totalTitles: catalog.items.length,
  considered: 0,
  apiProcessed: 0,
  cacheApplied: 0,
  enrichedTitles: 0,
  enrichedPeople: 0,
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

  const signature = itemSignature(item);
  const cacheKey = String(item.id || item.slug || signature);
  const cached = cache.items[cacheKey];

  if (cached && cached.signature === signature && Array.isArray(cached.people)) {
    const merged = mergeTmdbPeople(item.people, cached.people);
    if (!deepEqualPeople(item.people, merged)) {
      item.people = merged;
      item.tmdb = compactTmdbRef(cached.tmdb);
      item.tmdbEnrichedAt = cached.fetchedAt;
      catalogChanged = true;
      report.enrichedTitles += 1;
      report.enrichedPeople += merged.filter((person) => person?.image).length;
    }
    report.cacheApplied += 1;
    if (!isCacheStale(cached.fetchedAt, refreshDays)) continue;
  }

  if (hasCompleteTmdbPeople(item.people)) {
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
    const match = await resolveTmdbTitle(item);
    if (!match) {
      report.skippedNoMatch += 1;
      cache.items[cacheKey] = {
        signature,
        fetchedAt: new Date().toISOString(),
        tmdb: null,
        people: [],
      };
      continue;
    }

    if (item.ir === true) report.iranianMatched += 1;
    if (match.source.startsWith('title-search')) report.titleSearchMatched += 1;

    const details = await fetchTitleDetails(match.mediaType, match.id);
    const tmdbPeople = buildTmdbPeople(details, match.mediaType);
    const merged = mergeTmdbPeople(item.people, tmdbPeople);

    cache.items[cacheKey] = {
      signature,
      fetchedAt: new Date().toISOString(),
      tmdb: {
        id: match.id,
        mediaType: match.mediaType,
        source: match.source,
      },
      people: tmdbPeople,
    };

    if (!deepEqualPeople(item.people, merged)) {
      item.people = merged;
      item.tmdb = compactTmdbRef(cache.items[cacheKey].tmdb);
      item.tmdbEnrichedAt = cache.items[cacheKey].fetchedAt;
      catalogChanged = true;
      report.enrichedTitles += 1;
      report.enrichedPeople += merged.filter((person) => person?.image).length;
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

console.log(`TMDB: ${report.enrichedTitles} عنوان و ${report.enrichedPeople} تصویر بازیگر/عامل به‌روزرسانی شد.`);
console.log(`TMDB: ${report.cacheApplied} مورد از کش، ${report.apiProcessed} مورد از API، ${report.skippedNoMatch} مورد بدون تطبیق.`);
if (report.errors.length) {
  console.warn(`TMDB: ${report.errors.length} خطا ثبت شد؛ جزئیات در tmdb-enrichment-report.json است.`);
}

async function resolveTmdbTitle(item) {
  const expectedType = item.type === 'series' ? 'tv' : 'movie';
  const existingType = item?.tmdb?.mediaType === 'tv' ? 'tv' : item?.tmdb?.mediaType === 'movie' ? 'movie' : null;
  const existingId = positiveInt(item?.tmdb?.id, 0);
  if (existingType && existingId) {
    return { id: existingId, mediaType: existingType, source: 'catalog' };
  }

  const imdbId = normalizeImdbId(item.imdb || item.imdbId || item.imdb_id);
  if (imdbId) {
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
      append_to_response: 'aggregate_credits',
    });
  }
  return tmdbGet(`/movie/${id}`, {
    language: 'en-US',
    append_to_response: 'credits',
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

function mergeTmdbPeople(existingValue, tmdbValue) {
  const existing = Array.isArray(existingValue) ? existingValue.filter(Boolean) : [];
  const tmdb = Array.isArray(tmdbValue) ? tmdbValue.filter(Boolean) : [];
  if (!tmdb.length) return existing.map(compactPerson);

  // TMDB is the source of truth whenever a title is matched. Use the original
  // English person names for foreign and Iranian works alike, and keep local
  // people only as a role-level fallback when TMDB has no cast or no director.
  const normalizedTmdb = tmdb.map((person) => compactPerson({
    ...person,
    nameFa: cleanText(person?.name || person?.nameFa),
    name: cleanText(person?.name || person?.nameFa),
    source: 'tmdb',
  }));

  const hasTmdbActors = normalizedTmdb.some((person) => person.role === 'actor');
  const hasTmdbDirectors = normalizedTmdb.some((person) => person.role === 'director');
  const fallback = existing
    .filter((person) =>
      (person?.role === 'actor' && !hasTmdbActors) ||
      (person?.role === 'director' && !hasTmdbDirectors),
    )
    .map(compactPerson);

  const seen = new Set();
  return [...normalizedTmdb, ...fallback]
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
  const result = {
    id: cleanText(person?.id),
    nameFa: source === 'tmdb' ? englishName : cleanText(person?.nameFa || englishName),
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
  const namesAreEnglish = tmdbPeople.every((person) =>
    cleanText(person?.name) && cleanText(person?.nameFa) === cleanText(person?.name),
  );
  const actorPortraits = actors.filter((person) => isHttpUrl(person?.image)).length;
  const directorPortraits = directors.filter((person) => isHttpUrl(person?.image)).length;
  return tmdbPeople.length === people.length &&
    namesAreEnglish &&
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
    'tmdb-v2-english-all',
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

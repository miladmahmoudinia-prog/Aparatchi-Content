import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const catalogManifestPath = path.join(root, 'catalog-manifest.json');
const cachePath = path.join(root, 'imdb-top-cache.json');
const ratingsUrl = String(
  process.env.IMDB_RATINGS_URL || 'https://datasets.imdbws.com/title.ratings.tsv.gz',
).trim();
const basicsUrl = String(
  process.env.IMDB_BASICS_URL || 'https://datasets.imdbws.com/title.basics.tsv.gz',
).trim();
const ratingsFile = String(process.env.IMDB_RATINGS_FILE || '').trim();
const basicsFile = String(process.env.IMDB_BASICS_FILE || '').trim();
const tmdbToken = String(process.env.TMDB_READ_ACCESS_TOKEN || '').trim();
const refreshHours = positiveNumber(process.env.IMDB_TOP_REFRESH_HOURS, 20);
const force = /^(?:1|true|yes)$/i.test(String(process.env.IMDB_TOP_FORCE || ''));
const posterMirrorConcurrency = Math.max(1, Math.min(
  12,
  positiveInt(process.env.IMDB_POSTER_MIRROR_CONCURRENCY, 6),
));

const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
if (!catalog || !Array.isArray(catalog.items)) {
  throw new Error('catalog.json پیدا نشد یا ساختار items معتبر نیست.');
}

const previous = catalog.imdbTop100;
const previousUpdatedAt = Date.parse(String(previous?.updatedAt || ''));
if (
  !force &&
  previous?.source === 'imdb-ratings-dataset' &&
  Number(previous?.formatVersion || 0) >= 2 &&
  Array.isArray(previous.movies) && previous.movies.length >= 100 &&
  Array.isArray(previous.series) && previous.series.length >= 100 &&
  Number.isFinite(previousUpdatedAt) &&
  Date.now() - previousUpdatedAt < refreshHours * 60 * 60 * 1_000
) {
  console.log('IMDb Top 100 هنوز تازه است؛ نیازی به دریافت دوباره نیست.');
  const postersChanged = await mirrorRankingPosters(previous);
  if (postersChanged) catalog.updatedAt = new Date().toISOString();
  await writeCatalogAndManifest(catalog);
  process.exit(0);
}

const cache = await readJson(cachePath, { version: 2, posters: {} });
if (!cache.posters || typeof cache.posters !== 'object') {
  cache.posters = {};
}
cache.version = 2;

let rawMovies = [];
let rawSeries = [];
try {
  const ratings = await collectCandidateRatings(
    await openDataset(ratingsFile, ratingsUrl),
  );
  const candidates = await collectTitleCandidates(
    await openDataset(basicsFile, basicsUrl),
    ratings,
  );
  rawMovies = rankTitles(candidates.movies, 'movie');
  rawSeries = rankTitles(candidates.series, 'series');
  if (rawMovies.length < 100 || rawSeries.length < 100) {
    throw new Error(`فهرست کامل نبود: movies=${rawMovies.length}, series=${rawSeries.length}`);
  }
} catch (error) {
  if (
    previous?.source === 'imdb-ratings-dataset' &&
    Array.isArray(previous.movies) && previous.movies.length > 0 &&
    Array.isArray(previous.series) && previous.series.length > 0
  ) {
    console.warn(`IMDb refresh skipped; previous ranking kept: ${error instanceof Error ? error.message : String(error)}`);
    const postersChanged = await mirrorRankingPosters(previous);
    if (postersChanged) catalog.updatedAt = new Date().toISOString();
    await writeCatalogAndManifest(catalog);
    process.exit(0);
  }
  console.warn(`IMDb datasets unavailable; catalog ranking used: ${error instanceof Error ? error.message : String(error)}`);
}

const catalogIndex = createCatalogIndex(catalog.items);
const officialLoaded = rawMovies.length >= 100 && rawSeries.length >= 100;
const movies = officialLoaded
  ? await materializeRanking(rawMovies, 'movie', catalogIndex, cache)
  : buildCatalogFallback(catalog.items, 'movie');
const series = officialLoaded
  ? await materializeRanking(rawSeries, 'series', catalogIndex, cache)
  : buildCatalogFallback(catalog.items, 'series');

await mirrorRankingPosters({ movies, series });

const updatedAt = new Date().toISOString();
catalog.imdbTop100 = {
  formatVersion: 2,
  updatedAt,
  source: officialLoaded ? 'imdb-ratings-dataset' : 'catalog',
  movies,
  series,
};
catalog.updatedAt = updatedAt;
cache.updatedAt = updatedAt;

await Promise.all([
  writeCatalogAndManifest(catalog),
  fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8'),
]);

console.log(
  `IMDb Top 100: ${movies.length} فیلم و ${series.length} سریال ` +
  `(source=${catalog.imdbTop100.source}, available=${
    [...movies, ...series].filter((entry) => entry.itemId).length
  }).`,
);

async function openDataset(file, url) {
  const source = file
    ? createReadStream(file)
    : await remoteStream(url);
  return /\.gz(?:$|[?#])/i.test(file || url)
    ? source.pipe(createGunzip())
    : source;
}

async function remoteStream(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/gzip,application/octet-stream;q=0.9,*/*;q=0.5',
      'user-agent': 'Aparatchi-IMDb-Ranking/2.0',
    },
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`);
  return Readable.fromWeb(response.body);
}

async function collectCandidateRatings(stream) {
  const result = new Map();
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line || line.startsWith('tconst')) continue;
    const [imdbValue, ratingValue, votesValue] = line.split('\t');
    const imdb = normalizeImdbId(imdbValue);
    const rating = Number(ratingValue);
    const votes = Number.parseInt(votesValue, 10);
    if (!imdb || !Number.isFinite(rating) || rating <= 0 || !Number.isFinite(votes) || votes < 1_000) continue;
    result.set(imdb, { rating: Math.round(rating * 10) / 10, votes });
  }
  return result;
}

async function collectTitleCandidates(stream, ratings) {
  const movies = [];
  const series = [];
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line || line.startsWith('tconst')) continue;
    const [imdbValue, titleType, primaryTitle, originalTitle, isAdult, startYear] = line.split('\t');
    const imdb = normalizeImdbId(imdbValue);
    const rating = ratings.get(imdb);
    if (!rating || isAdult === '1') continue;
    const entry = {
      imdb,
      title: cleanDatasetText(primaryTitle) || cleanDatasetText(originalTitle) || imdb,
      originalTitle: cleanDatasetText(originalTitle),
      year: positiveInt(startYear, 0),
      rating: rating.rating,
      votes: rating.votes,
    };
    if (titleType === 'movie') movies.push(entry);
    else if (titleType === 'tvSeries' || titleType === 'tvMiniSeries') series.push(entry);
  }
  return { movies, series };
}

function rankTitles(entries, type) {
  const minimumVotes = type === 'movie' ? 25_000 : 10_000;
  const eligible = entries.filter((entry) => entry.votes >= minimumVotes);
  eligible.sort((left, right) =>
    right.rating - left.rating ||
    right.votes - left.votes ||
    right.year - left.year ||
    left.title.localeCompare(right.title, 'en'),
  );
  return eligible.slice(0, 100);
}

function createCatalogIndex(items) {
  const byImdb = new Map();
  const byTitle = new Map();
  for (const item of items) {
    if (!item || !['movie', 'series'].includes(item.type)) continue;
    const imdb = normalizeImdbId(item.imdb);
    if (imdb) byImdb.set(imdb, item);
    for (const title of [item.name, item.nameFa]) {
      const normalized = normalizeTitle(title);
      if (!normalized) continue;
      const key = `${item.type}:${normalized}:${positiveInt(item.year, 0)}`;
      if (!byTitle.has(key)) byTitle.set(key, item);
    }
  }
  return { byImdb, byTitle };
}

function findCatalogItem(entry, type, index) {
  const exact = index.byImdb.get(entry.imdb);
  if (exact?.type === type) return exact;
  const titles = [entry.title, entry.originalTitle].map(normalizeTitle).filter(Boolean);
  for (const yearOffset of [0, -1, 1]) {
    for (const title of titles) {
      const match = index.byTitle.get(`${type}:${title}:${entry.year + yearOffset}`);
      if (match) return match;
    }
  }
  return null;
}

async function materializeRanking(entries, type, catalogIndex, posterCache) {
  const result = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const item = findCatalogItem(entry, type, catalogIndex);
    if (item) {
      item.imdb = entry.imdb;
      item.rate = entry.rating;
      item.imdbVotes = entry.votes;
      catalogIndex.byImdb.set(entry.imdb, item);
    }
    const itemTitle = cleanText(item?.name);
    const itemTitleFa = cleanText(item?.nameFa);
    const tmdb = !cleanText(item?.poster) || !itemTitleFa
      ? await tmdbMetadata(entry.imdb, type, posterCache)
      : {};
    const poster = cleanText(item?.poster) || cleanText(tmdb.poster);
    const title = itemTitle || entry.title;
    const titleFa = itemTitleFa || cleanText(tmdb.titleFa);
    result.push({
      rank: index + 1,
      ...(item ? { itemId: String(item.id) } : {}),
      type,
      title,
      ...(titleFa && normalizeTitle(titleFa) !== normalizeTitle(title) ? { titleFa } : {}),
      imdb: entry.imdb,
      ...(entry.year > 0 ? { year: entry.year } : {}),
      rating: entry.rating,
      votes: entry.votes,
      ...(poster ? { poster } : {}),
    });
  }
  return result;
}

async function tmdbMetadata(imdb, type, posterCache) {
  const cached = posterCache.posters[imdb];
  const cachedAt = Date.parse(String(cached?.fetchedAt || ''));
  if (
    cached &&
    cached.localized === true &&
    Number.isFinite(cachedAt) &&
    Date.now() - cachedAt < 60 * 86400000
  ) {
    return {
      poster: cleanText(cached.poster),
      titleFa: cleanText(cached.titleFa),
    };
  }
  if (!tmdbToken) {
    return {
      poster: cleanText(cached?.poster),
      titleFa: cleanText(cached?.titleFa),
    };
  }
  try {
    await sleep(70);
    const response = await fetch(
      `https://api.themoviedb.org/3/find/${encodeURIComponent(imdb)}?external_source=imdb_id&language=fa-IR`,
      {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${tmdbToken}`,
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) {
      return {
        poster: cleanText(cached?.poster),
        titleFa: cleanText(cached?.titleFa),
      };
    }
    const payload = await response.json();
    const candidates = type === 'series' ? payload?.tv_results : payload?.movie_results;
    const candidate = Array.isArray(candidates) ? candidates[0] : null;
    const posterPath = cleanText(candidate?.poster_path);
    const poster = posterPath ? `https://image.tmdb.org/t/p/w342/${posterPath.replace(/^\/+/, '')}` : '';
    const localizedTitle = cleanText(candidate?.title || candidate?.name);
    const titleFa = containsPersian(localizedTitle) ? localizedTitle : '';
    posterCache.posters[imdb] = {
      poster: poster || cleanText(cached?.poster),
      ...(titleFa ? { titleFa } : {}),
      localized: true,
      fetchedAt: new Date().toISOString(),
    };
    return {
      poster: cleanText(posterCache.posters[imdb].poster),
      titleFa,
    };
  } catch {
    return {
      poster: cleanText(cached?.poster),
      titleFa: cleanText(cached?.titleFa),
    };
  }
}

function buildCatalogFallback(items, type) {
  return items
    .filter((item) => item?.type === type && Number(item.rate || 0) > 0)
    .sort((left, right) =>
      Number(right.rate || 0) - Number(left.rate || 0) ||
      Number(right.imdbVotes || 0) - Number(left.imdbVotes || 0) ||
      Number(right.year || 0) - Number(left.year || 0),
    )
    .slice(0, 100)
    .map((item, index) => ({
      rank: index + 1,
      itemId: String(item.id),
      type,
      title: String(item.name || item.nameFa || ''),
      ...(item.nameFa && normalizeTitle(item.nameFa) !== normalizeTitle(item.name)
        ? { titleFa: String(item.nameFa) }
        : {}),
      ...(normalizeImdbId(item.imdb) ? { imdb: normalizeImdbId(item.imdb) } : {}),
      year: Number(item.year || 0),
      rating: Number(item.rate),
      ...(Number(item.imdbVotes || 0) > 0 ? { votes: Number(item.imdbVotes) } : {}),
      ...(item.poster ? { poster: item.poster } : {}),
    }));
}

async function mirrorRankingPosters(ranking) {
  const entries = [
    ...(Array.isArray(ranking?.movies) ? ranking.movies : []),
    ...(Array.isArray(ranking?.series) ? ranking.series : []),
  ];
  const targets = entries.filter((entry) =>
    /^https?:\/\/image\.tmdb\.org\//i.test(cleanText(entry?.poster)),
  );
  let changed = false;
  for (let offset = 0; offset < targets.length; offset += posterMirrorConcurrency) {
    const batch = targets.slice(offset, offset + posterMirrorConcurrency);
    const results = await Promise.all(batch.map(async (entry) => ({
      entry,
      poster: await mirrorTmdbPoster(entry.poster),
    })));
    for (const result of results) {
      if (!result.poster || result.poster === result.entry.poster) continue;
      result.entry.poster = result.poster;
      changed = true;
    }
  }
  if (targets.length) {
    console.log(`IMDb poster mirror: ${targets.length} تصویر بررسی شد.`);
  }
  return changed;
}

async function mirrorTmdbPoster(value) {
  const url = cleanText(value);
  if (!/^https?:\/\/image\.tmdb\.org\//i.test(url)) return url;
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 32);
  const extension = /\.png(?:$|[?#])/i.test(url) ? '.png' : '.jpg';
  const relative = `assets/media/imdb/${hash}${extension}`;
  const absolute = path.join(root, ...relative.split('/'));
  try {
    const stat = await fs.stat(absolute);
    if (stat.isFile() && stat.size >= 512) return relative;
  } catch {
    // Download the image below.
  }
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
        'user-agent': 'Aparatchi-IMDb-Poster-Mirror/1.0',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return url;
    const contentType = cleanText(response.headers.get('content-type')).toLowerCase();
    if (contentType && !contentType.startsWith('image/')) return url;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 512 || buffer.length > 10 * 1024 * 1024) return url;
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, buffer);
    return relative;
  } catch {
    return url;
  }
}

async function writeCatalogAndManifest(value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const manifest = {
    schemaVersion: 1,
    revision: createHash('sha256').update(serialized).digest('hex'),
    catalogVersion: cleanText(value?.version),
    catalogUpdatedAt: cleanText(value?.updatedAt),
    sizeBytes: Buffer.byteLength(serialized),
  };
  await Promise.all([
    fs.writeFile(catalogPath, serialized, 'utf8'),
    fs.writeFile(catalogManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
  ]);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function cleanDatasetText(value) {
  const text = String(value || '').trim();
  return text === '\\N' ? '' : text;
}

function normalizeImdbId(value) {
  const match = String(value || '').match(/tt\d{6,12}/i);
  return match ? match[0].toLowerCase() : '';
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

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function containsPersian(value) {
  return /[\u0600-\u06FF]/.test(cleanText(value));
}

function positiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

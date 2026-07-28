import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'https://seeko.film/api/v1';
const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const statePath = path.join(root, 'sync-state.json');
const reportPath = path.join(root, 'sync-report.json');

const refId = String(process.env.UPERA_REF_ID || '').trim();
const token = String(process.env.UPERA_TOKEN || '').trim();
const moviePagesPerRun = positiveInt(process.env.MOVIE_PAGES_PER_RUN, 3);
const seriesPagesPerRun = positiveInt(process.env.SERIES_PAGES_PER_RUN, 1);
const newTitlesHours = positiveInt(process.env.NEW_TITLES_HOURS, 72);
const concurrency = 1;
const affiliateRequestDelay = positiveInt(process.env.UPERA_REQUEST_DELAY_MS, 2500);
let lastAffiliateRequestAt = 0;

if (!refId) {
  throw new Error('GitHub Secret با نام UPERA_REF_ID تنظیم نشده است.');
}

const defaultCatalog = {
  version: '0.5.0-upera-auto-sync',
  updatedAt: new Date(0).toISOString(),
  items: [],
  iranianSchedule: [],
};

const defaultState = {
  moviePage: 1,
  seriesPage: 1,
  lastSyncAt: null,
};

const catalog = await readJson(catalogPath, defaultCatalog);
const state = await readJson(statePath, defaultState);
const originalCount = Array.isArray(catalog.items) ? catalog.items.length : 0;

// اپ فقط محتوایی را نگه می‌دارد که واقعاً لینک پخش/دانلود رایگان مستقیم دارد.
let items = (Array.isArray(catalog.items) ? catalog.items : []).filter(
  (item) => item?.access === 'free' && hasUsableMedia(item),
);

const stats = {
  startedAt: new Date().toISOString(),
  originalCount,
  cleanedCount: items.length,
  incrementalCandidates: 0,
  moviePagesProcessed: 0,
  seriesPagesProcessed: 0,
  moviesAddedOrUpdated: 0,
  seriesAddedOrUpdated: 0,
  removedWithoutFreeLinks: 0,
  errors: [],
};

console.log(`شروع همگام‌سازی؛ ${items.length} عنوان معتبر قبلی.`);

// ۱) عنوان‌ها و قسمت‌های تازه/به‌روزشده؛ باعث می‌شود محتوای جدید منتظر backfill نماند.
try {
  const fresh = await fetchNewTitles(newTitlesHours);
  stats.incrementalCandidates = fresh.length;
  console.log(`${fresh.length} مورد تازه یا به‌روزشده پیدا شد.`);
  await processCandidates(fresh, 'incremental');
} catch (error) {
  rememberError('incremental', error);
}

// ۲) تکمیل تدریجی کل آرشیو. شماره صفحه در sync-state.json ذخیره می‌شود.
for (let i = 0; i < moviePagesPerRun; i += 1) {
  try {
    const page = positiveInt(state.moviePage, 1);
    const payload = await fetchMoviePage(page);
    const movies = payload.items;
    console.log(`صفحه فیلم ${page}: ${movies.length} عنوان.`);
    await mapLimit(movies, concurrency, async (movie) => processMovie(movie, 'backfill'));
    stats.moviePagesProcessed += 1;
    state.moviePage = nextPage(page, payload.lastPage);
  } catch (error) {
    rememberError(`movie-page-${state.moviePage}`, error);
    break;
  }
}

for (let i = 0; i < seriesPagesPerRun; i += 1) {
  try {
    const page = positiveInt(state.seriesPage, 1);
    const payload = await fetchSeriesPage(page);
    const seriesList = payload.items;
    console.log(`صفحه سریال ${page}: ${seriesList.length} عنوان.`);
    await mapLimit(seriesList, Math.min(concurrency, 4), async (series) => processSeries(series, 'backfill'));
    stats.seriesPagesProcessed += 1;
    state.seriesPage = nextPage(page, payload.lastPage);
  } catch (error) {
    rememberError(`series-page-${state.seriesPage}`, error);
    break;
  }
}

items.sort((a, b) => String(b.sourceUpdatedAt || '').localeCompare(String(a.sourceUpdatedAt || '')));

const activeIds = new Set(items.map((item) => item.id));
const iranianSchedule = (Array.isArray(catalog.iranianSchedule) ? catalog.iranianSchedule : [])
  .filter((entry) => activeIds.has(entry.itemId));

const now = new Date().toISOString();
const output = {
  version: '0.5.0-upera-auto-sync',
  updatedAt: now,
  items,
  iranianSchedule,
};

state.lastSyncAt = now;
stats.finishedAt = now;
stats.finalCount = items.length;

await writeJson(catalogPath, output);
await writeJson(statePath, state);
await writeJson(reportPath, stats);

console.log(`پایان همگام‌سازی؛ ${items.length} عنوان رایگان معتبر در catalog.json.`);

async function processCandidates(candidates, source) {
  const unique = dedupeCandidates(candidates);
  await mapLimit(unique, concurrency, async (candidate) => {
    const type = detectType(candidate);
    try {
      if (type === 'episode') {
        const seriesId = candidate.series_id || candidate.seriesId || candidate.t_id;
        if (seriesId) await processSeries({ id: seriesId }, source);
        return;
      }
      if (type === 'series') {
        await processSeries(candidate, source);
        return;
      }
      if (type === 'movie') {
        await processMovie(candidate, source);
        return;
      }

      // پاسخ بعضی نسخه‌های API فقط id می‌دهد؛ هر دو نوع را امتحان می‌کنیم.
      const id = candidate?.id || candidate?.t_id;
      if (!id) return;
      const movieDetail = await safeCall(() => fetchMovieDetail(id));
      if (movieDetail) {
        await processMovie(movieDetail, source);
        return;
      }
      await processSeries({ id }, source);
    } catch (error) {
      rememberError(`${source}-${candidate?.id || 'unknown'}`, error);
    }
  });
}

async function processMovie(candidate, source) {
  const id = candidate?.id || candidate?.t_id;
  if (!id) return;

  let movie = candidate;
  if (!hasBasicMetadata(movie)) {
    movie = await fetchMovieDetail(id);
  }
  if (!movie) return;

  const links = await fetchAffiliateLinks(id, 'movie');
  const media = parseMediaLinks(links);
   if (!media.downloads.length && !media.streamUrl) {
    console.log(`فیلم ${id} فعلاً لینک رایگان قابل استفاده ندارد؛ مورد قبلی حذف نشد.`);
    return;
  }

  const normalized = normalizeMovie(movie, media, source);
  replaceItem(normalized);
  stats.moviesAddedOrUpdated += 1;
}

async function processSeries(candidate, source) {
  const id = candidate?.id || candidate?.t_id || candidate?.series_id;
  if (!id) return;

  const detail = await fetchSeriesDetail(id);
  const series = detail?.series;
  if (!series) return;

  const episodes = detail.episodes
    .filter((episode) => episode && episode.id && Number(episode.show ?? 1) !== 0)
    .sort((a, b) => {
      const seasonDiff = Number(a.season_number || 0) - Number(b.season_number || 0);
      return seasonDiff || Number(a.episode_number || 0) - Number(b.episode_number || 0);
    });

  const groups = (await mapLimit(episodes, concurrency, async (episode) => {
    try {
      const links = await fetchAffiliateLinks(episode.id, 'episode');
      const media = parseMediaLinks(links);
      if (!media.downloads.length && !media.streamUrl) return null;
      return episodeGroup(episode, media);
    } catch (error) {
      rememberError(`episode-${episode.id}`, error);
      return null;
    }
  })).filter(Boolean);

  if (!groups.length) {
    console.log(`سریال ${id} فعلاً لینک قابل استفاده دریافت نکرد؛ مورد قبلی حذف نشد.`);
    return;
  }

  const normalized = normalizeSeries(series, groups, source);
  replaceItem(normalized);
  stats.seriesAddedOrUpdated += 1;
}

async function fetchMoviePage(page) {
  const url = new URL(`${API_BASE}/ghost/get/movies/sort`);
  setQuery(url, {
    trending: 1,
    genre: 'all',
    free: 1,
    country: 0,
    persian: '',
    query: '',
    affiliate: 1,
    imdb: '',
    page,
  });
  const json = await fetchJson(url, { method: 'POST' });
  return pagedResult(json, 'movies');
}

async function fetchSeriesPage(page) {
  const url = new URL(`${API_BASE}/ghost/get/series/sort`);
  setQuery(url, {
    trending: 1,
    genre: 'all',
    free: 1,
    country: 0,
    persian: 0,
    query: '',
    affiliate: 1,
    page,
  });
  const json = await fetchJson(url, { method: 'POST' });
  return pagedResult(json, 'series');
}

async function fetchNewTitles(hours) {
  const url = new URL(`${API_BASE}/get/getNewTitles`);
  setQuery(url, {
    sort_by: 'updated_at',
    age: '',
    lang: '',
    country: '',
    f_type: '',
    traffic: 1,
    limitbyhour: hours,
    imdb: '',
  });
  const json = await fetchJson(url);
  return extractCandidates(json?.data ?? json);
}

async function fetchMovieDetail(id) {
  const json = await fetchJson(`${API_BASE}/ghost/get/movie/${encodeURIComponent(id)}`);
  const data = json?.data ?? json;
  return data?.movie || data?.movies?.[0] || (data?.type === 'movie' ? data : null);
}

async function fetchSeriesDetail(id) {
  const url = new URL(`${API_BASE}/ghost/get/series/${encodeURIComponent(id)}`);
  url.searchParams.set('affiliate', '1');
  const json = await fetchJson(url);
  const data = json?.data ?? json;
  const series = data?.series || (data?.type === 'series' ? data : null);
  const season = data?.season && typeof data.season === 'object' ? data.season : {};
  const episodes = Object.values(season).flatMap((value) => Array.isArray(value) ? value : []);
  return { series, episodes };
}

  const elapsed = Date.now() - lastAffiliateRequestAt;
  const remainingDelay = affiliateRequestDelay - elapsed;

  if (remainingDelay > 0) {
    await sleep(remainingDelay);
  }

  lastAffiliateRequestAt = Date.now();  const url = new URL(`${API_BASE}/ghost/get/getaffiliatelinks`);
  setQuery(url, {
    id,
    type,
    ref: refId,
    traffic: 1,
    token,
  });
  const json = await fetchJson(url, { method: 'POST' });
  const links = json?.data?.links ?? json?.links ?? [];
  return Array.isArray(links) ? links : [];
}

function parseMediaLinks(links) {
  const freeLinks = links.filter((link) => Number(link?.amount || 0) === 0 && isHttp(link?.link));
  const mp4 = uniqueByUrl(freeLinks.filter((link) => /\.mp4(?:$|[?#])/i.test(link.link)));
  const hls = uniqueByUrl(freeLinks.filter((link) => /\.m3u8(?:$|[?#])/i.test(link.link)));

  const sortedMp4 = [...mp4].sort((a, b) => qualityRank(a.title) - qualityRank(b.title));
  const groups = new Map();
  for (const link of sortedMp4) {
    const language = linkLanguage(link.title);
    if (!groups.has(language)) groups.set(language, []);
    groups.get(language).push(toDownloadFile(link, 'download'));
  }

  const downloads = [...groups.entries()].map(([language, files]) => ({
    id: `download-${slugify(language)}`,
    title: language,
    subtitle: `${files.length} کیفیت دانلود مستقیم`,
    badge: 'DL',
    files,
  }));

  const streamUrl = hls[0]?.link || highestQuality(sortedMp4)?.link;
  return { downloads, streamUrl, hls: hls[0]?.link || null, mp4: sortedMp4 };
}

function episodeGroup(episode, media) {
  const season = Number(episode.season_number || 1);
  const number = Number(episode.episode_number || 0);
  const files = [];
  const playUrl = media.hls || highestQuality(media.mp4)?.link;
  if (playUrl) {
    files.push({
      id: `play-s${season}-e${number}`,
      quality: 'پخش آنلاین',
      label: media.hls ? 'HLS' : 'پخش مستقیم',
      url: playUrl,
      mode: 'play',
    });
  }

  for (const link of media.mp4) {
    files.push(toDownloadFile(link, 'download', `s${season}-e${number}`));
  }

  return {
    id: `season-${season}-episode-${number}-${episode.id}`,
    title: `فصل ${toPersianDigits(season)} • قسمت ${toPersianDigits(number)}`,
    subtitle: episode.name_fa || episode.overview_fa || episode.name || `قسمت ${number}`,
    badge: `E${number}`,
    files,
  };
}

function normalizeMovie(movie, media, source) {
  const id = String(movie.id || movie.t_id);
  const poster = imageUrl(movie.poster, 'posters');
  const backdrop = imageUrl(movie.backdrop, 'backdrops') || poster;
  return {
    id,
    slug: `movie-${id}`,
    type: 'movie',
    ir: Number(movie.ir || 0) === 1,
    year: numericYear(movie.year),
    nameFa: cleanText(movie.name_fa || movie.name || 'بدون نام'),
    name: cleanText(movie.name || movie.name_fa || 'Untitled'),
    ...(movie.imdb ? { imdb: String(movie.imdb) } : {}),
    poster,
    backdrop,
    overview: cleanText(movie.overview_fa || movie.overview || 'توضیحی ثبت نشده است.'),
    genres: translateGenres(movie.new_genres || movie.genre_fa || movie.genre),
    ...(isFiniteNumber(movie.rate) ? { rate: Number(movie.rate) } : {}),
    access: 'free',
    ...(media.streamUrl ? { streamUrl: media.streamUrl, streamMode: 'video' } : {}),
    downloads: media.downloads,
    sourceUpdatedAt: String(movie.updated_at || movie.created_at || new Date().toISOString()),
    source: `upera-${source}`,
  };
}

function normalizeSeries(series, groups, source) {
  const id = String(series.id || series.t_id);
  const poster = imageUrl(series.poster, 'posters');
  const backdrop = imageUrl(series.backdrop, 'backdrops') || poster;
  return {
    id,
    slug: `series-${id}`,
    type: 'series',
    ir: Number(series.ir || 0) === 1,
    year: numericYear(series.year),
    nameFa: cleanText(series.name_fa || series.name || 'بدون نام'),
    name: cleanText(series.name || series.name_fa || 'Untitled'),
    ...(series.imdb ? { imdb: String(series.imdb) } : {}),
    poster,
    backdrop,
    overview: cleanText(series.overview_fa || series.overview || 'توضیحی ثبت نشده است.'),
    genres: translateGenres(series.new_genres || series.genre_fa || series.genre),
    ...(isFiniteNumber(series.rate) ? { rate: Number(series.rate) } : {}),
    access: 'free',
    downloads: groups,
    sourceUpdatedAt: String(series.updated_at || series.created_at || new Date().toISOString()),
    source: `upera-${source}`,
  };
}

function replaceItem(next) {
  const nextName = normalizeName(next.nameFa || next.name);
  items = items.filter((item) => {
    if (item.id === next.id) return false;
    if (next.imdb && item.imdb && item.imdb === next.imdb) return false;
    return !(item.type === next.type && normalizeName(item.nameFa || item.name) === nextName);
  });
  items.push(next);
}

function removeExisting(candidate, type) {
  const id = String(candidate?.id || candidate?.t_id || '');
  const imdb = candidate?.imdb ? String(candidate.imdb) : '';
  const name = normalizeName(candidate?.name_fa || candidate?.name || '');
  items = items.filter((item) => {
    if (id && item.id === id) return false;
    if (imdb && item.imdb === imdb) return false;
    if (name && item.type === type && normalizeName(item.nameFa || item.name) === name) return false;
    return true;
  });
}

function hasUsableMedia(item) {
  if (isDirectMedia(item?.streamUrl)) return true;
  return Array.isArray(item?.downloads) && item.downloads.some(
    (group) => Array.isArray(group?.files) && group.files.some((file) => isDirectMedia(file?.url)),
  );
}

function toDownloadFile(link, mode, prefix = '') {
  const quality = qualityLabel(link.title);
  return {
    id: [prefix, slugify(quality), simpleHash(link.link)].filter(Boolean).join('-'),
    quality,
    label: cleanText(link.title || 'لینک مستقیم'),
    ...(link.size && Number(link.size) !== 0 ? { size: String(link.size) } : {}),
    url: link.link,
    mode,
  };
}

function translateGenres(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const translated = Object.values(value).map(cleanText).filter(Boolean);
    if (translated.length) return [...new Set(translated)];
  }

  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const map = {
    action: 'اکشن', adventure: 'ماجراجویی', animation: 'انیمیشن', biography: 'زندگینامه',
    comedy: 'کمدی', crime: 'جنایی', documentary: 'مستند', drama: 'درام', family: 'خانوادگی',
    fantasy: 'فانتزی', history: 'تاریخی', horror: 'ترسناک', kids: 'کودک', music: 'موسیقی',
    musical: 'موزیکال', mystery: 'معمایی', romance: 'عاشقانه', sci_fi: 'علمی‌تخیلی',
    'sci-fi': 'علمی‌تخیلی', sport: 'ورزشی', talk_show: 'تاک‌شو', thriller: 'هیجان‌انگیز',
    war: 'جنگی', western: 'وسترن', iranian: 'ایرانی', foreign: 'خارجی',
  };
  const result = raw
    .map((genre) => cleanText(genre))
    .filter(Boolean)
    .map((genre) => map[genre.toLowerCase().replaceAll(' ', '_')] || genre);
  return [...new Set(result.length ? result : ['سایر'])];
}

function extractCandidates(value, depth = 0) {
  if (depth > 5 || value == null) return [];
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === 'object' && (item.id || item.t_id))) return value;
    return value.flatMap((item) => extractCandidates(item, depth + 1));
  }
  if (typeof value !== 'object') return [];
  for (const key of ['titles', 'items', 'data', 'movies', 'series', 'episodes', 'offer']) {
    const found = extractCandidates(value[key], depth + 1);
    if (found.length) return found;
  }
  return [];
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const type = detectType(candidate);
    const id = candidate.id || candidate.t_id || candidate.series_id;
    if (!id) continue;
    const key = `${type || 'unknown'}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function detectType(candidate) {
  const raw = String(candidate?.type || candidate?.f_type || '').toLowerCase();
  if (raw === 'movie' || raw === '1') return 'movie';
  if (raw === 'series' || raw === '2') return 'series';
  if (raw === 'episode' || candidate?.series_id) return 'episode';
  return null;
}

function hasBasicMetadata(item) {
  return Boolean(item && (item.name || item.name_fa) && item.poster);
}

function pagedResult(json, key) {
  const data = json?.data ?? json ?? {};
  const items = Array.isArray(data[key]) ? data[key] : [];
  return {
    items,
    currentPage: positiveInt(data.current_page, 1),
    lastPage: positiveInt(data.last_page, 1),
  };
}

async function fetchJson(input, options = {}) {
  const url = input instanceof URL ? input.toString() : String(input);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Aparatchi-Catalog-Sync/0.5',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} برای ${redact(url)}`);
      const text = await response.text();
      const json = JSON.parse(text);
      if (json?.status && json.status !== 'success') {
        throw new Error(`پاسخ ناموفق API برای ${redact(url)}`);
      }
      return json;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(600 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function mapLimit(list, limit, worker) {
  const result = new Array(list.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, list.length || 1) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= list.length) return;
      result[current] = await worker(list[current], current);
    }
  });
  await Promise.all(runners);
  return result;
}

async function safeCall(fn) {
  try { return await fn(); } catch { return null; }
}

function rememberError(scope, error) {
  const message = error instanceof Error ? error.message : String(error);
  stats.errors.push({ scope, message });
  console.error(`[${scope}] ${message}`);
}

function setQuery(url, params) {
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value == null ? '' : String(value));
  }
}

function nextPage(current, last) {
  return current >= Math.max(1, last) ? 1 : current + 1;
}

function imageUrl(file, folder) {
  if (!file) return 'https://thumb.upera.tv/s3/posters/default.jpg';
  if (/^https?:\/\//i.test(file)) return file;
  return `https://thumb.upera.tv/s3/${folder}/${String(file).replace(/^\/+/, '')}`;
}

function linkLanguage(title = '') {
  if (/دوبله/i.test(title)) return 'دوبله فارسی';
  if (/زیرنویس/i.test(title)) return 'زیرنویس فارسی';
  return 'نسخه اصلی';
}

function qualityLabel(title = '') {
  const text = String(title);
  const match = text.match(/(HQ[_\s-]*1080|2160|1440|1080|720|480|360)/i);
  if (!match) return cleanText(text || 'کیفیت اصلی');
  const value = match[1].toUpperCase().replace(/[\s-]+/g, '_');
  return value.includes('HQ') ? 'HQ 1080p' : `${value}p`;
}

function qualityRank(title = '') {
  const quality = qualityLabel(title);
  if (/360/.test(quality)) return 360;
  if (/480/.test(quality)) return 480;
  if (/720/.test(quality)) return 720;
  if (/HQ/.test(quality)) return 1180;
  if (/1080/.test(quality)) return 1080;
  if (/1440/.test(quality)) return 1440;
  if (/2160/.test(quality)) return 2160;
  return 9999;
}

function highestQuality(links) {
  return [...links].sort((a, b) => qualityRank(b.title) - qualityRank(a.title))[0] || null;
}

function uniqueByUrl(links) {
  const seen = new Set();
  return links.filter((link) => {
    if (!link?.link || seen.has(link.link)) return false;
    seen.add(link.link);
    return true;
  });
}

function isDirectMedia(url) {
  return typeof url === 'string' && /\.(mp4|m3u8)(?:$|[?#])/i.test(url);
}

function isHttp(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function cleanText(value) {
  return String(value ?? '').replace(/\\r?\\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
  return cleanText(value).toLowerCase().replace(/[\s‌_-]+/g, '');
}

function numericYear(value) {
  const year = Number(value);
  return Number.isFinite(year) && year > 1800 ? year : new Date().getUTCFullYear();
}

function isFiniteNumber(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value));
}

function slugify(value) {
  return String(value || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function simpleHash(value) {
  let hash = 0;
  for (const char of String(value)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(36);
}

function toPersianDigits(value) {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

function positiveInt(value, fallback) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function redact(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('ref')) parsed.searchParams.set('ref', '***');
    if (parsed.searchParams.has('token')) parsed.searchParams.set('token', '***');
    return parsed.toString();
  } catch {
    return url;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

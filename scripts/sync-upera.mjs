import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const API_BASE = 'https://seeko.film/api/v1';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const statePath = path.join(root, 'sync-state.json');
const reportPath = path.join(root, 'sync-report.json');
const mediaRoot = path.join(root, 'assets', 'media');
const execFileAsync = promisify(execFile);

const refId = String(process.env.UPERA_REF_ID || '').trim();
const token = String(process.env.UPERA_TOKEN || '').trim();

const moviePagesPerRun = Math.min(
  3,
  positiveInt(process.env.MOVIE_PAGES_PER_RUN, 1),
);

const seriesPagesPerRun = Math.min(
  3,
  positiveInt(process.env.SERIES_PAGES_PER_RUN, 2),
);

const newTitlesHours = positiveInt(
  process.env.NEW_TITLES_HOURS,
  72,
);

const affiliateRequestDelay = positiveInt(
  process.env.UPERA_REQUEST_DELAY_MS,
  3500,
);

const maxAffiliateRequests = positiveInt(
  process.env.UPERA_MAX_REQUESTS_PER_RUN,
  55,
);

const episodesPerSeriesRun = positiveInt(
  process.env.UPERA_EPISODES_PER_SERIES,
  5,
);

const seriesTitlesPerRun = positiveInt(
  process.env.UPERA_SERIES_TITLES_PER_RUN,
  6,
);

const maxIncrementalCandidates = positiveInt(
  process.env.UPERA_INCREMENTAL_LIMIT,
  10,
);

const maxMirroredImagesPerRun = positiveInt(
  process.env.APARATCHI_SYNC_MAX_MIRRORED_IMAGES,
  120,
);

const imageMirrorConcurrency = Math.min(
  8,
  positiveInt(process.env.APARATCHI_IMAGE_MIRROR_CONCURRENCY, 6),
);

if (!refId) {
  throw new Error(
    'GitHub Secret با نام UPERA_REF_ID تنظیم نشده است.',
  );
}

const defaultCatalog = {
  version: '0.6.0-safe-sync',
  updatedAt: new Date(0).toISOString(),
  items: [],
  iranianSchedule: [],
  weeklySchedule: [],
};

const defaultState = {
  moviePage: 1,
  movieOffset: 0,
  seriesPage: 1,
  seriesOffset: 0,
  seriesEpisodeCursor: {},
  lastSyncAt: null,
};

const catalog = await readJson(catalogPath, defaultCatalog);
const state = await readJson(statePath, defaultState);

state.moviePage = positiveInt(state.moviePage, 1);
state.movieOffset = nonNegativeInt(state.movieOffset, 0);
state.seriesPage = positiveInt(state.seriesPage, 1);
state.seriesOffset = nonNegativeInt(state.seriesOffset, 0);

if (
  !state.seriesEpisodeCursor ||
  typeof state.seriesEpisodeCursor !== 'object' ||
  Array.isArray(state.seriesEpisodeCursor)
) {
  state.seriesEpisodeCursor = {};
}

let items = Array.isArray(catalog.items)
  ? catalog.items.filter(Boolean)
  : [];

let lastAffiliateRequestAt = 0;
let affiliateRequestsUsed = 0;
let affiliateBudgetExhausted = false;

const stats = {
  startedAt: new Date().toISOString(),
  originalCount: items.length,
  finalCount: items.length,

  incrementalCandidates: 0,
  incrementalProcessed: 0,

  moviePagesProcessed: 0,
  movieTitlesProcessed: 0,

  seriesPagesProcessed: 0,
  seriesTitlesProcessed: 0,
  iranianSeriesProcessed: 0,
  episodesProcessed: 0,

  moviesAddedOrUpdated: 0,
  seriesAddedOrUpdated: 0,

  affiliateRequests: 0,
  rateLimitHits: 0,
  rateLimitWaitMs: 0,
  skippedByBudget: 0,
  imagesMirrored: 0,
  imageMirrorErrors: 0,

  removedWithoutFreeLinks: 0,
  errors: [],
  errorsTruncated: 0,
};

console.log(
  `شروع همگام‌سازی امن؛ ${items.length} عنوان قبلی حفظ می‌شود.`,
);

await syncIncrementalTitles();

if (!affiliateBudgetExhausted) {
  await syncSeriesArchive();
}

if (!affiliateBudgetExhausted) {
  await syncMovieArchive();
}

items.sort((a, b) => {
  const aDate = String(
    a.updatedAt ||
    a.sourceUpdatedAt ||
    a.createdAt ||
    '',
  );

  const bDate = String(
    b.updatedAt ||
    b.sourceUpdatedAt ||
    b.createdAt ||
    '',
  );

  return bDate.localeCompare(aDate);
});

const activeIds = new Set(
  items.map((item) => String(item.id)),
);

const iranianSchedule = Array.isArray(
  catalog.iranianSchedule,
)
  ? catalog.iranianSchedule.filter(
      (entry) =>
        !entry?.itemId ||
        activeIds.has(String(entry.itemId)),
    )
  : [];

const weeklySchedule = Array.isArray(
  catalog.weeklySchedule,
)
  ? catalog.weeklySchedule.filter(
      (entry) =>
        !entry?.itemId ||
        activeIds.has(String(entry.itemId)),
    )
  : [];

const now = new Date().toISOString();

const output = {
  ...catalog,
  version: '0.6.0-safe-sync',
  updatedAt: now,
  items,
  iranianSchedule,
  weeklySchedule,
};

state.lastSyncAt = now;

stats.finishedAt = now;
stats.finalCount = items.length;
stats.affiliateRequests = affiliateRequestsUsed;

await writeJson(catalogPath, output);
await writeJson(statePath, state);
await writeJson(reportPath, stats);
await stageMirroredAssets();

console.log(
  `پایان همگام‌سازی؛ ${items.length} عنوان حفظ شد.`,
);

async function syncIncrementalTitles() {
  try {
    const fresh = await fetchNewTitles(newTitlesHours);

    const unique = dedupeCandidates(fresh)
      .sort(
        (a, b) =>
          candidateSyncPriority(a) -
          candidateSyncPriority(b),
      )
      .slice(
        0,
        maxIncrementalCandidates,
      );

    stats.incrementalCandidates = unique.length;

    console.log(
      `${unique.length} مورد تازه یا به‌روزشده برای بررسی پیدا شد.`,
    );

    for (const candidate of unique) {
      if (affiliateBudgetExhausted) break;

      try {
        await processCandidate(candidate, 'incremental');
        stats.incrementalProcessed += 1;
      } catch (error) {
        rememberError(
          `incremental-${candidate?.id || candidate?.t_id || 'unknown'}`,
          error,
        );
      }
    }
  } catch (error) {
    rememberError('incremental', error);
  }
}

async function syncMovieArchive() {
  let completedPages = 0;

  while (
    completedPages < moviePagesPerRun &&
    !affiliateBudgetExhausted
  ) {
    const page = positiveInt(state.moviePage, 1);

    let payload;

    try {
      payload = await fetchMoviePage(page);
    } catch (error) {
      rememberError(`movie-page-${page}`, error);
      break;
    }

    const movies = payload.items;

    if (!movies.length) {
      state.moviePage = nextPage(
        page,
        payload.lastPage,
      );

      state.movieOffset = 0;
      completedPages += 1;
      stats.moviePagesProcessed += 1;
      continue;
    }

    let offset = nonNegativeInt(
      state.movieOffset,
      0,
    );

    if (offset >= movies.length) {
      offset = 0;
      state.movieOffset = 0;
    }

    while (
      offset < movies.length &&
      !affiliateBudgetExhausted
    ) {
      const movie = movies[offset];
      let retryLater = false;

      try {
        const result = await processMovie(
          movie,
          'backfill',
        );

        retryLater = Boolean(result?.retryLater);
      } catch (error) {
        rememberError(
          `movie-${movie?.id || movie?.t_id || 'unknown'}`,
          error,
        );
      }

      if (retryLater) {
        break;
      }

      offset += 1;
      state.movieOffset = offset;
      stats.movieTitlesProcessed += 1;
    }

    if (offset >= movies.length) {
      state.moviePage = nextPage(
        page,
        payload.lastPage,
      );

      state.movieOffset = 0;
      completedPages += 1;
      stats.moviePagesProcessed += 1;
    } else {
      break;
    }
  }
}

async function syncSeriesArchive() {
  let completedPages = 0;
  let visitedTitles = 0;

  while (
    completedPages < seriesPagesPerRun &&
    visitedTitles < seriesTitlesPerRun &&
    !affiliateBudgetExhausted
  ) {
    const page = positiveInt(state.seriesPage, 1);

    let payload;

    try {
      payload = await fetchSeriesPage(page);
    } catch (error) {
      rememberError(`series-page-${page}`, error);
      break;
    }

    const seriesList = [...payload.items].sort((a, b) => Number(inferIranian(b)) - Number(inferIranian(a)));

    if (!seriesList.length) {
      state.seriesPage = nextPage(
        page,
        payload.lastPage,
      );

      state.seriesOffset = 0;
      completedPages += 1;
      stats.seriesPagesProcessed += 1;
      continue;
    }

    let offset = nonNegativeInt(
      state.seriesOffset,
      0,
    );

    if (offset >= seriesList.length) {
      offset = 0;
      state.seriesOffset = 0;
    }

    const series = seriesList[offset];

    try {
      const result = await processSeries(
        series,
        'backfill',
      );

      if (result?.retryLater) {
        break;
      }

      visitedTitles += 1;
      stats.seriesTitlesProcessed += 1;

      if (result?.completeBackfill) {
        offset += 1;
        state.seriesOffset = offset;
      } else {
        break;
      }
    } catch (error) {
      rememberError(
        `series-${series?.id || series?.t_id || 'unknown'}`,
        error,
      );

      offset += 1;
      state.seriesOffset = offset;
      visitedTitles += 1;
    }

    if (offset >= seriesList.length) {
      state.seriesPage = nextPage(
        page,
        payload.lastPage,
      );

      state.seriesOffset = 0;
      completedPages += 1;
      stats.seriesPagesProcessed += 1;
    }
  }
}

async function processCandidate(candidate, source) {
  const type = detectType(candidate);

  if (type === 'episode') {
    const seriesId =
      candidate.series_id ||
      candidate.seriesId ||
      candidate.t_id;

    if (!seriesId) return;

    await processSeries(
      { id: seriesId },
      source,
      {
        onlyEpisodeId: candidate.id,
      },
    );

    return;
  }

  if (type === 'series') {
    await processSeries(candidate, source);
    return;
  }

  if (type === 'movie') {
    await processMovie(candidate, source);
  }
}

async function processMovie(candidate, source) {
  const id = candidate?.id || candidate?.t_id;

  if (!id) {
    return {
      retryLater: false,
    };
  }

  let movie = candidate;

  if (!hasBasicMetadata(movie)) {
    movie = await fetchMovieDetail(id);
  }

  if (!movie) {
    return {
      retryLater: false,
    };
  }

  const linkResult = await fetchAffiliateLinks(
    id,
    'movie',
  );

  if (linkResult.skipped) {
    return {
      retryLater: true,
    };
  }

  const media = parseMediaLinks(
    linkResult.links,
  );

  if (
    !media.downloads.length &&
    !media.streamUrl
  ) {
    console.log(
      `فیلم ${id} لینک رایگان مستقیم نداشت؛ مورد قبلی حذف نشد.`,
    );

    return {
      retryLater: false,
    };
  }

  const existing = findExistingItem(
    movie,
    'movie',
  );

  const normalized = normalizeMovie(
    movie,
    media,
    source,
    existing,
  );

  await mirrorCatalogItemImages(normalized);
  replaceItem(normalized);
  stats.moviesAddedOrUpdated += 1;

  return {
    retryLater: false,
  };
}

async function processSeries(
  candidate,
  source,
  options = {},
) {
  const id =
    candidate?.id ||
    candidate?.t_id ||
    candidate?.series_id;

  if (!id) {
    return {
      retryLater: false,
      completeBackfill: true,
    };
  }

  const detail = await fetchSeriesDetail(id);
  const series = detail.series;

  if (!series) {
    return {
      retryLater: false,
      completeBackfill: true,
    };
  }

  const episodes = detail.episodes
    .filter(
      (episode) =>
        episode &&
        episode.id &&
        Number(episode.show ?? 1) !== 0,
    )
    .sort(compareEpisodes);

  const existing = findExistingItem(
    series,
    'series',
  );

  const previousGroups = Array.isArray(
    existing?.downloads,
  )
    ? existing.downloads
    : [];

  const mergedGroups = [...previousGroups];

  let selectedEpisodes = [];
  let cursor = 0;

  if (options.onlyEpisodeId) {
    const matched = episodes.find(
      (episode) =>
        String(episode.id) ===
        String(options.onlyEpisodeId),
    );

    if (matched) {
      selectedEpisodes = [matched];
    }
  } else if (source === 'incremental') {
    const changedEpisodes = episodes
      .filter((episode) =>
        episodeNeedsRefresh(
          episode,
          previousGroups,
        ),
      )
      .sort((a, b) =>
        String(
          b.updated_at ||
          b.created_at ||
          '',
        ).localeCompare(
          String(
            a.updated_at ||
            a.created_at ||
            '',
          ),
        ),
      );

    selectedEpisodes = changedEpisodes.slice(
      0,
      episodesPerSeriesRun,
    );

    if (
      !selectedEpisodes.length &&
      episodes.length
    ) {
      selectedEpisodes = episodes.slice(-2);
    }
  } else {
    const savedCursor = nonNegativeInt(
      state.seriesEpisodeCursor[id],
      0,
    );

    cursor =
      savedCursor < episodes.length
        ? savedCursor
        : 0;

    selectedEpisodes = episodes.slice(
      cursor,
      cursor + episodesPerSeriesRun,
    );
  }

  let processedEpisodes = 0;
  let addedEpisodes = 0;
  let latestAddedEpisode = null;
  let stoppedByBudget = false;

  for (const episode of selectedEpisodes) {
    if (affiliateBudgetExhausted) {
      stoppedByBudget = true;
      break;
    }

    processedEpisodes += 1;
    stats.episodesProcessed += 1;

    try {
      const linkResult =
        await fetchAffiliateLinks(
          episode.id,
          'episode',
        );

      if (linkResult.skipped) {
        stoppedByBudget = true;
        break;
      }

      const media = parseMediaLinks(
        linkResult.links,
      );

      if (
        !media.downloads.length &&
        !media.streamUrl
      ) {
        continue;
      }

      const previousGroup =
        findEpisodeGroup(
          mergedGroups,
          episode,
        );

      const nextGroup = episodeGroup(
        episode,
        media,
      );

      upsertEpisodeGroup(
        mergedGroups,
        nextGroup,
      );

      if (!previousGroup) {
        addedEpisodes += 1;
        latestAddedEpisode = episode;
      }
    } catch (error) {
      rememberError(
        `episode-${episode.id}`,
        error,
      );
    }
  }

  let completeBackfill = true;

  if (source === 'backfill') {
    const nextCursor =
      cursor + processedEpisodes;

    completeBackfill =
      nextCursor >= episodes.length;

    state.seriesEpisodeCursor[id] =
      completeBackfill
        ? 0
        : nextCursor;
  }

  mergedGroups.sort(compareEpisodeGroups);

  if (!mergedGroups.length) {
    console.log(
      `سریال ${id} هنوز لینک رایگان قابل استفاده ندارد؛ مورد قبلی حذف نشد.`,
    );

    return {
      retryLater: stoppedByBudget,
      completeBackfill,
    };
  }

  let updateLabel =
    existing?.updateLabel ||
    '';

  if (
    addedEpisodes > 0 &&
    latestAddedEpisode
  ) {
    const episodeNumber = Number(
      latestAddedEpisode.episode_number || 0,
    );

    updateLabel =
      `قسمت ${toPersianDigits(episodeNumber)} اضافه شد`;
  } else if (
    source === 'incremental' &&
    existing
  ) {
    updateLabel = 'بروزرسانی شد';
  }

  const normalized = normalizeSeries(
    series,
    mergedGroups,
    source,
    existing,
    updateLabel,
  );

  await mirrorCatalogItemImages(normalized);
  replaceItem(normalized);
  stats.seriesAddedOrUpdated += 1;
  if (normalized.ir) stats.iranianSeriesProcessed += 1;

  return {
    retryLater: stoppedByBudget,
    completeBackfill,
  };
}

async function fetchMoviePage(page) {
  const url = new URL(
    `${API_BASE}/ghost/get/movies/sort`,
  );

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

  const json = await fetchJson(
    url,
    { method: 'POST' },
  );

  return pagedResult(json, 'movies');
}

async function fetchSeriesPage(page) {
  const url = new URL(
    `${API_BASE}/ghost/get/series/sort`,
  );

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

  const json = await fetchJson(
    url,
    { method: 'POST' },
  );

  return pagedResult(json, 'series');
}

async function fetchNewTitles(hours) {
  const url = new URL(
    `${API_BASE}/get/getNewTitles`,
  );

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

  return extractCandidates(
    json?.data ?? json,
  );
}

async function fetchMovieDetail(id) {
  const json = await fetchJson(
    `${API_BASE}/ghost/get/movie/${encodeURIComponent(id)}`,
  );

  const data = json?.data ?? json;

  if (
    data?.movie &&
    typeof data.movie === 'object'
  ) {
    return data.movie;
  }

  if (Array.isArray(data?.movies)) {
    return data.movies[0] || null;
  }

  if (Array.isArray(data?.movies?.data)) {
    return data.movies.data[0] || null;
  }

  if (data?.type === 'movie') {
    return data;
  }

  return null;
}

async function fetchSeriesDetail(id) {
  const url = new URL(
    `${API_BASE}/ghost/get/series/${encodeURIComponent(id)}`,
  );

  url.searchParams.set(
    'affiliate',
    '1',
  );

  const json = await fetchJson(url);
  const data = json?.data ?? json;

  let series = null;

  if (
    data?.series &&
    !Array.isArray(data.series)
  ) {
    series = data.series;
  } else if (Array.isArray(data?.series)) {
    series = data.series[0] || null;
  } else if (data?.type === 'series') {
    series = data;
  }

  const seasonData =
    data?.season ||
    data?.seasons ||
    {};

  const episodes =
    collectEpisodes(seasonData);

  return {
    series,
    episodes,
  };
}

async function fetchAffiliateLinks(
  id,
  type,
) {
  if (
    affiliateRequestsUsed >=
    maxAffiliateRequests
  ) {
    affiliateBudgetExhausted = true;
    stats.skippedByBudget += 1;

    return {
      links: [],
      skipped: true,
    };
  }

  await throttleAffiliateRequest();

  affiliateRequestsUsed += 1;

  const url = new URL(
    `${API_BASE}/ghost/get/getaffiliatelinks`,
  );

  setQuery(url, {
    id,
    type,
    ref: refId,
    traffic: 1,
    token,
  });

  const json = await fetchJson(
    url,
    { method: 'POST' },
  );

  const links =
    json?.data?.links ??
    json?.links ??
    [];

  return {
    links: Array.isArray(links)
      ? links
      : [],
    skipped: false,
  };
}

async function throttleAffiliateRequest() {
  const elapsed =
    Date.now() -
    lastAffiliateRequestAt;

  const remaining =
    affiliateRequestDelay -
    elapsed;

  if (remaining > 0) {
    await sleep(remaining);
  }

  lastAffiliateRequestAt = Date.now();
}

function parseMediaLinks(links) {
  const freeLinks = links
    .filter(
      (link) =>
        Number(link?.amount || 0) === 0 &&
        isHttp(link?.link),
    )
    .map((link) => ({
      ...link,
      link: rewriteAffiliateRef(
        link.link,
      ),
    }));

  const mp4 = uniqueByUrl(
    freeLinks.filter(
      (link) =>
        /\.mp4(?:$|[?#])/i.test(
          link.link,
        ),
    ),
  );

  const hls = uniqueByUrl(
    freeLinks.filter(
      (link) =>
        /\.m3u8(?:$|[?#])/i.test(
          link.link,
        ),
    ),
  );

  const sortedMp4 = [...mp4].sort(
    (a, b) =>
      qualityRank(a.title) -
      qualityRank(b.title),
  );

  const groups = new Map();

  for (const link of sortedMp4) {
    const language = linkLanguage(
      link.title,
    );

    if (!groups.has(language)) {
      groups.set(language, []);
    }

    groups
      .get(language)
      .push(
        toDownloadFile(
          link,
          'download',
        ),
      );
  }

  const downloads = [
    ...groups.entries(),
  ].map(([language, files]) => ({
    id: `download-${slugify(language)}`,
    title: language,
    subtitle:
      `${files.length} کیفیت دانلود مستقیم`,
    badge: 'DL',
    files,
  }));

  const streamUrl =
    hls[0]?.link ||
    highestQuality(sortedMp4)?.link ||
    null;

  return {
    downloads,
    streamUrl,
    hls: hls[0]?.link || null,
    mp4: sortedMp4,
  };
}

function episodeGroup(episode, media) {
  const season = Number(
    episode.season_number || 1,
  );

  const number = Number(
    episode.episode_number || 0,
  );

  const files = [];

  const playUrl =
    media.hls ||
    highestQuality(media.mp4)?.link;

  if (playUrl) {
    files.push({
      id: `play-s${season}-e${number}`,
      quality: 'پخش آنلاین',
      label: media.hls
        ? 'HLS'
        : 'پخش مستقیم',
      url: playUrl,
      mode: 'play',
    });
  }

  for (const link of media.mp4) {
    files.push(
      toDownloadFile(
        link,
        'download',
        `s${season}-e${number}`,
      ),
    );
  }

  const sourceUpdatedAt = dateString(
    episode.updated_at ||
    episode.created_at,
    new Date().toISOString(),
  );

  return {
    id:
      `season-${season}-episode-${number}-${episode.id}`,

    sourceEpisodeId:
      String(episode.id),

    seasonNumber: season,
    episodeNumber: number,

    title:
      `فصل ${toPersianDigits(season)} • قسمت ${toPersianDigits(number)}`,

    subtitle:
      cleanText(
        episode.name_fa ||
        episode.overview_fa ||
        episode.name ||
        `قسمت ${number}`,
      ),

    badge: `E${number}`,
    sourceUpdatedAt,
    files,
  };
}

function normalizeMovie(
  movie,
  media,
  source,
  existing,
) {
  const id = String(
    movie.id || movie.t_id,
  );

  const poster = imageUrl(
    movie.poster,
    'posters',
  );

  const backdrop =
    imageUrl(
      movie.backdrop,
      'backdrops',
    ) || poster;

  const ir = inferIranian(movie);

  const genres = translateGenres(
    movie.new_genres ||
    movie.genre_fa ||
    movie.genre,
  );

  const sourceCreatedAt = dateString(
    movie.created_at,
    existing?.createdAt ||
    existing?.sourceCreatedAt ||
    new Date().toISOString(),
  );

  const sourceUpdatedAt = dateString(
    movie.updated_at ||
    movie.created_at,
    existing?.updatedAt ||
    existing?.sourceUpdatedAt ||
    sourceCreatedAt,
  );

  const classification =
    classifyContent(
      'movie',
      ir,
      genres,
    );

  return {
    ...(existing || {}),

    id,
    slug: `movie-${id}`,
    type: 'movie',
    ir,
    year: numericYear(movie.year),

    nameFa: cleanText(
      movie.name_fa ||
      movie.name ||
      'بدون نام',
    ),

    name: cleanText(
      movie.name ||
      movie.name_fa ||
      'Untitled',
    ),

    ...(movie.imdb
      ? { imdb: String(movie.imdb) }
      : {}),

    poster,
    backdrop,

    overview: cleanText(
      movie.overview_fa ||
      movie.overview ||
      'توضیحی ثبت نشده است.',
    ),

    genres,

    ...(isFiniteNumber(movie.rate)
      ? { rate: Number(movie.rate) }
      : {}),

    access: 'free',

    ...(media.streamUrl
      ? {
          streamUrl:
            media.streamUrl,
          streamMode: 'video',
        }
      : {}),

    downloads: media.downloads,

    createdAt: sourceCreatedAt,
    updatedAt: sourceUpdatedAt,
    sourceCreatedAt,
    sourceUpdatedAt,

    firstSeenAt:
      existing?.firstSeenAt ||
      new Date().toISOString(),

    lastSyncedAt:
      new Date().toISOString(),

    categoryKeys:
      classification.categoryKeys,

    categoryLabels:
      classification.categoryLabels,

    contentKind:
      classification.contentKind,

    isAnimation:
      classification.isAnimation,

    isTalkShow:
      classification.isTalkShow,

    isDocumentary:
      classification.isDocumentary,

    updateLabel:
      source === 'incremental'
        ? 'بروزرسانی شد'
        : existing?.updateLabel || '',

    source: `upera-${source}`,
  };
}

function normalizeSeries(
  series,
  groups,
  source,
  existing,
  updateLabel,
) {
  const id = String(
    series.id || series.t_id,
  );

  const poster = imageUrl(
    series.poster,
    'posters',
  );

  const backdrop =
    imageUrl(
      series.backdrop,
      'backdrops',
    ) || poster;

  const ir = inferIranian(series);

  const genres = translateGenres(
    series.new_genres ||
    series.genre_fa ||
    series.genre,
  );

  const latestEpisode = [...groups]
    .sort(compareEpisodeGroups)
    .at(-1);

  const sourceCreatedAt = dateString(
    series.created_at,
    existing?.createdAt ||
    existing?.sourceCreatedAt ||
    new Date().toISOString(),
  );

  const sourceUpdatedAt = maxDate(
    series.updated_at,
    series.created_at,
    latestEpisode?.sourceUpdatedAt,
    existing?.updatedAt,
    existing?.sourceUpdatedAt,
  );

  const classification =
    classifyContent(
      'series',
      ir,
      genres,
    );

  const seasonNumbers = new Set(
    groups
      .map((group) =>
        Number(group.seasonNumber || 0),
      )
      .filter((value) => value > 0),
  );

  return {
    ...(existing || {}),

    id,
    slug: `series-${id}`,
    type: 'series',
    ir,
    year: numericYear(series.year),

    nameFa: cleanText(
      series.name_fa ||
      series.name ||
      'بدون نام',
    ),

    name: cleanText(
      series.name ||
      series.name_fa ||
      'Untitled',
    ),

    ...(series.imdb
      ? { imdb: String(series.imdb) }
      : {}),

    poster,
    backdrop,

    overview: cleanText(
      series.overview_fa ||
      series.overview ||
      'توضیحی ثبت نشده است.',
    ),

    genres,

    ...(isFiniteNumber(series.rate)
      ? { rate: Number(series.rate) }
      : {}),

    access: 'free',
    downloads: groups,

    episodeCount: groups.length,
    seasonCount: seasonNumbers.size,

    latestEpisode: latestEpisode
      ? {
          id:
            latestEpisode.sourceEpisodeId ||
            latestEpisode.id,

          seasonNumber:
            Number(
              latestEpisode.seasonNumber ||
              0,
            ),

          episodeNumber:
            Number(
              latestEpisode.episodeNumber ||
              0,
            ),

          title:
            latestEpisode.title,
        }
      : null,

    createdAt: sourceCreatedAt,
    updatedAt: sourceUpdatedAt,
    sourceCreatedAt,
    sourceUpdatedAt,

    firstSeenAt:
      existing?.firstSeenAt ||
      new Date().toISOString(),

    lastSyncedAt:
      new Date().toISOString(),

    categoryKeys:
      classification.categoryKeys,

    categoryLabels:
      classification.categoryLabels,

    contentKind:
      classification.contentKind,

    isAnimation:
      classification.isAnimation,

    isTalkShow:
      classification.isTalkShow,

    isDocumentary:
      classification.isDocumentary,

    updateLabel:
      updateLabel ||
      existing?.updateLabel ||
      '',

    source: `upera-${source}`,
  };
}

function classifyContent(
  type,
  ir,
  genres,
) {
  const normalizedGenres = genres.map(
    (genre) =>
      cleanText(genre).toLowerCase(),
  );

  const isAnimation =
    normalizedGenres.some(
      (genre) =>
        genre.includes('انیمیشن') ||
        genre.includes('animation'),
    );

  const isTalkShow =
    normalizedGenres.some(
      (genre) =>
        genre.includes('تاک‌شو') ||
        genre.includes('تاک شو') ||
        genre.includes('talk'),
    );

  const isDocumentary =
    normalizedGenres.some(
      (genre) =>
        genre.includes('مستند') ||
        genre.includes('documentary'),
    );

  const categoryKeys = [];
  const categoryLabels = [];

  if (type === 'movie') {
    categoryKeys.push('movies');
    categoryLabels.push('فیلم‌ها');

    if (ir) {
      categoryKeys.push('iranian-movies');
      categoryLabels.push('فیلم ایرانی');
    } else {
      categoryKeys.push('foreign-movies');
      categoryLabels.push('فیلم خارجی');
    }
  } else {
    categoryKeys.push('series');
    categoryLabels.push('سریال‌ها');

    if (ir) {
      categoryKeys.push('iranian-series');
      categoryLabels.push('سریال ایرانی');
    } else {
      categoryKeys.push('foreign-series');
      categoryLabels.push('سریال خارجی');
    }
  }

  if (isAnimation) {
    if (type === 'movie') {
      categoryKeys.push(
        'animation-movies',
      );

      categoryLabels.push(
        'انیمیشن سینمایی',
      );
    } else {
      categoryKeys.push(
        'animation-series',
      );

      categoryLabels.push(
        'انیمیشن سریالی',
      );
    }
  }

  if (isTalkShow) {
    categoryKeys.push('talk-shows');
    categoryLabels.push('تاک‌شو');
  }

  if (isDocumentary) {
    categoryKeys.push('documentaries');
    categoryLabels.push('مستند');
  }

  let contentKind = type;

  if (isAnimation) {
    contentKind =
      type === 'movie'
        ? 'animation-movie'
        : 'animation-series';
  } else if (isTalkShow) {
    contentKind = 'talk-show';
  } else if (isDocumentary) {
    contentKind = 'documentary';
  }

  return {
    categoryKeys: [
      ...new Set(categoryKeys),
    ],

    categoryLabels: [
      ...new Set(categoryLabels),
    ],

    contentKind,
    isAnimation,
    isTalkShow,
    isDocumentary,
  };
}

function findExistingItem(
  candidate,
  type,
) {
  const id = String(
    candidate?.id ||
    candidate?.t_id ||
    '',
  );

  const imdb = candidate?.imdb
    ? String(candidate.imdb)
    : '';

  const name = normalizeName(
    candidate?.name_fa ||
    candidate?.name ||
    '',
  );

  return (
    items.find((item) => {
      if (
        id &&
        String(item.id) === id
      ) {
        return true;
      }

      if (
        imdb &&
        item.imdb &&
        String(item.imdb) === imdb
      ) {
        return true;
      }

      return Boolean(
        name &&
        item.type === type &&
        normalizeName(
          item.nameFa ||
          item.name,
        ) === name,
      );
    }) || null
  );
}

function replaceItem(next) {
  const nextName = normalizeName(
    next.nameFa ||
    next.name,
  );

  items = items.filter((item) => {
    if (
      String(item.id) ===
      String(next.id)
    ) {
      return false;
    }

    if (
      next.imdb &&
      item.imdb &&
      String(item.imdb) ===
      String(next.imdb)
    ) {
      return false;
    }

    return !(
      item.type === next.type &&
      normalizeName(
        item.nameFa ||
        item.name,
      ) === nextName
    );
  });

  items.push(next);
}

function episodeNeedsRefresh(
  episode,
  groups,
) {
  const group = findEpisodeGroup(
    groups,
    episode,
  );

  if (!group) return true;

  const episodeUpdated = String(
    episode.updated_at ||
    episode.created_at ||
    '',
  );

  const groupUpdated = String(
    group.sourceUpdatedAt ||
    '',
  );

  return Boolean(
    episodeUpdated &&
    episodeUpdated > groupUpdated
  );
}

function findEpisodeGroup(
  groups,
  episode,
) {
  const episodeId = String(
    episode?.id || '',
  );

  const season = Number(
    episode?.season_number || 1,
  );

  const number = Number(
    episode?.episode_number || 0,
  );

  return (
    groups.find((group) => {
      if (
        episodeId &&
        String(
          group.sourceEpisodeId || '',
        ) === episodeId
      ) {
        return true;
      }

      return (
        Number(
          group.seasonNumber || 0,
        ) === season &&
        Number(
          group.episodeNumber || 0,
        ) === number
      );
    }) || null
  );
}

function upsertEpisodeGroup(
  groups,
  next,
) {
  const index = groups.findIndex(
    (group) => {
      if (
        next.sourceEpisodeId &&
        String(
          group.sourceEpisodeId || '',
        ) ===
          String(next.sourceEpisodeId)
      ) {
        return true;
      }

      return (
        Number(
          group.seasonNumber || 0,
        ) ===
          Number(next.seasonNumber || 0) &&
        Number(
          group.episodeNumber || 0,
        ) ===
          Number(next.episodeNumber || 0)
      );
    },
  );

  if (index >= 0) {
    groups[index] = next;
  } else {
    groups.push(next);
  }
}

function compareEpisodes(a, b) {
  const seasonDiff =
    Number(a.season_number || 0) -
    Number(b.season_number || 0);

  if (seasonDiff) return seasonDiff;

  return (
    Number(a.episode_number || 0) -
    Number(b.episode_number || 0)
  );
}

function compareEpisodeGroups(a, b) {
  const seasonDiff =
    Number(a.seasonNumber || 0) -
    Number(b.seasonNumber || 0);

  if (seasonDiff) return seasonDiff;

  return (
    Number(a.episodeNumber || 0) -
    Number(b.episodeNumber || 0)
  );
}

function collectEpisodes(value) {
  const result = [];

  function walk(node, depth = 0) {
    if (
      node == null ||
      depth > 8
    ) {
      return;
    }

    if (Array.isArray(node)) {
      for (const entry of node) {
        if (
          entry &&
          typeof entry === 'object' &&
          (
            entry.episode_number != null ||
            entry.series_id ||
            entry.type === 'episode'
          )
        ) {
          result.push(entry);
        } else {
          walk(entry, depth + 1);
        }
      }

      return;
    }

    if (typeof node !== 'object') {
      return;
    }

    if (Array.isArray(node.episodes)) {
      walk(node.episodes, depth + 1);
    }

    for (const [key, entry] of Object.entries(node)) {
      if (key === 'episodes') continue;
      walk(entry, depth + 1);
    }
  }

  walk(value);

  const seen = new Set();

  return result.filter((episode) => {
    const id = String(
      episode?.id || '',
    );

    if (!id || seen.has(id)) {
      return false;
    }

    seen.add(id);
    return true;
  });
}

function translateGenres(value) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const translated =
      Object.values(value)
        .flatMap((entry) => {
          if (typeof entry === 'string') {
            return [entry];
          }

          if (
            entry &&
            typeof entry === 'object'
          ) {
            return [
              entry.name_fa,
              entry.name,
              entry.title,
            ].filter(Boolean);
          }

          return [];
        })
        .map(cleanText)
        .filter(Boolean);

    if (translated.length) {
      return [
        ...new Set(translated),
      ];
    }
  }

  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(',');

  const map = {
    action: 'اکشن',
    adventure: 'ماجراجویی',
    animation: 'انیمیشن',
    biography: 'زندگینامه',
    comedy: 'کمدی',
    crime: 'جنایی',
    documentary: 'مستند',
    drama: 'درام',
    family: 'خانوادگی',
    fantasy: 'فانتزی',
    history: 'تاریخی',
    horror: 'ترسناک',
    kids: 'کودک',
    music: 'موسیقی',
    musical: 'موزیکال',
    mystery: 'معمایی',
    romance: 'عاشقانه',
    sci_fi: 'علمی‌تخیلی',
    'sci-fi': 'علمی‌تخیلی',
    sport: 'ورزشی',
    talk_show: 'تاک‌شو',
    thriller: 'هیجان‌انگیز',
    war: 'جنگی',
    western: 'وسترن',
    iranian: 'ایرانی',
    foreign: 'خارجی',
  };

  const result = raw
    .map((genre) => {
      if (
        genre &&
        typeof genre === 'object'
      ) {
        return cleanText(
          genre.name_fa ||
          genre.name ||
          genre.title ||
          '',
        );
      }

      return cleanText(genre);
    })
    .filter(Boolean)
    .map((genre) => {
      const key = genre
        .toLowerCase()
        .replaceAll(' ', '_');

      return map[key] || genre;
    });

  return [
    ...new Set(
      result.length
        ? result
        : ['سایر'],
    ),
  ];
}

function inferIranian(item) {
  if (Number(item?.ir || 0) === 1) {
    return true;
  }

  const country = cleanText(
    item?.country_fa ||
    item?.country ||
    item?.countries ||
    '',
  );

  return /ایران|iran/i.test(country);
}

function extractCandidates(
  value,
  depth = 0,
) {
  if (
    depth > 7 ||
    value == null
  ) {
    return [];
  }

  if (Array.isArray(value)) {
    const direct = value.filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        (
          item.id ||
          item.t_id ||
          item.series_id
        ),
    );

    if (direct.length) {
      return direct;
    }

    return value.flatMap((item) =>
      extractCandidates(
        item,
        depth + 1,
      ),
    );
  }

  if (typeof value !== 'object') {
    return [];
  }

  const result = [];

  for (const key of [
    'titles',
    'items',
    'data',
    'movies',
    'series',
    'episodes',
    'offer',
  ]) {
    result.push(
      ...extractCandidates(
        value[key],
        depth + 1,
      ),
    );
  }

  return result;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const result = [];

  for (const candidate of candidates) {
    if (
      !candidate ||
      typeof candidate !== 'object'
    ) {
      continue;
    }

    const type = detectType(candidate);

    const id =
      candidate.id ||
      candidate.t_id ||
      candidate.series_id;

    if (!id) continue;

    const key =
      `${type || 'unknown'}:${id}`;

    if (seen.has(key)) continue;

    seen.add(key);
    result.push(candidate);
  }

  return result;
}

function candidateSyncPriority(candidate) {
  const type = detectType(candidate);

  if (
    type === 'series' ||
    type === 'episode'
  ) {
    return 0;
  }

  if (type === 'movie') {
    return 1;
  }

  return 2;
}

function detectType(candidate) {
  const raw = String(
    candidate?.type ||
    candidate?.f_type ||
    '',
  ).toLowerCase();

  if (
    raw === 'movie' ||
    raw === '1'
  ) {
    return 'movie';
  }

  if (
    raw === 'series' ||
    raw === '2'
  ) {
    return 'series';
  }

  if (
    raw === 'episode' ||
    candidate?.series_id
  ) {
    return 'episode';
  }

  return null;
}

function hasBasicMetadata(item) {
  return Boolean(
    item &&
    (
      item.name ||
      item.name_fa
    ) &&
    item.poster,
  );
}

function pagedResult(json, key) {
  const root =
    json?.data ??
    json ??
    {};

  const node =
    root?.[key] ??
    json?.[key] ??
    root;

  let items = [];
  let meta = root;

  if (Array.isArray(node)) {
    items = node;
  } else if (
    node &&
    typeof node === 'object'
  ) {
    meta = node;

    if (Array.isArray(node.data)) {
      items = node.data;
    } else if (Array.isArray(node.items)) {
      items = node.items;
    } else if (Array.isArray(node[key])) {
      items = node[key];
    }
  }

  if (
    !items.length &&
    Array.isArray(root?.data)
  ) {
    items = root.data;
  }

  const currentPage = positiveInt(
    meta.current_page ??
    meta.currentPage ??
    root.current_page ??
    root.currentPage,
    1,
  );

  const lastPage = positiveInt(
    meta.last_page ??
    meta.lastPage ??
    root.last_page ??
    root.lastPage,
    1,
  );

  return {
    items,
    currentPage,
    lastPage,
  };
}

async function fetchJson(
  input,
  options = {},
) {
  const url = input instanceof URL
    ? input.toString()
    : String(input);

  const maxAttempts = 5;
  let lastError;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      45000,
    );

    try {
      stats.apiRequests =
        Number(stats.apiRequests || 0) + 1;

      const response = await fetch(url, {
        ...options,

        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Aparatchi-Catalog-Sync/0.6',

          ...(options.headers || {}),
        },

        signal: controller.signal,
      });

      if (response.status === 429) {
        const retryAfter =
          response.headers.get(
            'retry-after',
          );

        const retrySeconds =
          Number.parseInt(
            retryAfter || '',
            10,
          );

        const waitMs =
          Number.isFinite(retrySeconds)
            ? Math.max(
                15000,
                retrySeconds * 1000,
              )
            : Math.min(
                60000,
                15000 * attempt,
              );

        stats.rateLimitHits += 1;
        stats.rateLimitWaitMs += waitMs;

        lastError = new Error(
          `HTTP 429 برای ${redact(url)}`,
        );

        console.warn(
          `محدودیت آپرا؛ ${Math.ceil(waitMs / 1000)} ثانیه انتظار.`,
        );

        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const error = new Error(
          `HTTP ${response.status} برای ${redact(url)}`,
        );

        const retryable =
          response.status === 408 ||
          response.status === 425 ||
          response.status >= 500;

        if (
          retryable &&
          attempt < maxAttempts
        ) {
          lastError = error;

          await sleep(
            Math.min(
              30000,
              3000 * attempt,
            ),
          );

          continue;
        }

        throw error;
      }

      const text =
        await response.text();

      const json = JSON.parse(text);

      if (
        json?.status &&
        json.status !== 'success'
      ) {
        throw new Error(
          `پاسخ ناموفق API برای ${redact(url)}`,
        );
      }

      return json;
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts) {
        break;
      }

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      if (
        !message.includes('HTTP 429')
      ) {
        await sleep(
          Math.min(
            30000,
            3000 * attempt,
          ),
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (
    lastError ||
    new Error(
      `دریافت اطلاعات ناموفق بود: ${redact(url)}`,
    )
  );
}

function rewriteAffiliateRef(value) {
  try {
    const url = new URL(value);

    if (
      /(^|\.)upera\./i.test(
        url.hostname,
      )
    ) {
      url.searchParams.set(
        'ref',
        refId,
      );
    }

    return url.toString();
  } catch {
    return value;
  }
}

function toDownloadFile(
  link,
  mode,
  prefix = '',
) {
  const quality = qualityLabel(
    link.title,
  );

  return {
    id: [
      prefix,
      slugify(quality),
      simpleHash(link.link),
    ]
      .filter(Boolean)
      .join('-'),

    quality,

    label: cleanText(
      link.title ||
      'لینک مستقیم',
    ),

    ...(
      link.size &&
      Number(link.size) !== 0
        ? { size: String(link.size) }
        : {}
    ),

    url: link.link,
    mode,
  };
}

function linkLanguage(title = '') {
  if (/دوبله/i.test(title)) {
    return 'دوبله فارسی';
  }

  if (/زیرنویس/i.test(title)) {
    return 'زیرنویس فارسی';
  }

  return 'نسخه اصلی';
}

function qualityLabel(title = '') {
  const text = String(title);

  const match = text.match(
    /(HQ[_\s-]*1080|2160|1440|1080|720|480|360)/i,
  );

  if (!match) {
    return cleanText(
      text ||
      'کیفیت اصلی',
    );
  }

  const value = match[1]
    .toUpperCase()
    .replace(
      /[\s-]+/g,
      '_',
    );

  return value.includes('HQ')
    ? 'HQ 1080p'
    : `${value}p`;
}

function qualityRank(title = '') {
  const quality = qualityLabel(title);

  if (/360/.test(quality)) return 360;
  if (/480/.test(quality)) return 480;
  if (/720/.test(quality)) return 720;
  if (/1080/.test(quality)) return 1080;
  if (/HQ/.test(quality)) return 1180;
  if (/1440/.test(quality)) return 1440;
  if (/2160/.test(quality)) return 2160;

  return 0;
}

function highestQuality(links) {
  return [...links].sort(
    (a, b) =>
      qualityRank(b.title) -
      qualityRank(a.title),
  )[0] || null;
}

function uniqueByUrl(links) {
  const seen = new Set();

  return links.filter((link) => {
    if (
      !link?.link ||
      seen.has(link.link)
    ) {
      return false;
    }

    seen.add(link.link);
    return true;
  });
}

function mirroredExtension(contentType, sourceUrl) {
  const type = cleanText(contentType).toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('avif')) return '.avif';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  const match = cleanText(sourceUrl).match(/\.(jpe?g|png|webp|avif)(?:$|[?#])/i);
  return match ? `.${match[1].toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
}

function relativeMediaPath(kind, fileName) {
  return path.posix.join('assets', 'media', kind, fileName);
}

async function existingMirroredPath(kind, hash) {
  for (const extension of ['.jpg', '.png', '.webp', '.avif']) {
    const relative = relativeMediaPath(kind, `${hash}${extension}`);
    try {
      await fs.access(path.join(root, ...relative.split('/')));
      return relative;
    } catch {
      // Continue checking extensions.
    }
  }
  return '';
}

async function mirrorImageUrl(sourceUrl, kind) {
  const raw = cleanText(sourceUrl);
  if (!raw || /^(?:\.\/)?assets\/media\//i.test(raw)) return raw;
  if (!/^https?:\/\//i.test(raw) || /default\.jpg(?:$|[?#])/i.test(raw)) return raw;
  const normalizedUrl = raw.replace(/^http:\/\//i, 'https://');
  const hash = createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 28);
  const existing = await existingMirroredPath(kind, hash);
  if (existing) return existing;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
        'User-Agent': 'Aparatchi-Image-Mirror/1.0',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = cleanText(response.headers.get('content-type'));
    if (contentType && !contentType.toLowerCase().startsWith('image/')) {
      throw new Error(`Unexpected content type ${contentType}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 512 || buffer.length > 10 * 1024 * 1024) {
      throw new Error(`Invalid image size ${buffer.length}`);
    }
    const extension = mirroredExtension(contentType, normalizedUrl);
    const relative = relativeMediaPath(kind, `${hash}${extension}`);
    const absolute = path.join(root, ...relative.split('/'));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, buffer);
    stats.imagesMirrored += 1;
    return relative;
  } catch (error) {
    stats.imageMirrorErrors += 1;
    rememberError(`image-${kind}`, error);
    return normalizedUrl;
  } finally {
    clearTimeout(timeout);
  }
}

let mirroredImagesUsed = 0;
async function mirrorCatalogItemImages(item) {
  for (const [field, kind] of [
    ['poster', 'posters'],
    ['posterFallback', 'posters'],
    ['backdrop', 'backdrops'],
    ['backdropFallback', 'backdrops'],
  ]) {
    if (mirroredImagesUsed >= maxMirroredImagesPerRun) return;
    const value = cleanText(item?.[field]);
    if (!value || /^(?:\.\/)?assets\/media\//i.test(value)) continue;
    const next = await mirrorImageUrl(value, kind);
    mirroredImagesUsed += 1;
    if (next) item[field] = next;
  }
}

async function stageMirroredAssets() {
  try {
    await execFileAsync('git', ['add', '-f', '--', 'assets/media']);
  } catch {
    // Local syntax tests can run outside a Git repository.
  }
}

function imageUrl(file, folder) {
  if (!file) {
    return 'https://thumb.upera.tv/s3/posters/default.jpg';
  }

  if (/^https?:\/\//i.test(file)) {
    return file;
  }

  return (
    `https://thumb.upera.tv/s3/${folder}/` +
    String(file).replace(/^\/+/, '')
  );
}

function isHttp(url) {
  return (
    typeof url === 'string' &&
    /^https?:\/\//i.test(url)
  );
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\\r?\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(
      /[\s‌_-]+/g,
      '',
    );
}

function numericYear(value) {
  const year = Number(value);

  return (
    Number.isFinite(year) &&
    year > 1800
  )
    ? year
    : new Date().getUTCFullYear();
}

function isFiniteNumber(value) {
  return (
    value !== null &&
    value !== '' &&
    Number.isFinite(Number(value))
  );
}

function slugify(value) {
  return (
    String(value || 'item')
      .toLowerCase()
      .replace(
        /[^a-z0-9\u0600-\u06ff]+/g,
        '-',
      )
      .replace(
        /^-+|-+$/g,
        '',
      ) ||
    'item'
  );
}

function simpleHash(value) {
  let hash = 0;

  for (const char of String(value)) {
    hash =
      (
        (hash << 5) -
        hash +
        char.charCodeAt(0)
      ) | 0;
  }

  return Math.abs(hash).toString(36);
}

function toPersianDigits(value) {
  return String(value).replace(
    /\d/g,
    (digit) =>
      '۰۱۲۳۴۵۶۷۸۹'[Number(digit)],
  );
}

function dateString(
  value,
  fallback = '',
) {
  if (!value) return fallback;

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? fallback
    : date.toISOString();
}

function maxDate(...values) {
  const valid = values
    .map((value) =>
      dateString(value, ''),
    )
    .filter(Boolean)
    .sort();

  return (
    valid.at(-1) ||
    new Date().toISOString()
  );
}

function positiveInt(
  value,
  fallback,
) {
  const number = Number.parseInt(
    String(value ?? ''),
    10,
  );

  return (
    Number.isFinite(number) &&
    number > 0
  )
    ? number
    : fallback;
}

function nonNegativeInt(
  value,
  fallback,
) {
  const number = Number.parseInt(
    String(value ?? ''),
    10,
  );

  return (
    Number.isFinite(number) &&
    number >= 0
  )
    ? number
    : fallback;
}

function setQuery(url, params) {
  for (
    const [key, value]
    of Object.entries(params)
  ) {
    url.searchParams.set(
      key,
      value == null
        ? ''
        : String(value),
    );
  }
}

function nextPage(current, last) {
  return current >= Math.max(1, last)
    ? 1
    : current + 1;
}

function rememberError(
  scope,
  error,
) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  if (stats.errors.length < 100) {
    stats.errors.push({
      scope,
      message,
    });
  } else {
    stats.errorsTruncated += 1;
  }

  console.error(
    `[${scope}] ${message}`,
  );
}

function redact(url) {
  try {
    const parsed = new URL(url);

    if (
      parsed.searchParams.has('ref')
    ) {
      parsed.searchParams.set(
        'ref',
        '***',
      );
    }

    if (
      parsed.searchParams.has('token')
    ) {
      parsed.searchParams.set(
        'token',
        '***',
      );
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms),
  );
}

async function readJson(
  file,
  fallback,
) {
  try {
    return JSON.parse(
      await fs.readFile(
        file,
        'utf8',
      ),
    );
  } catch {
    return structuredClone(fallback);
  }
}

async function writeJson(
  file,
  value,
) {
  await fs.writeFile(
    file,
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}
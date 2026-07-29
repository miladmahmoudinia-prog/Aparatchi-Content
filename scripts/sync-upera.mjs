import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'https://seeko.film/api/v1';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const statePath = path.join(root, 'sync-state.json');
const reportPath = path.join(root, 'sync-report.json');
const collectionsPath = path.join(root, 'collections.json');

const refId = String(process.env.UPERA_REF_ID || '').trim();
const token = String(process.env.UPERA_TOKEN || '').trim();

const moviePagesPerRun = Math.min(
  3,
  positiveInt(process.env.MOVIE_PAGES_PER_RUN, 1),
);

const seriesPagesPerRun = Math.min(
  2,
  positiveInt(process.env.SERIES_PAGES_PER_RUN, 1),
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
  30,
);

const episodesPerSeriesRun = positiveInt(
  process.env.UPERA_EPISODES_PER_SERIES,
  8,
);

const seriesTitlesPerRun = positiveInt(
  process.env.UPERA_SERIES_TITLES_PER_RUN,
  1,
);

const maxIncrementalCandidates = positiveInt(
  process.env.UPERA_INCREMENTAL_LIMIT,
  10,
);

if (!refId) {
  throw new Error(
    'GitHub Secret با نام UPERA_REF_ID تنظیم نشده است.',
  );
}

const defaultCatalog = {
  version: '0.11.0-auto-collections',
  updatedAt: new Date(0).toISOString(),
  items: [],
  iranianSchedule: [],
  weeklySchedule: [],
};

const defaultCollections = {
  version: '1.0.0',
  collections: [],
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
const collectionConfig = await readJson(
  collectionsPath,
  defaultCollections,
);
const collectionIndex = buildCollectionIndex(
  collectionConfig,
);

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
  episodesProcessed: 0,

  moviesAddedOrUpdated: 0,
  seriesAddedOrUpdated: 0,

  affiliateRequests: 0,
  rateLimitHits: 0,
  rateLimitWaitMs: 0,
  skippedByBudget: 0,
  operatorLinksDetected: 0,
  collectionAssignments: 0,
  sourceCollectionAssignments: 0,
  manualCollectionAssignments: 0,
  preservedCollectionAssignments: 0,
  countryAssignments: 0,
  peopleAssignments: 0,

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
  version: '0.11.0-auto-collections',
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

    const seriesList = payload.items;

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

  if (!hasBasicMetadata(movie) || !hasPeopleMetadata(movie)) {
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
    !media.streamUrl &&
    !media.operatorFiles.length
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
        !media.streamUrl &&
        !media.operatorFiles.length
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

  replaceItem(normalized);
  stats.seriesAddedOrUpdated += 1;

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
  let movie = null;

  if (
    data?.movie &&
    typeof data.movie === 'object'
  ) {
    movie = data.movie;
  } else if (Array.isArray(data?.movies)) {
    movie = data.movies[0] || null;
  } else if (Array.isArray(data?.movies?.data)) {
    movie = data.movies.data[0] || null;
  } else if (data?.type === 'movie') {
    movie = data;
  }

  return mergePeopleContainers(movie, data);
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
    series: mergePeopleContainers(series, data),
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

  const operatorLinks = uniqueByUrl(
    freeLinks.filter(
      (link) => operatorLinkMode(link),
    ),
  );

  const operatorFiles = operatorLinks.map(
    (link) => toOperatorFile(
      link,
      operatorLinkMode(link),
    ),
  );

  stats.operatorLinksDetected +=
    operatorFiles.length;

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

  if (operatorFiles.length) {
    downloads.push({
      id: 'operator-mobile-access',
      title: 'ویژه اینترنت همراه',
      subtitle:
        'تماشا یا دریافت با اینترنت سیم‌کارت',
      badge: 'همراه',
      files: operatorFiles,
    });
  }

  const streamUrl =
    hls[0]?.link ||
    highestQuality(sortedMp4)?.link ||
    null;

  return {
    downloads,
    streamUrl,
    hls: hls[0]?.link || null,
    mp4: sortedMp4,
    operatorFiles,
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

  for (const file of media.operatorFiles) {
    files.push({
      ...file,
      id: `s${season}-e${number}-${file.id}`,
    });
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

  const countries = normalizeCountries(movie, existing);
  const ir = countries.countryCodes.includes('IR') || inferIranian(movie);
  ensureIranCountry(countries, ir);

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
      countries,
    );

  if (countries.countryCodes.length) {
    stats.countryAssignments += 1;
  }

  const collection = resolveMovieCollection(
    movie,
    existing,
  );

  if (collection) {
    stats.collectionAssignments += 1;

    if (collection.resolution === 'source') {
      stats.sourceCollectionAssignments += 1;
    } else if (collection.resolution === 'manual') {
      stats.manualCollectionAssignments += 1;
    } else if (collection.resolution === 'existing') {
      stats.preservedCollectionAssignments += 1;
    }
  }

  const people = normalizePeople(movie, existing);
  if (people.length) {
    stats.peopleAssignments += 1;
  }

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

    ...(countries.countryCodes.length
      ? { countryCodes: countries.countryCodes }
      : {}),

    ...(countries.countryLabels.length
      ? { countryLabels: countries.countryLabels }
      : {}),

    ...(countries.countryNames.length
      ? { countryNames: countries.countryNames }
      : {}),

    ...(collection
      ? {
          collectionId: collection.collectionId,
          collectionNameFa: collection.collectionNameFa,
          collectionName: collection.collectionName,
          ...(collection.collectionOrder > 0
            ? { collectionOrder: collection.collectionOrder }
            : {}),
        }
      : {}),

    ...(people.length ? { people } : {}),

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

    access:
      media.operatorFiles.length &&
      !media.downloads.some((group) =>
        group.files.some((file) =>
          file.mode === 'download' ||
          file.mode === 'play',
        ),
      ) &&
      !media.streamUrl
        ? 'operator'
        : 'free',

    operatorOnly: Boolean(
      media.operatorFiles.length &&
      !media.mp4.length &&
      !media.hls,
    ),

    operatorAccess:
      operatorAccessKind(
        media.operatorFiles,
      ),

    supportedOperators:
      media.operatorFiles.length
        ? defaultSupportedOperators()
        : [],

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
      withOperatorCategory(
        classification.categoryKeys,
        media.operatorFiles.length > 0,
      ),

    categoryLabels:
      withOperatorLabel(
        classification.categoryLabels,
        media.operatorFiles.length > 0,
      ),

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

  const countries = normalizeCountries(series, existing);
  const ir = countries.countryCodes.includes('IR') || inferIranian(series);
  ensureIranCountry(countries, ir);

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
      countries,
    );

  if (countries.countryCodes.length) {
    stats.countryAssignments += 1;
  }

  const people = normalizePeople(series, existing);
  if (people.length) {
    stats.peopleAssignments += 1;
  }

  const seasonNumbers = new Set(
    groups
      .map((group) =>
        Number(group.seasonNumber || 0),
      )
      .filter((value) => value > 0),
  );

  const seriesFiles = groups.flatMap(
    (group) =>
      Array.isArray(group.files)
        ? group.files
        : [],
  );

  const operatorFiles = seriesFiles.filter(
    (file) => isOperatorMode(file?.mode),
  );

  const directFiles = seriesFiles.filter(
    (file) => !isOperatorMode(file?.mode),
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

    ...(countries.countryCodes.length
      ? { countryCodes: countries.countryCodes }
      : {}),

    ...(countries.countryLabels.length
      ? { countryLabels: countries.countryLabels }
      : {}),

    ...(countries.countryNames.length
      ? { countryNames: countries.countryNames }
      : {}),

    ...(people.length ? { people } : {}),

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

    access:
      operatorFiles.length &&
      !directFiles.length
        ? 'operator'
        : 'free',

    operatorOnly: Boolean(
      operatorFiles.length &&
      !directFiles.length,
    ),

    operatorAccess:
      operatorAccessKind(
        operatorFiles,
      ),

    supportedOperators:
      operatorFiles.length
        ? defaultSupportedOperators()
        : [],
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
      withOperatorCategory(
        classification.categoryKeys,
        operatorFiles.length > 0,
      ),

    categoryLabels:
      withOperatorLabel(
        classification.categoryLabels,
        operatorFiles.length > 0,
      ),

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

function buildCollectionIndex(config) {
  const byImdb = new Map();
  const bySourceId = new Map();
  const definitions = Array.isArray(config?.collections)
    ? config.collections
    : [];

  for (const definition of definitions) {
    if (!definition || typeof definition !== 'object') continue;

    const collectionId = cleanText(definition.id);
    const collectionNameFa = cleanText(
      definition.nameFa ||
      definition.name_fa ||
      definition.name,
    );
    const collectionName = cleanText(
      definition.name ||
      definition.nameFa ||
      definition.name_fa,
    );

    if (!collectionId || !collectionNameFa) continue;

    const members = Array.isArray(definition.items)
      ? definition.items
      : [];

    for (const member of members) {
      if (!member || typeof member !== 'object') continue;

      const metadata = {
        collectionId,
        collectionNameFa,
        collectionName: collectionName || collectionNameFa,
        collectionOrder: collectionOrderNumber(
          member.order ??
          member.part ??
          member.sequence,
        ),
      };

      const imdb = normalizeImdbId(member.imdb);
      const sourceId = cleanText(
        member.sourceId ||
        member.source_id ||
        member.id,
      );

      if (imdb && !byImdb.has(imdb)) {
        byImdb.set(imdb, metadata);
      }

      if (sourceId && !bySourceId.has(sourceId)) {
        bySourceId.set(sourceId, metadata);
      }
    }
  }

  return {
    byImdb,
    bySourceId,
  };
}

function collectionOrderNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : 0;
}

function normalizeImdbId(value) {
  const match = cleanText(value).match(/tt\d+/i);
  return match ? match[0].toLowerCase() : '';
}

function resolveMovieCollection(movie, existing) {
  // اطلاعات رسمی منبع همیشه اولویت دارد؛ فایل دستی فقط
  // برای عناوینی استفاده می‌شود که API شناسهٔ مجموعه ندارد.
  const sourceCollection = sourceCollectionMetadata(movie);
  if (sourceCollection) {
    return {
      ...sourceCollection,
      resolution: 'source',
    };
  }

  const sourceId = cleanText(
    movie?.id ||
    movie?.t_id,
  );
  const imdb = normalizeImdbId(
    movie?.imdb ||
    existing?.imdb,
  );

  const manual =
    collectionIndex.bySourceId.get(sourceId) ||
    collectionIndex.byImdb.get(imdb);

  if (manual) {
    return {
      ...manual,
      resolution: 'manual',
    };
  }

  // اگر پاسخ جدید API ناقص بود، عضویت معتبر قبلی پاک نشود.
  if (existing?.collectionId) {
    return {
      collectionId: cleanText(existing.collectionId),
      collectionNameFa: cleanText(
        existing.collectionNameFa ||
        existing.collectionName,
      ),
      collectionName: cleanText(
        existing.collectionName ||
        existing.collectionNameFa,
      ),
      collectionOrder: collectionOrderNumber(
        existing.collectionOrder,
      ),
      resolution: 'existing',
    };
  }

  return null;
}

function sourceCollectionMetadata(movie) {
  if (!movie || typeof movie !== 'object') return null;

  const candidates = sourceCollectionCandidates(movie);

  for (const candidate of candidates) {
    const metadata = normalizeSourceCollectionCandidate(
      candidate,
      movie,
    );

    if (metadata) return metadata;
  }

  // بعضی پاسخ‌ها شناسه و نام مجموعه را به‌صورت فیلدهای
  // جدا در خود فیلم می‌فرستند.
  return normalizeSourceCollectionCandidate(
    {
      id:
        movie.collection_id ||
        movie.collectionId ||
        movie.franchise_id ||
        movie.franchiseId ||
        movie.tmdb_collection_id ||
        movie.tmdbCollectionId ||
        movie.set_id ||
        movie.setId,
      name_fa:
        movie.collection_name_fa ||
        movie.collectionNameFa ||
        movie.franchise_name_fa ||
        movie.franchiseNameFa,
      name:
        movie.collection_name ||
        movie.collectionName ||
        movie.franchise_name ||
        movie.franchiseName,
      order:
        movie.collection_order ||
        movie.collectionOrder ||
        movie.franchise_order ||
        movie.franchiseOrder ||
        movie.part ||
        movie.sequence ||
        movie.installment,
    },
    movie,
  );
}

function sourceCollectionCandidates(movie) {
  const candidates = [];

  const add = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }

    if (
      value &&
      typeof value === 'object'
    ) {
      candidates.push(value);
    }
  };

  add(movie.belongs_to_collection);
  add(movie.belongsToCollection);
  add(movie.collection);
  add(movie.collections);
  add(movie.franchise);
  add(movie.franchises);
  add(movie.movie_collection);
  add(movie.movieCollection);

  const nestedRoots = [
    movie.tmdb,
    movie.metadata,
    movie.meta,
    movie.details,
    movie.extra,
    movie.relationships,
  ];

  for (const root of nestedRoots) {
    if (!root || typeof root !== 'object') continue;

    add(root.belongs_to_collection);
    add(root.belongsToCollection);
    add(root.collection);
    add(root.collections);
    add(root.franchise);
    add(root.franchises);
    add(root.movie_collection);
    add(root.movieCollection);
  }

  return candidates;
}

function normalizeSourceCollectionCandidate(
  candidate,
  movie,
) {
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate)
  ) {
    return null;
  }

  const rawId = cleanText(
    candidate.id ||
    candidate.collection_id ||
    candidate.collectionId ||
    candidate.franchise_id ||
    candidate.franchiseId ||
    candidate.tmdb_collection_id ||
    candidate.tmdbCollectionId ||
    candidate.tmdb_id ||
    candidate.tmdbId ||
    candidate.set_id ||
    candidate.setId ||
    candidate.external_id ||
    candidate.externalId,
  );

  const nameFa = cleanText(
    candidate.name_fa ||
    candidate.nameFa ||
    candidate.title_fa ||
    candidate.titleFa ||
    candidate.collection_name_fa ||
    candidate.collectionNameFa ||
    candidate.franchise_name_fa ||
    candidate.franchiseNameFa ||
    candidate.name ||
    candidate.title,
  );

  const name = cleanText(
    candidate.name ||
    candidate.title ||
    candidate.collection_name ||
    candidate.collectionName ||
    candidate.franchise_name ||
    candidate.franchiseName ||
    candidate.name_fa ||
    candidate.nameFa ||
    nameFa,
  );

  // بدون شناسهٔ پایدار، از روی نام مجموعه حدس نمی‌زنیم.
  if (!rawId || !nameFa) return null;

  return {
    collectionId: `source-${slugify(rawId)}`,
    collectionNameFa: nameFa,
    collectionName: name || nameFa,
    collectionOrder: collectionOrderNumber(
      candidate.order ||
      candidate.collection_order ||
      candidate.collectionOrder ||
      candidate.franchise_order ||
      candidate.franchiseOrder ||
      candidate.part ||
      candidate.sequence ||
      candidate.number ||
      candidate.installment ||
      movie.collection_order ||
      movie.collectionOrder ||
      movie.franchise_order ||
      movie.franchiseOrder ||
      movie.part ||
      movie.sequence ||
      movie.installment,
    ),
  };
}

function classifyContent(
  type,
  ir,
  genres,
  countries = {},
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

  const countryCodes = Array.isArray(countries.countryCodes)
    ? countries.countryCodes
    : [];
  const countryLabels = Array.isArray(countries.countryLabels)
    ? countries.countryLabels
    : [];

  countryCodes.forEach((code, index) => {
    const normalizedCode = cleanText(code).toLowerCase();
    if (!/^[a-z]{2}$/.test(normalizedCode)) return;
    categoryKeys.push(`country-${normalizedCode}`);
    const label = cleanText(countryLabels[index]);
    if (label) categoryLabels.push(label);
  });

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

const COUNTRY_DEFINITIONS = [
  ['IR', 'ایران', 'Iran', ['iran', 'iranian', 'ایران', 'ایرانی']],
  ['KR', 'کره جنوبی', 'South Korea', ['south korea', 'korea', 'republic of korea', 'کره جنوبی', 'کره']],
  ['IN', 'هند', 'India', ['india', 'indian', 'هند', 'هندی']],
  ['US', 'آمریکا', 'United States', ['united states', 'united states of america', 'usa', 'u.s.a', 'america', 'آمریکا', 'ایالات متحده']],
  ['GB', 'بریتانیا', 'United Kingdom', ['united kingdom', 'uk', 'great britain', 'britain', 'england', 'بریتانیا', 'انگلستان']],
  ['TR', 'ترکیه', 'Turkey', ['turkey', 'türkiye', 'turkiye', 'ترکیه']],
  ['JP', 'ژاپن', 'Japan', ['japan', 'ژاپن']],
  ['CN', 'چین', 'China', ['china', 'mainland china', 'چین']],
  ['HK', 'هنگ‌کنگ', 'Hong Kong', ['hong kong', 'hongkong', 'هنگ کنگ', 'هنگ‌کنگ']],
  ['TW', 'تایوان', 'Taiwan', ['taiwan', 'تایوان']],
  ['TH', 'تایلند', 'Thailand', ['thailand', 'تایلند']],
  ['ID', 'اندونزی', 'Indonesia', ['indonesia', 'اندونزی']],
  ['PH', 'فیلیپین', 'Philippines', ['philippines', 'فیلیپین']],
  ['FR', 'فرانسه', 'France', ['france', 'فرانسه']],
  ['DE', 'آلمان', 'Germany', ['germany', 'آلمان']],
  ['ES', 'اسپانیا', 'Spain', ['spain', 'اسپانیا']],
  ['IT', 'ایتالیا', 'Italy', ['italy', 'ایتالیا']],
  ['CA', 'کانادا', 'Canada', ['canada', 'کانادا']],
  ['AU', 'استرالیا', 'Australia', ['australia', 'استرالیا']],
  ['RU', 'روسیه', 'Russia', ['russia', 'russian federation', 'روسیه']],
  ['BR', 'برزیل', 'Brazil', ['brazil', 'برزیل']],
  ['MX', 'مکزیک', 'Mexico', ['mexico', 'مکزیک']],
  ['AR', 'آرژانتین', 'Argentina', ['argentina', 'آرژانتین']],
  ['SE', 'سوئد', 'Sweden', ['sweden', 'سوئد']],
  ['NO', 'نروژ', 'Norway', ['norway', 'نروژ']],
  ['DK', 'دانمارک', 'Denmark', ['denmark', 'دانمارک']],
  ['FI', 'فنلاند', 'Finland', ['finland', 'فنلاند']],
  ['NL', 'هلند', 'Netherlands', ['netherlands', 'holland', 'هلند']],
  ['BE', 'بلژیک', 'Belgium', ['belgium', 'بلژیک']],
  ['CH', 'سوئیس', 'Switzerland', ['switzerland', 'سوئیس']],
  ['AT', 'اتریش', 'Austria', ['austria', 'اتریش']],
  ['PL', 'لهستان', 'Poland', ['poland', 'لهستان']],
  ['CZ', 'جمهوری چک', 'Czech Republic', ['czech republic', 'czechia', 'جمهوری چک', 'چک']],
  ['GR', 'یونان', 'Greece', ['greece', 'یونان']],
  ['PT', 'پرتغال', 'Portugal', ['portugal', 'پرتغال']],
  ['IE', 'ایرلند', 'Ireland', ['ireland', 'ایرلند']],
  ['NZ', 'نیوزیلند', 'New Zealand', ['new zealand', 'نیوزیلند']],
  ['ZA', 'آفریقای جنوبی', 'South Africa', ['south africa', 'آفریقای جنوبی']],
  ['AE', 'امارات', 'United Arab Emirates', ['united arab emirates', 'uae', 'امارات']],
  ['SA', 'عربستان سعودی', 'Saudi Arabia', ['saudi arabia', 'عربستان سعودی', 'عربستان']],
  ['EG', 'مصر', 'Egypt', ['egypt', 'مصر']],
  ['LB', 'لبنان', 'Lebanon', ['lebanon', 'لبنان']],
  ['IQ', 'عراق', 'Iraq', ['iraq', 'عراق']],
  ['PK', 'پاکستان', 'Pakistan', ['pakistan', 'پاکستان']],
  ['AF', 'افغانستان', 'Afghanistan', ['afghanistan', 'افغانستان']],
];

const COUNTRY_BY_ALIAS = new Map();
const COUNTRY_BY_CODE = new Map();

for (const [code, labelFa, name, aliases] of COUNTRY_DEFINITIONS) {
  const definition = { code, labelFa, name };
  COUNTRY_BY_CODE.set(code, definition);
  for (const alias of [code, labelFa, name, ...aliases]) {
    COUNTRY_BY_ALIAS.set(normalizeCountryAlias(alias), definition);
  }
}

function normalizeCountryAlias(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countryTokens(value, depth = 0) {
  if (value == null || depth > 5) return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry) => countryTokens(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const keys = [
      'code', 'iso_3166_1', 'iso2', 'country_code', 'countryCode',
      'name_fa', 'nameFa', 'title_fa', 'titleFa', 'name', 'title',
    ];
    return keys.flatMap((key) => countryTokens(value[key], depth + 1));
  }

  const text = cleanText(value);
  if (!text || /^0$/.test(text)) return [];

  return text
    .split(/[,،|;/]+/)
    .map((entry) => cleanText(entry))
    .filter(Boolean);
}

function countryDefinition(value) {
  const raw = cleanText(value);
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && COUNTRY_BY_CODE.has(upper)) {
    return COUNTRY_BY_CODE.get(upper);
  }

  return COUNTRY_BY_ALIAS.get(normalizeCountryAlias(raw)) || null;
}

function normalizeCountries(item, existing = {}) {
  const candidates = [
    item?.countryCodes,
    item?.country_codes,
    item?.countries,
    item?.country,
    item?.country_fa,
    item?.production_countries,
    item?.productionCountries,
    item?.origin_country,
    item?.originCountry,
    item?.country_code,
    item?.countryCode,
    existing?.countryCodes,
    existing?.countryLabels,
    existing?.countryNames,
  ];

  const result = [];
  const seen = new Set();

  for (const token of candidates.flatMap((value) => countryTokens(value))) {
    const definition = countryDefinition(token);
    if (!definition || seen.has(definition.code)) continue;
    seen.add(definition.code);
    result.push(definition);
  }

  return {
    countryCodes: result.map((entry) => entry.code),
    countryLabels: result.map((entry) => entry.labelFa),
    countryNames: result.map((entry) => entry.name),
  };
}

function ensureIranCountry(countries, ir) {
  if (!ir || countries.countryCodes.includes('IR')) return;
  const iran = COUNTRY_BY_CODE.get('IR');
  countries.countryCodes.unshift(iran.code);
  countries.countryLabels.unshift(iran.labelFa);
  countries.countryNames.unshift(iran.name);
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

function mergePeopleContainers(primary, container) {
  if (!primary || typeof primary !== 'object') return primary || null;
  if (!container || typeof container !== 'object' || container === primary) {
    return primary;
  }

  const keys = [
    'people', 'credits', 'cast', 'casts', 'actors', 'actor',
    'crew', 'directors', 'director', 'writers', 'writer', 'staff',
  ];

  const merged = { ...primary };
  for (const key of keys) {
    if (merged[key] == null && container[key] != null) {
      merged[key] = container[key];
    }
  }
  return merged;
}

function hasPeopleMetadata(item) {
  if (!item || typeof item !== 'object') return false;
  return [
    'people', 'credits', 'cast', 'casts', 'actors', 'actor',
    'crew', 'directors', 'director', 'writers', 'writer', 'staff',
  ].some((key) => {
    const value = item[key];
    return Array.isArray(value)
      ? value.length > 0
      : Boolean(value && typeof value === 'object');
  });
}

function personRole(value, fallback = '') {
  const text = cleanText(value).toLowerCase();
  if (/director|کارگردان|directing/.test(text)) return 'director';
  if (/actor|actress|cast|بازیگر|هنرپیشه/.test(text)) return 'actor';
  return fallback;
}

function personImageUrl(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) {
    return `https://image.tmdb.org/t/p/w342${raw}`;
  }
  return `https://thumb.upera.tv/s3/actors/${raw.replace(/^\/+/, '')}`;
}

function personEntries(value, fallbackRole = '', depth = 0) {
  if (value == null || depth > 4) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => personEntries(entry, fallbackRole, depth + 1));
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const name = cleanText(value);
    return name ? [{ name, role: fallbackRole }] : [];
  }
  if (typeof value !== 'object') return [];

  const nestedKeys = ['data', 'items', 'results', 'cast', 'crew', 'actors', 'directors'];
  const hasName = Boolean(
    value.name || value.name_fa || value.nameFa || value.full_name ||
    value.full_name_fa || value.title || value.title_fa,
  );

  if (!hasName) {
    return nestedKeys.flatMap((key) => {
      const role = key === 'cast' || key === 'actors'
        ? 'actor'
        : key === 'directors'
          ? 'director'
          : fallbackRole;
      return personEntries(value[key], role, depth + 1);
    });
  }

  return [{ ...value, role: personRole(
    value.role || value.job || value.department || value.known_for_department || value.type,
    fallbackRole,
  ) }];
}

function normalizePeople(item, existing = {}) {
  const sources = [
    ['directors', 'director'], ['director', 'director'],
    ['actors', 'actor'], ['actor', 'actor'], ['cast', 'actor'], ['casts', 'actor'],
    ['crew', ''], ['people', ''], ['credits', ''], ['staff', ''],
  ];

  const raw = sources.flatMap(([key, role]) => personEntries(item?.[key], role));
  const ownerId = cleanText(item?.id || item?.t_id || item?.series_id || 'item');
  const normalized = [];
  const seen = new Set();

  for (const entry of raw) {
    const role = personRole(
      entry?.role || entry?.job || entry?.department || entry?.known_for_department,
      '',
    );
    if (role !== 'actor' && role !== 'director') continue;

    const nameFa = cleanText(
      entry?.name_fa || entry?.nameFa || entry?.full_name_fa ||
      entry?.title_fa || entry?.titleFa || entry?.name || entry?.title,
    );
    const name = cleanText(
      entry?.name || entry?.full_name || entry?.title || nameFa,
    );
    if (!nameFa && !name) continue;

    const externalId = cleanText(
      entry?.person_id || entry?.personId || entry?.tmdb_id || entry?.tmdbId ||
      entry?.imdb || entry?.id || entry?.slug,
    );
    const image = personImageUrl(
      entry?.profile_path || entry?.profile || entry?.image || entry?.photo ||
      entry?.avatar || entry?.poster,
    );
    const character = cleanText(
      entry?.character || entry?.character_name || entry?.characterName ||
      entry?.role_name || entry?.as,
    );
    const key = externalId
      ? `${role}:${externalId}`
      : `${role}:${ownerId}:${normalizeName(nameFa || name)}:${simpleHash(image || name || nameFa)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      id: externalId
        ? `${role}-${externalId}`
        : `${role}-local-${slugify(ownerId)}-${simpleHash(`${nameFa || name}:${image}`)}`,
      nameFa: nameFa || name,
      name: name || nameFa,
      role,
      roleLabel: role === 'director' ? 'کارگردان' : 'بازیگر',
      ...(character ? { character } : {}),
      ...(image ? { image } : {}),
      order: nonNegativeInt(entry?.order ?? entry?.cast_order ?? entry?.castOrder, normalized.length),
    });
  }

  const previous = Array.isArray(existing?.people) ? existing.people : [];
  const knownIds = new Set(normalized.map((person) => String(person.id)));
  for (const person of previous) {
    if (!person?.id || knownIds.has(String(person.id))) continue;
    knownIds.add(String(person.id));
    normalized.push(person);
  }

  return normalized
    .sort((a, b) => {
      const roleDiff = (a.role === 'director' ? 0 : 1) - (b.role === 'director' ? 0 : 1);
      return roleDiff || Number(a.order || 0) - Number(b.order || 0);
    })
    .slice(0, 30);
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
            'Aparatchi-Catalog-Sync/0.7',

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


function operatorLinkMode(link) {
  if (!link || !isHttp(link.link)) {
    return null;
  }

  if (/\.(?:mp4|m3u8|vtt)(?:$|[?#])/i.test(link.link)) {
    return null;
  }

  let parsed;

  try {
    parsed = new URL(link.link);
  } catch {
    return null;
  }

  const metadata = cleanText(
    Object.values(link)
      .filter(
        (value) =>
          typeof value === 'string' ||
          typeof value === 'number',
      )
      .join(' '),
  );

  const explicitOperator =
    /اپراتور|اینترنت\s*همراه|همراه\s*اول|ایرانسل|رایتل|شاتل\s*موبایل|mobile\s*operator|operator/i.test(
      metadata,
    );

  const trustedOperatorPortal =
    /(^|\.)upera\.tv$/i.test(
      parsed.hostname,
    ) &&
    /^\/(?:stream|download)\/(?:movie|series|episode)\//i.test(
      parsed.pathname,
    );

  if (
    !explicitOperator &&
    !trustedOperatorPortal
  ) {
    return null;
  }

  return /download|دانلود|دریافت/i.test(
    `${parsed.pathname} ${metadata}`,
  )
    ? 'operator-download'
    : 'operator-play';
}

function toOperatorFile(link, mode) {
  const label = cleanText(
    link?.title ||
    link?.label ||
    (
      mode === 'operator-download'
        ? 'دریافت با اینترنت همراه'
        : 'پخش آنلاین با اینترنت همراه'
    ),
  );

  return {
    id: [
      'operator',
      mode === 'operator-download'
        ? 'download'
        : 'play',
      simpleHash(link.link),
    ].join('-'),

    quality:
      mode === 'operator-download'
        ? 'دریافت'
        : 'پخش آنلاین',

    label,
    url: link.link,
    mode,
    operatorOnly: true,
    supportedOperators:
      defaultSupportedOperators(),
  };
}

function isOperatorMode(mode) {
  return (
    mode === 'operator-play' ||
    mode === 'operator-download'
  );
}

function operatorAccessKind(files) {
  const hasStream = files.some(
    (file) =>
      file?.mode === 'operator-play',
  );

  const hasDownload = files.some(
    (file) =>
      file?.mode === 'operator-download',
  );

  if (hasStream && hasDownload) {
    return 'both';
  }

  if (hasStream) return 'stream';
  if (hasDownload) return 'download';
  return null;
}

function defaultSupportedOperators() {
  return [
    'همراه اول',
    'ایرانسل',
    'رایتل',
    'شاتل موبایل',
  ];
}

function withOperatorCategory(
  categoryKeys,
  enabled,
) {
  if (!enabled) return categoryKeys;

  return [
    ...new Set([
      ...categoryKeys,
      'mobile-operator',
    ]),
  ];
}

function withOperatorLabel(
  categoryLabels,
  enabled,
) {
  if (!enabled) return categoryLabels;

  return [
    ...new Set([
      ...categoryLabels,
      'ویژه اینترنت همراه',
    ]),
  ];
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
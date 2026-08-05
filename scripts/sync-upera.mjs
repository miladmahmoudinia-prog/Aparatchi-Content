import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const API_BASE = 'https://seeko.film/api/v1';
const IRANIAN_SERIES_SCAN_VERSION = 3;

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

const requestedSyncMode = String(
  process.env.UPERA_SYNC_MODE || 'AUTO',
).trim().toUpperCase();

const syncModeSetting = ['AUTO', 'BACKFILL', 'NORMAL'].includes(requestedSyncMode)
  ? requestedSyncMode
  : 'AUTO';

const maxBackfillNoProgressRuns = Math.min(
  10,
  positiveInt(process.env.UPERA_BACKFILL_MAX_NO_PROGRESS_RUNS, 3),
);

const backfillEpisodeLimit = Math.min(
  maxAffiliateRequests,
  positiveInt(process.env.UPERA_BACKFILL_EPISODES_PER_RUN, maxAffiliateRequests),
);

const retryBlockedBackfill = ['1', 'true', 'yes'].includes(
  String(process.env.UPERA_RETRY_BLOCKED || '').trim().toLowerCase(),
);

const maxEpisodePaginationPages = Math.min(
  100,
  positiveInt(process.env.UPERA_MAX_EPISODE_PAGES, 50),
);

const episodesPerSeriesRun = positiveInt(
  process.env.UPERA_EPISODES_PER_SERIES,
  10,
);

const seriesTitlesPerRun = positiveInt(
  process.env.UPERA_SERIES_TITLES_PER_RUN,
  6,
);


const airingSeriesTitlesPerRun = Math.min(
  12,
  positiveInt(process.env.UPERA_AIRING_SERIES_TITLES_PER_RUN, 6),
);

const incompleteSeriesTitlesPerRun = Math.min(
  4,
  positiveInt(process.env.UPERA_INCOMPLETE_SERIES_TITLES_PER_RUN, 2),
);

// Priority passes fill the two sections that used to stay empty:
// Iranian series and content that is free only on mobile operators.
const iranianSeriesPagesPerRun = Math.min(
  5,
  positiveInt(process.env.UPERA_IRANIAN_SERIES_PAGES_PER_RUN, 2),
);

const iranianSeriesTitlesPerRun = positiveInt(
  process.env.UPERA_IRANIAN_SERIES_TITLES_PER_RUN,
  8,
);

const operatorSeriesPagesPerRun = Math.min(
  5,
  positiveInt(process.env.UPERA_OPERATOR_SERIES_PAGES_PER_RUN, 2),
);

const operatorSeriesTitlesPerRun = positiveInt(
  process.env.UPERA_OPERATOR_SERIES_TITLES_PER_RUN,
  4,
);

const operatorMoviePagesPerRun = Math.min(
  5,
  positiveInt(process.env.UPERA_OPERATOR_MOVIE_PAGES_PER_RUN, 2),
);

const operatorMovieTitlesPerRun = positiveInt(
  process.env.UPERA_OPERATOR_MOVIE_TITLES_PER_RUN,
  5,
);

const priorityEpisodesPerSeries = Math.min(
  30,
  positiveInt(process.env.UPERA_PRIORITY_EPISODES_PER_SERIES, 24),
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
  version: '0.9.0-global-sequential-backfill',
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
  iranianSeriesPage: 1,
  iranianSeriesOffset: 0,
  iranianSeriesScanVersion: IRANIAN_SERIES_SCAN_VERSION,
  operatorSeriesPage: 1,
  operatorSeriesOffset: 0,
  operatorMoviePage: 1,
  operatorMovieOffset: 0,
  airingSeriesOffset: 0,
  seriesEpisodeCursor: {},
  archiveBackfillSeriesId: '',
  archiveBackfillSeriesTitle: '',
  archiveBackfillNoProgress: {},
  archiveBackfillCompleted: {},
  lastSyncAt: null,
};

const catalog = await readJson(catalogPath, defaultCatalog);
const state = await readJson(statePath, defaultState);

state.moviePage = positiveInt(state.moviePage, 1);
state.movieOffset = nonNegativeInt(state.movieOffset, 0);
state.seriesPage = positiveInt(state.seriesPage, 1);
state.seriesOffset = nonNegativeInt(state.seriesOffset, 0);
state.iranianSeriesPage = positiveInt(state.iranianSeriesPage, 1);
state.iranianSeriesOffset = nonNegativeInt(state.iranianSeriesOffset, 0);
if (Number(state.iranianSeriesScanVersion || 0) !== IRANIAN_SERIES_SCAN_VERSION) {
  state.iranianSeriesPage = 1;
  state.iranianSeriesOffset = 0;
  state.iranianSeriesScanVersion = IRANIAN_SERIES_SCAN_VERSION;
}
state.operatorSeriesPage = positiveInt(state.operatorSeriesPage, 1);
state.operatorSeriesOffset = nonNegativeInt(state.operatorSeriesOffset, 0);
state.operatorMoviePage = positiveInt(state.operatorMoviePage, 1);
state.operatorMovieOffset = nonNegativeInt(state.operatorMovieOffset, 0);
state.airingSeriesOffset = nonNegativeInt(state.airingSeriesOffset, 0);

if (
  !state.seriesEpisodeCursor ||
  typeof state.seriesEpisodeCursor !== 'object' ||
  Array.isArray(state.seriesEpisodeCursor)
) {
  state.seriesEpisodeCursor = {};
}

state.archiveBackfillSeriesId = String(state.archiveBackfillSeriesId || '');
state.archiveBackfillSeriesTitle = String(state.archiveBackfillSeriesTitle || '');
if (
  !state.archiveBackfillNoProgress ||
  typeof state.archiveBackfillNoProgress !== 'object' ||
  Array.isArray(state.archiveBackfillNoProgress)
) {
  state.archiveBackfillNoProgress = {};
}
if (
  !state.archiveBackfillCompleted ||
  typeof state.archiveBackfillCompleted !== 'object' ||
  Array.isArray(state.archiveBackfillCompleted)
) {
  state.archiveBackfillCompleted = {};
}

let items = Array.isArray(catalog.items)
  ? catalog.items.filter(Boolean)
  : [];

// Operator access is recomputed from validated files on every run. This
// removes stale badges/categories created by older, overly broad matching.
const operatorCleanup = sanitizeCatalogOperatorAccess(items);
items = operatorCleanup.items.map((item) => withSeriesPublicationState(item));

let lastAffiliateRequestAt = 0;
let affiliateRequestsUsed = 0;
let affiliateBudgetExhausted = false;

const stats = {
  startedAt: new Date().toISOString(),
  originalCount: items.length,
  finalCount: items.length,
  requestedSyncMode: syncModeSetting,
  effectiveSyncMode: '',
  backfillQueueTotal: 0,
  backfillBacklogRemaining: 0,
  backfillBlockedTotal: 0,
  backfillActiveSeries: null,
  backfillSeriesCompletedThisRun: [],
  backfillSeriesBlockedThisRun: [],
  backfillEpisodesAdded: 0,
  backfillNoProgressRuns: 0,
  normalSyncSkippedForBackfill: false,
  backfillOrdering: 'oldest-to-newest-global',
  backfillNextSeries: null,
  episodePaginationPagesFetched: 0,
  episodePaginationErrors: 0,
  episodePaginationTruncated: 0,
  episodeDiscoveryIncomplete: 0,

  incrementalCandidates: 0,
  incrementalProcessed: 0,

  moviePagesProcessed: 0,
  movieTitlesProcessed: 0,

  seriesPagesProcessed: 0,
  seriesTitlesProcessed: 0,
  airingSeriesCandidates: 0,
  airingSeriesChecked: 0,
  airingSeriesUpdated: 0,
  incompleteSeriesCandidates: 0,
  incompleteSeriesRepaired: 0,
  incompleteSeriesStillMissing: 0,
  seriesHiddenUntilComplete: 0,
  seriesPublishedAfterCompletion: 0,
  airingSeriesKeptPublished: 0,
  seriesAwaitingArchiveAudit: 0,
  iranianSeriesProcessed: 0,
  episodesProcessed: 0,

  iranianSeriesPagesProcessed: 0,
  iranianSeriesCandidates: 0,
  iranianSeriesAddedOrUpdated: 0,
  iranianSeriesRejectedNotIranian: 0,
  iranianSeriesRejectedNoLinks: 0,

  operatorSeriesPagesProcessed: 0,
  operatorSeriesCandidates: 0,
  operatorSeriesAddedOrUpdated: 0,
  operatorSeriesRejectedNoOperatorLink: 0,

  operatorMoviePagesProcessed: 0,
  operatorMovieCandidates: 0,
  operatorMoviesAddedOrUpdated: 0,
  operatorMoviesRejectedNoOperatorLink: 0,
  operatorLinksFound: 0,
  operatorClassificationsRemoved: operatorCleanup.removed,
  iranianSeriesDiagnostics: [],
  operatorDiagnostics: [],
  seriesEpisodeDiagnostics: [],
  catalogEpisodeGapDiagnostics: [],
  episodesDiscovered: 0,
  episodeGroupsAdded: 0,
  episodesRejectedNoLinks: 0,

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

const initialBackfillQueue = buildSequentialBackfillQueue();
stats.backfillQueueTotal = initialBackfillQueue.length;

const effectiveSyncMode =
  syncModeSetting === 'BACKFILL' ||
  (syncModeSetting === 'AUTO' && initialBackfillQueue.length > 0)
    ? 'BACKFILL'
    : 'NORMAL';

stats.effectiveSyncMode = effectiveSyncMode;
console.log(`حالت اجرا: ${effectiveSyncMode}`);

if (effectiveSyncMode === 'BACKFILL') {
  // The archive queue is intentionally exclusive: one series is completed
  // as far as the request budget allows before the next series is selected.
  // No new movie/series archive pages are scanned in this mode, so repeated
  // runs shrink the existing backlog instead of continuously adding more
  // incomplete titles.
  stats.normalSyncSkippedForBackfill = true;
  await syncSequentialSeriesBackfill();

  // If the active archive finished before the request budget was consumed,
  // keep already-published weekly series current without discovering titles.
  if (!affiliateBudgetExhausted) {
    await syncAiringSeriesUpdates();
  }
} else {
  // Normal mode is used only after the current archive queue is empty (or
  // when explicitly forced). Existing airing series are checked first.
  await syncAiringSeriesUpdates();

  if (!affiliateBudgetExhausted) {
    await syncIranianSeriesArchive();
  }

  if (!affiliateBudgetExhausted) {
    await syncOperatorSeriesArchive();
  }

  if (!affiliateBudgetExhausted) {
    await syncOperatorMovieArchive();
  }

  if (!affiliateBudgetExhausted) {
    await syncIncrementalTitles();
  }

  if (!affiliateBudgetExhausted) {
    await syncSeriesArchive();
  }

  if (!affiliateBudgetExhausted) {
    await syncMovieArchive();
  }
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

// Recompute publication state for every series, including titles that were
// not touched during this run. Old/finished series stay hidden until every
// discovered episode has a usable link. Already-published airing series stay
// visible while a newly released tail episode is being fetched, but historical
// gaps still hide them.
items = items.map((item) => withSeriesPublicationState(item));
stats.seriesAwaitingArchiveAudit = items.filter(
  (item) => item?.type === 'series' && !hasSeriesArchiveMetadata(item),
).length;
stats.backfillBacklogRemaining = buildSequentialBackfillQueue().length;
stats.backfillBlockedTotal = items.filter(
  (item) => item?.type === 'series' && item?.archiveAuditStatus === 'blocked',
).length;

const publishableIds = new Set(
  items
    .filter((item) => item?.type !== 'series' || item?.publicationStatus === 'published')
    .map((item) => String(item.id)),
);

const scheduleEntryIsCurrent = (entry) => {
  if (!entry?.itemId) return false;
  const item = items.find((candidate) => String(candidate?.id) === String(entry.itemId));
  return Boolean(
    item?.type === 'series' &&
    item?.publicationStatus === 'published' &&
    item?.isAiring,
  );
};

const iranianSchedule = Array.isArray(
  catalog.iranianSchedule,
)
  ? catalog.iranianSchedule.filter(
      (entry) =>
        activeIds.has(String(entry?.itemId || '')) &&
        publishableIds.has(String(entry?.itemId || '')) &&
        scheduleEntryIsCurrent(entry),
    )
  : [];

const weeklySchedule = Array.isArray(
  catalog.weeklySchedule,
)
  ? catalog.weeklySchedule.filter(
      (entry) =>
        activeIds.has(String(entry?.itemId || '')) &&
        publishableIds.has(String(entry?.itemId || '')) &&
        scheduleEntryIsCurrent(entry),
    )
  : [];

stats.catalogEpisodeGapDiagnostics = buildCatalogEpisodeGapDiagnostics(items);

const now = new Date().toISOString();

const output = {
  ...catalog,
  version: '0.9.0-global-sequential-backfill',
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


async function syncAiringSeriesUpdates() {
  const candidates = items
    .filter((item) =>
      item?.type === 'series' &&
      item?.isAiring === true &&
      item?.publicationStatus === 'published'
    )
    .sort((a, b) =>
      String(b?.updatedAt || b?.sourceUpdatedAt || '').localeCompare(
        String(a?.updatedAt || a?.sourceUpdatedAt || ''),
      ),
    );

  stats.airingSeriesCandidates = candidates.length;
  if (!candidates.length) {
    state.airingSeriesOffset = 0;
    return;
  }

  const start = state.airingSeriesOffset % candidates.length;
  const selected = Array.from(
    { length: Math.min(airingSeriesTitlesPerRun, candidates.length) },
    (_, index) => candidates[(start + index) % candidates.length],
  );

  let checked = 0;
  for (const item of selected) {
    if (affiliateBudgetExhausted) break;
    try {
      const result = await processSeries(
        { id: item.id, type: 'series' },
        'airing-refresh',
        {
          episodeStrategy: 'latest',
          episodeLimit: 6,
          onlyMissing: true,
        },
      );
      checked += 1;
      stats.airingSeriesChecked += 1;
      if (Number(result?.addedEpisodes || 0) > 0) {
        stats.airingSeriesUpdated += 1;
      }
    } catch (error) {
      rememberError(`airing-series-${item?.id || 'unknown'}`, error);
      checked += 1;
      stats.airingSeriesChecked += 1;
    }
  }

  state.airingSeriesOffset = candidates.length
    ? (start + checked) % candidates.length
    : 0;
}


async function syncSequentialSeriesBackfill() {
  let completedInThisRun = 0;

  while (!affiliateBudgetExhausted) {
    const queue = buildSequentialBackfillQueue();
    stats.incompleteSeriesCandidates = queue.length;
    stats.backfillQueueTotal = Math.max(stats.backfillQueueTotal, queue.length);

    if (!queue.length) {
      clearActiveBackfillSeries();
      break;
    }

    const active = chooseActiveBackfillSeries(queue);
    if (!active) break;

    const id = String(active.item.id || '');
    const title = active.item.nameFa || active.item.name || id;
    state.archiveBackfillSeriesId = id;
    state.archiveBackfillSeriesTitle = title;
    stats.backfillActiveSeries = {
      id,
      title,
      year: seriesBackfillYear(active.item),
      country: cleanText(
        active.item?.country ||
        active.item?.countryName ||
        (active.item?.ir ? 'IR' : ''),
      ),
      missingBefore: active.deficit.missing,
      pendingBefore: active.deficit.pending,
      noProgressRuns: nonNegativeInt(state.archiveBackfillNoProgress[id], 0),
    };

    const nextEntry = queue.find((entry) => String(entry.item?.id || '') !== id);
    stats.backfillNextSeries = nextEntry
      ? {
          id: String(nextEntry.item?.id || ''),
          title: nextEntry.item?.nameFa || nextEntry.item?.name || '',
          year: seriesBackfillYear(nextEntry.item),
        }
      : null;

    console.log(`تکمیل ترتیبی سریال: ${title}`);

    const beforeTotal = active.deficit.total;
    let result;
    try {
      result = await processSeries(
        { id, type: 'series' },
        'sequential-backfill',
        {
          episodeStrategy: 'latest',
          episodeLimit: Math.max(1, Math.min(
            backfillEpisodeLimit,
            maxAffiliateRequests - affiliateRequestsUsed,
          )),
          onlyMissing: true,
        },
      );
    } catch (error) {
      rememberError(`sequential-backfill-${id || 'unknown'}`, error);
      result = { added: false, addedEpisodes: 0, reason: 'request-error' };
    }

    const refreshed = items.find((item) =>
      item?.type === 'series' && String(item.id) === id,
    );
    const remaining = seriesArchiveDeficit(refreshed);
    const addedEpisodes = Number(result?.addedEpisodes || 0);
    stats.backfillEpisodesAdded += addedEpisodes;

    const completed = Boolean(
      refreshed?.archiveComplete === true &&
      refreshed?.publicationStatus === 'published' &&
      remaining.total === 0,
    );
    const progressed = Boolean(
      addedEpisodes > 0 ||
      remaining.total < beforeTotal ||
      completed,
    );

    if (completed) {
      stats.incompleteSeriesRepaired += 1;
      stats.backfillSeriesCompletedThisRun.push({ id, title });
      state.archiveBackfillCompleted[id] = new Date().toISOString();
      delete state.archiveBackfillNoProgress[id];
      clearActiveBackfillSeries();
      completedInThisRun += 1;

      rememberDiagnostic('seriesEpisodeDiagnostics', {
        seriesId: id,
        title,
        source: 'sequential-backfill-summary',
        missingBefore: active.deficit.missing,
        pendingBefore: active.deficit.pending,
        missingAfter: remaining.missing,
        pendingAfter: remaining.pending,
        publicationStatus: refreshed?.publicationStatus || '',
        result: 'completed',
      });

      // Continue directly to the next series only when budget remains. The
      // queue is always processed one title at a time.
      if (affiliateBudgetExhausted) break;
      continue;
    }

    stats.incompleteSeriesStillMissing += 1;

    if (progressed) {
      state.archiveBackfillNoProgress[id] = 0;
    } else if (!affiliateBudgetExhausted) {
      state.archiveBackfillNoProgress[id] =
        nonNegativeInt(state.archiveBackfillNoProgress[id], 0) + 1;
    }

    const noProgressRuns = nonNegativeInt(state.archiveBackfillNoProgress[id], 0);
    stats.backfillNoProgressRuns = noProgressRuns;

    if (
      !affiliateBudgetExhausted &&
      noProgressRuns >= maxBackfillNoProgressRuns
    ) {
      markSeriesBackfillBlocked(id, {
        reason: result?.reason || 'no-progress',
        missing: remaining.missing,
        pending: remaining.pending,
        attempts: noProgressRuns,
      });
      stats.backfillSeriesBlockedThisRun.push({
        id,
        title,
        reason: result?.reason || 'no-progress',
        attempts: noProgressRuns,
      });
      clearActiveBackfillSeries();

      rememberDiagnostic('seriesEpisodeDiagnostics', {
        seriesId: id,
        title,
        source: 'sequential-backfill-summary',
        missingBefore: active.deficit.missing,
        pendingBefore: active.deficit.pending,
        missingAfter: remaining.missing,
        pendingAfter: remaining.pending,
        publicationStatus: 'building-archive',
        result: 'blocked-after-no-progress',
        attempts: noProgressRuns,
      });

      // Move to the next series only after the current one has been explicitly
      // marked blocked. It stays hidden from the app and is listed in report.
      continue;
    }

    rememberDiagnostic('seriesEpisodeDiagnostics', {
      seriesId: id,
      title,
      source: 'sequential-backfill-summary',
      missingBefore: active.deficit.missing,
      pendingBefore: active.deficit.pending,
      missingAfter: remaining.missing,
      pendingAfter: remaining.pending,
      publicationStatus: refreshed?.publicationStatus || '',
      result: affiliateBudgetExhausted ? 'paused-by-budget' : 'still-in-progress',
      addedEpisodes,
      noProgressRuns,
    });

    // The current title remains active for the next workflow run. Do not jump
    // to another title while this one is incomplete.
    break;
  }

  if (completedInThisRun > 0) {
    console.log(`${completedInThisRun} سریال در این اجرا کامل شد.`);
  }
}

function buildSequentialBackfillQueue() {
  return items
    .filter((item) => item?.type === 'series')
    .map((item, catalogIndex) => ({
      item,
      catalogIndex,
      deficit: seriesArchiveDeficit(item),
    }))
    .filter((entry) => {
      const blocked = entry.item?.archiveAuditStatus === 'blocked';
      if (blocked && !retryBlockedBackfill) return false;
      return (
        entry.deficit.total > 0 ||
        entry.item?.publicationStatus !== 'published' ||
        !hasSeriesArchiveMetadata(entry.item)
      );
    })
    .sort((a, b) => {
      const activeId = String(state.archiveBackfillSeriesId || '');
      const aActive = String(a.item?.id || '') === activeId;
      const bActive = String(b.item?.id || '') === activeId;
      if (aActive !== bActive) return aActive ? -1 : 1;

      // Country never affects the queue. Iranian, Korean, Turkish, American
      // and every other series are ordered together from oldest to newest.
      const yearDiff = seriesBackfillYear(a.item) - seriesBackfillYear(b.item);
      if (yearDiff) return yearDiff;

      const dateDiff =
        seriesBackfillTimestamp(a.item) -
        seriesBackfillTimestamp(b.item);
      if (dateDiff) return dateDiff;

      const titleDiff = String(a.item?.nameFa || a.item?.name || '').localeCompare(
        String(b.item?.nameFa || b.item?.name || ''),
        'fa',
      );
      if (titleDiff) return titleDiff;

      return a.catalogIndex - b.catalogIndex;
    });
}

function seriesBackfillYear(item) {
  const year = Number(item?.year);
  return Number.isInteger(year) && year >= 1900 && year <= 2100
    ? year
    : 9999;
}

function seriesBackfillTimestamp(item) {
  for (const candidate of [
    item?.sourceCreatedAt,
    item?.createdAt,
    item?.firstSeenAt,
  ]) {
    const timestamp = Date.parse(String(candidate || ''));
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return Number.MAX_SAFE_INTEGER;
}

function chooseActiveBackfillSeries(queue) {
  const activeId = String(state.archiveBackfillSeriesId || '');
  if (activeId) {
    const active = queue.find((entry) => String(entry.item?.id || '') === activeId);
    if (active) return active;
    clearActiveBackfillSeries();
  }
  return queue[0] || null;
}

function clearActiveBackfillSeries() {
  state.archiveBackfillSeriesId = '';
  state.archiveBackfillSeriesTitle = '';
}

function markSeriesBackfillBlocked(id, detail = {}) {
  const item = items.find((candidate) =>
    candidate?.type === 'series' && String(candidate.id) === String(id),
  );
  if (!item) return;

  replaceItem({
    ...item,
    archiveComplete: false,
    publicationStatus: 'building-archive',
    archiveAuditStatus: 'blocked',
    archiveBlockedReason: String(detail.reason || 'no-progress'),
    archiveBlockedAttempts: nonNegativeInt(detail.attempts, 0),
    archiveBlockedMissing: Array.isArray(detail.missing) ? detail.missing.slice(0, 100) : [],
    archiveBlockedPending: nonNegativeInt(detail.pending, 0),
    archiveBlockedAt: new Date().toISOString(),
  });
}

async function syncIranianSeriesArchive() {
  let completedPages = 0;
  let visitedTitles = 0;
  const seenPages = new Set();

  while (
    completedPages < iranianSeriesPagesPerRun &&
    visitedTitles < iranianSeriesTitlesPerRun &&
    !affiliateBudgetExhausted
  ) {
    const page = positiveInt(state.iranianSeriesPage, 1);
    if (seenPages.has(page)) break;
    seenPages.add(page);
    let payload;

    try {
      payload = await fetchIranianSeriesPage(page);
    } catch (error) {
      rememberError(`iranian-series-page-${page}`, error);
      break;
    }

    const candidates = dedupeCandidates(payload.items)
      .sort((a, b) => Number(inferIranian(b)) - Number(inferIranian(a)));

    if (!candidates.length) {
      state.iranianSeriesPage = nextPage(page, payload.lastPage);
      state.iranianSeriesOffset = 0;
      completedPages += 1;
      stats.iranianSeriesPagesProcessed += 1;
      continue;
    }

    let offset = nonNegativeInt(state.iranianSeriesOffset, 0);
    if (offset >= candidates.length) offset = 0;

    while (
      offset < candidates.length &&
      visitedTitles < iranianSeriesTitlesPerRun &&
      !affiliateBudgetExhausted
    ) {
      const series = candidates[offset];
      stats.iranianSeriesCandidates += 1;
      let retryLater = false;

      try {
        const result = await processSeries(series, 'iranian-priority', {
          requireIranian: true,
          episodeStrategy: 'latest',
          episodeLimit: priorityEpisodesPerSeries,
        });
        retryLater = Boolean(result?.retryLater);
        rememberDiagnostic('iranianSeriesDiagnostics', {
          id: String(series?.id || series?.t_id || ''),
          title: cleanText(series?.name_fa || series?.name || ''),
          result: result?.added ? 'added-or-updated' : 'rejected',
          reason: result?.reason || '',
          retryLater,
        });
      } catch (error) {
        rememberError(
          `iranian-series-${series?.id || series?.t_id || 'unknown'}`,
          error,
        );
      }

      if (retryLater) break;

      offset += 1;
      visitedTitles += 1;
      state.iranianSeriesOffset = offset;
    }

    if (offset >= candidates.length) {
      state.iranianSeriesPage = nextPage(page, payload.lastPage);
      state.iranianSeriesOffset = 0;
      completedPages += 1;
      stats.iranianSeriesPagesProcessed += 1;
    } else {
      break;
    }
  }
}

async function syncOperatorSeriesArchive() {
  let completedPages = 0;
  let visitedTitles = 0;
  const seenPages = new Set();

  while (
    completedPages < operatorSeriesPagesPerRun &&
    visitedTitles < operatorSeriesTitlesPerRun &&
    !affiliateBudgetExhausted
  ) {
    const page = positiveInt(state.operatorSeriesPage, 1);
    if (seenPages.has(page)) break;
    seenPages.add(page);
    let payload;

    try {
      payload = await fetchOperatorSeriesPage(page);
    } catch (error) {
      rememberError(`operator-series-page-${page}`, error);
      break;
    }

    const candidates = dedupeCandidates(payload.items);
    if (!candidates.length) {
      state.operatorSeriesPage = nextPage(page, payload.lastPage);
      state.operatorSeriesOffset = 0;
      completedPages += 1;
      stats.operatorSeriesPagesProcessed += 1;
      continue;
    }

    let offset = nonNegativeInt(state.operatorSeriesOffset, 0);
    if (offset >= candidates.length) offset = 0;

    while (
      offset < candidates.length &&
      visitedTitles < operatorSeriesTitlesPerRun &&
      !affiliateBudgetExhausted
    ) {
      const series = candidates[offset];
      stats.operatorSeriesCandidates += 1;
      let retryLater = false;

      try {
        const result = await processSeries(series, 'operator-priority', {
          requireOperator: true,
          episodeStrategy: 'latest',
          episodeLimit: priorityEpisodesPerSeries,
        });
        retryLater = Boolean(result?.retryLater);
        rememberDiagnostic('operatorDiagnostics', {
          type: 'series',
          id: String(series?.id || series?.t_id || ''),
          title: cleanText(series?.name_fa || series?.name || ''),
          result: result?.added ? 'added-or-updated' : 'rejected',
          reason: result?.reason || '',
          retryLater,
        });
      } catch (error) {
        rememberError(
          `operator-series-${series?.id || series?.t_id || 'unknown'}`,
          error,
        );
      }

      if (retryLater) break;

      offset += 1;
      visitedTitles += 1;
      state.operatorSeriesOffset = offset;
    }

    if (offset >= candidates.length) {
      state.operatorSeriesPage = nextPage(page, payload.lastPage);
      state.operatorSeriesOffset = 0;
      completedPages += 1;
      stats.operatorSeriesPagesProcessed += 1;
    } else {
      break;
    }
  }
}

async function syncOperatorMovieArchive() {
  let completedPages = 0;
  let visitedTitles = 0;
  const seenPages = new Set();

  while (
    completedPages < operatorMoviePagesPerRun &&
    visitedTitles < operatorMovieTitlesPerRun &&
    !affiliateBudgetExhausted
  ) {
    const page = positiveInt(state.operatorMoviePage, 1);
    if (seenPages.has(page)) break;
    seenPages.add(page);
    let payload;

    try {
      payload = await fetchOperatorMoviePage(page);
    } catch (error) {
      rememberError(`operator-movie-page-${page}`, error);
      break;
    }

    const candidates = dedupeCandidates(payload.items);
    if (!candidates.length) {
      state.operatorMoviePage = nextPage(page, payload.lastPage);
      state.operatorMovieOffset = 0;
      completedPages += 1;
      stats.operatorMoviePagesProcessed += 1;
      continue;
    }

    let offset = nonNegativeInt(state.operatorMovieOffset, 0);
    if (offset >= candidates.length) offset = 0;

    while (
      offset < candidates.length &&
      visitedTitles < operatorMovieTitlesPerRun &&
      !affiliateBudgetExhausted
    ) {
      const movie = candidates[offset];
      stats.operatorMovieCandidates += 1;
      let retryLater = false;

      try {
        const result = await processMovie(movie, 'operator-priority', {
          requireOperator: true,
        });
        retryLater = Boolean(result?.retryLater);
        rememberDiagnostic('operatorDiagnostics', {
          type: 'movie',
          id: String(movie?.id || movie?.t_id || ''),
          title: cleanText(movie?.name_fa || movie?.name || ''),
          result: result?.added ? 'added-or-updated' : 'rejected',
          reason: result?.reason || '',
          retryLater,
        });
      } catch (error) {
        rememberError(
          `operator-movie-${movie?.id || movie?.t_id || 'unknown'}`,
          error,
        );
      }

      if (retryLater) break;

      offset += 1;
      visitedTitles += 1;
      state.operatorMovieOffset = offset;
    }

    if (offset >= candidates.length) {
      state.operatorMoviePage = nextPage(page, payload.lastPage);
      state.operatorMovieOffset = 0;
      completedPages += 1;
      stats.operatorMoviePagesProcessed += 1;
    } else {
      break;
    }
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

async function processMovie(candidate, source, options = {}) {
  const id = candidate?.id || candidate?.t_id;

  if (!id) {
    return { retryLater: false, added: false, reason: 'missing-id' };
  }

  let movie = candidate;

  if (!hasBasicMetadata(movie)) {
    movie = await fetchMovieDetail(id);
  }

  if (!movie) {
    return { retryLater: false, added: false, reason: 'missing-detail' };
  }

  if (options.requireIranian && !inferIranian(movie)) {
    return { retryLater: false, added: false, reason: 'not-iranian' };
  }

  const linkResult = await fetchAffiliateLinks(id, 'movie');

  if (linkResult.skipped) {
    return { retryLater: true, added: false, reason: 'request-budget' };
  }

  const media = parseMediaLinks(linkResult.links);

  if (options.requireOperator && !media.operatorFiles.length) {
    stats.operatorMoviesRejectedNoOperatorLink += 1;
    return { retryLater: false, added: false, reason: 'no-operator-link' };
  }

  if (!media.downloads.length && !media.streamUrl) {
    console.log(
      `فیلم ${id} لینک رایگان مستقیم یا ویژه اینترنت همراه نداشت؛ مورد قبلی حذف نشد.`,
    );

    return { retryLater: false, added: false, reason: 'no-usable-links' };
  }

  const existing = findExistingItem(movie, 'movie');
  const normalized = normalizeMovie(movie, media, source, existing);

  replaceItem(normalized);
  stats.moviesAddedOrUpdated += 1;

  if (media.operatorFiles.length) {
    stats.operatorLinksFound += media.operatorFiles.length;
    if (source === 'operator-priority') {
      stats.operatorMoviesAddedOrUpdated += 1;
    }
  }

  return { retryLater: false, added: true, reason: 'added-or-updated' };
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
    return { retryLater: false, completeBackfill: true, added: false, reason: 'missing-id' };
  }

  const detail = await fetchSeriesDetail(id);
  const series = detail.series;
  const episodeDiscoveryComplete = detail.episodeDiscoveryComplete !== false;

  if (!series) {
    return { retryLater: false, completeBackfill: true, added: false, reason: 'missing-detail' };
  }

  const iranian = inferIranian(series);
  if (options.requireIranian && !iranian) {
    stats.iranianSeriesRejectedNotIranian += 1;
    return { retryLater: false, completeBackfill: true, added: false, reason: 'not-iranian' };
  }

  const episodes = detail.episodes
    .filter(
      (episode) =>
        episode &&
        episode.id &&
        Number(episode.show ?? 1) !== 0,
    )
    .sort(compareEpisodes);

  const existing = findExistingItem(series, 'series');
  const previousGroups = Array.isArray(existing?.downloads)
    ? existing.downloads
    : [];
  const mergedGroups = [...previousGroups];

  let selectedEpisodes = [];
  let cursor = 0;

  const missingEpisodes = episodes
    .filter((episode) => !findEpisodeGroup(previousGroups, episode))
    .sort(compareEpisodes);
  const changedExistingEpisodes = episodes
    .filter((episode) => findEpisodeGroup(previousGroups, episode))
    .filter((episode) => episodeNeedsRefresh(episode, previousGroups))
    .sort((a, b) =>
      String(b.updated_at || b.created_at || '').localeCompare(
        String(a.updated_at || a.created_at || ''),
      ),
    );

  if (options.onlyEpisodeId) {
    const matched = episodes.find(
      (episode) => String(episode.id) === String(options.onlyEpisodeId),
    );
    if (matched) selectedEpisodes = [matched];
  } else if (options.episodeStrategy === 'latest') {
    const limit = positiveInt(options.episodeLimit, priorityEpisodesPerSeries);
    // Completeness comes first: fill missing old/gap episodes before refreshing
    // already-known recent episodes. This prevents lists such as 5,6,7,10.
    selectedEpisodes = [
      ...missingEpisodes,
      ...(options.onlyMissing ? [] : changedExistingEpisodes),
    ].slice(0, limit);
  } else if (source === 'incremental') {
    selectedEpisodes = [
      ...missingEpisodes,
      ...changedExistingEpisodes,
    ].slice(0, episodesPerSeriesRun);
  } else {
    const savedCursor = nonNegativeInt(state.seriesEpisodeCursor[id], 0);
    cursor = savedCursor < episodes.length ? savedCursor : 0;
    selectedEpisodes = episodes.slice(cursor, cursor + episodesPerSeriesRun);
  }

  let processedEpisodes = 0;
  let addedEpisodes = 0;
  let latestAddedEpisode = null;
  let stoppedByBudget = false;
  let operatorLinksInThisTitle = 0;
  const rejectedEpisodes = [];

  for (const episode of selectedEpisodes) {
    if (affiliateBudgetExhausted) {
      stoppedByBudget = true;
      break;
    }

    processedEpisodes += 1;
    stats.episodesProcessed += 1;

    try {
      const linkResult = await fetchAffiliateLinks(episode.id, 'episode');

      if (linkResult.skipped) {
        stoppedByBudget = true;
        break;
      }

      const media = parseMediaLinks(linkResult.links);
      operatorLinksInThisTitle += media.operatorFiles.length;

      if (options.requireOperator && !media.operatorFiles.length) {
        rejectedEpisodes.push({
          id: String(episode.id),
          seasonNumber: episodeSeasonNumber(episode),
          episodeNumber: episodeNumberValue(episode),
          reason: 'no-operator-link',
        });
        continue;
      }

      if (!media.downloads.length && !media.streamUrl) {
        stats.episodesRejectedNoLinks += 1;
        rejectedEpisodes.push({
          id: String(episode.id),
          seasonNumber: episodeSeasonNumber(episode),
          episodeNumber: episodeNumberValue(episode),
          reason: 'no-usable-links',
        });
        continue;
      }

      const previousGroup = findEpisodeGroup(mergedGroups, episode);
      const nextGroup = episodeGroup(episode, media);
      upsertEpisodeGroup(mergedGroups, nextGroup);

      if (!previousGroup) {
        addedEpisodes += 1;
        stats.episodeGroupsAdded += 1;
        latestAddedEpisode = episode;
      }
    } catch (error) {
      rememberError(`episode-${episode.id}`, error);
    }
  }

  let completeBackfill = true;
  if (source === 'backfill') {
    const nextCursor = cursor + processedEpisodes;
    completeBackfill = nextCursor >= episodes.length;
    state.seriesEpisodeCursor[id] = completeBackfill ? 0 : nextCursor;
  }

  mergedGroups.sort(compareEpisodeGroups);
  const hasOperator = groupsHaveOperatorLinks(mergedGroups);

  if (options.requireOperator && !hasOperator) {
    stats.operatorSeriesRejectedNoOperatorLink += 1;
    return {
      retryLater: stoppedByBudget,
      completeBackfill,
      added: false,
      reason: 'no-operator-link',
    };
  }

  if (!mergedGroups.length) {
    console.log(
      `سریال ${id} هنوز لینک رایگان مستقیم یا ویژه اینترنت همراه ندارد؛ مورد قبلی حذف نشد.`,
    );

    if (options.requireIranian) {
      stats.iranianSeriesRejectedNoLinks += 1;
    }

    return {
      retryLater: stoppedByBudget,
      completeBackfill,
      added: false,
      reason: stoppedByBudget ? 'request-budget' : 'no-usable-links',
    };
  }

  let updateLabel = existing?.updateLabel || '';

  if (addedEpisodes > 0 && latestAddedEpisode) {
    const episodeNumber = episodeNumberValue(latestAddedEpisode);
    updateLabel = `قسمت ${toPersianDigits(episodeNumber)} اضافه شد`;
  } else if ((source === 'incremental' || source.endsWith('-priority')) && existing) {
    updateLabel = 'بروزرسانی شد';
  }

  const remainingSourceEpisodes = episodes.filter(
    (episode) => !findEpisodeGroup(mergedGroups, episode),
  );
  const isAiring = inferSeriesAiring(series, existing);
  const archiveComplete =
    episodeDiscoveryComplete &&
    episodes.length > 0 &&
    remainingSourceEpisodes.length === 0 &&
    !stoppedByBudget;
  const historicalMissing = remainingSourceEpisodes.filter(
    (episode) => !isEpisodeAfterPublishedTail(episode, mergedGroups),
  );
  const keepPublishedWhileAiring = Boolean(
    isAiring &&
    existing?.publicationStatus === 'published' &&
    historicalMissing.length === 0,
  );
  const publicationStatus =
    archiveComplete || keepPublishedWhileAiring
      ? 'published'
      : 'building-archive';

  if (publicationStatus === 'building-archive') {
    stats.seriesHiddenUntilComplete += 1;
  } else if (existing?.publicationStatus !== 'published') {
    stats.seriesPublishedAfterCompletion += 1;
  }
  if (keepPublishedWhileAiring && !archiveComplete) {
    stats.airingSeriesKeptPublished += 1;
  }

  rememberSeriesEpisodeDiagnostic(
    series,
    source,
    episodes,
    mergedGroups,
    rejectedEpisodes,
  );

  const normalized = normalizeSeries(
    series,
    mergedGroups,
    source,
    existing,
    updateLabel,
    {
      isAiring,
      archiveComplete,
      publicationStatus,
      sourceEpisodeCount: episodes.length,
      pendingEpisodes: remainingSourceEpisodes,
      episodeDiscoveryComplete,
      episodePaginationPagesFetched: detail.episodePaginationPagesFetched || 0,
      episodePaginationErrors: detail.episodePaginationErrors || 0,
    },
  );

  replaceItem(normalized);
  stats.seriesAddedOrUpdated += 1;
  if (normalized.ir) stats.iranianSeriesProcessed += 1;

  if (source === 'iranian-priority' && normalized.ir) {
    stats.iranianSeriesAddedOrUpdated += 1;
  }

  if (hasOperator) {
    stats.operatorLinksFound += operatorLinksInThisTitle;
    if (source === 'operator-priority') {
      stats.operatorSeriesAddedOrUpdated += 1;
    }
  }

  return {
    retryLater: stoppedByBudget,
    completeBackfill,
    added: true,
    addedEpisodes,
    archiveComplete,
    publicationStatus,
    remainingEpisodeCount: remainingSourceEpisodes.length,
    sourceEpisodeCount: episodes.length,
    episodeDiscoveryComplete,
    reason: episodeDiscoveryComplete
      ? 'added-or-updated'
      : 'episode-discovery-incomplete',
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


async function fetchIranianSeriesPage(page) {
  // The upstream API has used more than one interpretation for the Persian
  // filters. Query the known variants and merge them, then let inferIranian
  // validate the detail record before it is added to the catalog.
  const variants = [
    { free: 1, persian: 1, traffic: 1, noFreeFallback: true },
    { free: '', persian: 1, traffic: 1, noFreeFallback: true },
    { free: 1, persian: 'true', traffic: 1, noFreeFallback: true },
    { free: 1, persian: '', country: 'IR', traffic: 1, noFreeFallback: true },
    // Fallback scan: some deployments ignore/rename the Persian filter.
    { free: 1, persian: 0, traffic: 1, noFreeFallback: true },
  ];

  const results = [];
  for (const filters of variants) {
    try {
      results.push(await fetchScopedArchivePage('series', page, filters));
    } catch (error) {
      rememberError(`iranian-series-filter-${page}-${JSON.stringify(filters)}`, error);
    }
  }

  return {
    items: dedupeCandidates(results.flatMap((result) => result.items || [])),
    lastPage: Math.max(1, ...results.map((result) => Number(result.lastPage || 1))),
  };
}

async function fetchOperatorSeriesPage(page) {
  return fetchScopedArchivePage('series', page, {
    free: '',
    persian: '',
    traffic: 1,
  });
}

async function fetchOperatorMoviePage(page) {
  return fetchScopedArchivePage('movies', page, {
    free: '',
    persian: '',
    traffic: 1,
  });
}

async function fetchScopedArchivePage(kind, page, filters = {}) {
  const singular = kind === 'movies' ? 'movies' : 'series';
  const url = new URL(`${API_BASE}/ghost/get/${singular}/sort`);

  setQuery(url, {
    trending: 1,
    genre: 'all',
    free: filters.free ?? '',
    country: filters.country ?? 0,
    persian: filters.persian ?? '',
    query: '',
    affiliate: 1,
    traffic: filters.traffic ?? 1,
    ...(kind === 'movies' ? { imdb: '' } : {}),
    page,
  });

  const json = await fetchJson(url, { method: 'POST' });
  const result = pagedResult(json, kind);

  // Some deployments interpret an empty free filter differently. Falling
  // back to free=1 keeps the sync working while the operator parser still
  // detects mobile-only links returned by the affiliate endpoint.
  if (!result.items.length && filters.free === '' && !filters.noFreeFallback) {
    url.searchParams.set('free', '1');
    const fallbackJson = await fetchJson(url, { method: 'POST' });
    return pagedResult(fallbackJson, kind);
  }

  return result;
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

  // Some API deployments return episode lists in `season`, while others
  // nest them elsewhere in the detail payload. Scan the complete payload,
  // then follow any Laravel-style next-page URLs so older episodes are not
  // silently omitted.
  const episodePayloads = [data];
  const queuedUrls = collectEpisodePaginationUrls(data);
  const visitedUrls = new Set();
  let episodeDiscoveryComplete = true;
  let paginationErrors = 0;

  while (queuedUrls.length && visitedUrls.size < maxEpisodePaginationPages) {
    const nextUrl = queuedUrls.shift();
    if (!nextUrl || visitedUrls.has(nextUrl)) continue;
    visitedUrls.add(nextUrl);

    try {
      const pageJson = await fetchJson(nextUrl);
      const pageData = pageJson?.data ?? pageJson;
      episodePayloads.push(pageData);
      stats.episodePaginationPagesFetched += 1;
      for (const discoveredUrl of collectEpisodePaginationUrls(pageData)) {
        if (!visitedUrls.has(discoveredUrl) && !queuedUrls.includes(discoveredUrl)) {
          queuedUrls.push(discoveredUrl);
        }
      }
    } catch (error) {
      episodeDiscoveryComplete = false;
      paginationErrors += 1;
      stats.episodePaginationErrors += 1;
      rememberError(`series-${id}-episode-page-${visitedUrls.size}`, error);
    }
  }

  if (queuedUrls.length > 0) {
    episodeDiscoveryComplete = false;
    stats.episodePaginationTruncated += 1;
    rememberDiagnostic('seriesEpisodeDiagnostics', {
      seriesId: String(id),
      title: series?.name_fa || series?.name || '',
      source: 'episode-pagination',
      result: 'pagination-limit-reached',
      visitedPages: visitedUrls.size,
      queuedPagesRemaining: queuedUrls.length,
      pageLimit: maxEpisodePaginationPages,
    });
  }

  const episodes = dedupeEpisodes(
    episodePayloads.flatMap((payload) => collectEpisodes(payload)),
  ).sort(compareEpisodes);

  if (!episodeDiscoveryComplete) {
    stats.episodeDiscoveryIncomplete += 1;
  }
  stats.episodesDiscovered += episodes.length;

  return {
    series,
    episodes,
    episodeDiscoveryComplete,
    episodePaginationPagesFetched: visitedUrls.size - paginationErrors,
    episodePaginationErrors: paginationErrors,
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
  const freeLinks = (Array.isArray(links) ? links : [])
    .filter(
      (link) =>
        Number(link?.amount || 0) === 0 &&
        isHttp(link?.link),
    )
    .map((link) => ({
      ...link,
      link: rewriteAffiliateRef(link.link),
    }));

  const operatorLinks = uniqueByUrl(
    freeLinks.filter((link) => isOperatorAccessLink(link)),
  );

  const directLinks = freeLinks.filter(
    (link) =>
      !isOperatorAccessLink(link) &&
      isDirectMediaUrl(link.link),
  );

  const mp4 = uniqueByUrl(
    directLinks.filter((link) => /\.mp4(?:$|[?#])/i.test(link.link)),
  );

  const hls = uniqueByUrl(
    directLinks.filter((link) => /\.m3u8(?:$|[?#])/i.test(link.link)),
  );

  const sortedMp4 = [...mp4].sort(
    (a, b) => qualityRank(a.title) - qualityRank(b.title),
  );

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

  const operatorFiles = operatorLinks.map((link) =>
    toOperatorFile(link),
  );

  if (operatorFiles.length) {
    downloads.push({
      id: 'operator-mobile-access',
      title: 'ویژه اینترنت همراه',
      subtitle: 'پخش یا دریافت با اینترنت سیم‌کارت',
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
    operatorAccess: operatorAccessFromFiles(operatorFiles),
    supportedOperators: uniqueStrings(
      operatorFiles.flatMap((file) => file.supportedOperators || []),
    ),
  };
}

function episodeGroup(episode, media) {
  const season = episodeSeasonNumber(episode);

  const number = episodeNumberValue(episode);

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

  for (const file of media.operatorFiles || []) {
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

  const operatorFiles = Array.isArray(media.operatorFiles)
    ? media.operatorFiles
    : [];
  const hasOperator = operatorFiles.length > 0;
  const hasDirect = Boolean(
    media.streamUrl ||
    media.downloads.some((section) =>
      (section.files || []).some((file) =>
        file.mode === 'download' || file.mode === 'play' || !file.mode,
      ),
    ),
  );
  const operatorOnly = hasOperator && !hasDirect;
  const categoryKeys = [...classification.categoryKeys];
  const categoryLabels = [...classification.categoryLabels];

  if (hasOperator) {
    categoryKeys.push('mobile-operator');
    categoryLabels.push('ویژه اینترنت همراه');
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

    access: operatorOnly ? 'operator' : 'free',
    operatorOnly,
    operatorAccess: hasOperator ? media.operatorAccess : undefined,
    supportedOperators: hasOperator && media.supportedOperators.length
      ? media.supportedOperators
      : undefined,
    streamUrl: media.streamUrl || undefined,
    streamMode: media.streamUrl ? 'video' : undefined,

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

    categoryKeys: uniqueStrings(categoryKeys),

    categoryLabels: uniqueStrings(categoryLabels),

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
  archiveMeta = {},
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

  const operatorFiles = groups.flatMap((group) =>
    (Array.isArray(group?.files) ? group.files : []).filter((file) =>
      file?.mode === 'operator-play' || file?.mode === 'operator-download',
    ),
  );
  const directFiles = groups.flatMap((group) =>
    (Array.isArray(group?.files) ? group.files : []).filter((file) =>
      file?.mode !== 'operator-play' && file?.mode !== 'operator-download',
    ),
  );
  const hasOperator = operatorFiles.length > 0;
  const operatorOnly = hasOperator && directFiles.length === 0;
  const operatorAccess = operatorAccessFromFiles(operatorFiles);
  const supportedOperators = uniqueStrings(
    operatorFiles.flatMap((file) => file.supportedOperators || []),
  );
  const categoryKeys = [...classification.categoryKeys];
  const categoryLabels = [...classification.categoryLabels];

  if (hasOperator) {
    categoryKeys.push('mobile-operator');
    categoryLabels.push('ویژه اینترنت همراه');
  }

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

    access: operatorOnly ? 'operator' : 'free',
    operatorOnly,
    operatorAccess: hasOperator ? operatorAccess : undefined,
    supportedOperators: supportedOperators.length ? supportedOperators : undefined,
    downloads: groups,

    episodeCount: groups.length,
    seasonCount: seasonNumbers.size,
    sourceEpisodeCount: nonNegativeInt(
      archiveMeta.sourceEpisodeCount,
      nonNegativeInt(existing?.sourceEpisodeCount, groups.length),
    ),
    archivePendingEpisodeCount: Array.isArray(archiveMeta.pendingEpisodes)
      ? archiveMeta.pendingEpisodes.length
      : nonNegativeInt(existing?.archivePendingEpisodeCount, 0),
    archivePendingEpisodes: Array.isArray(archiveMeta.pendingEpisodes)
      ? archiveMeta.pendingEpisodes.slice(0, 40).map((episode) => ({
          seasonNumber: episodeSeasonNumber(episode),
          episodeNumber: episodeNumberValue(episode),
        }))
      : Array.isArray(existing?.archivePendingEpisodes)
        ? existing.archivePendingEpisodes
        : [],
    archiveComplete: Boolean(archiveMeta.archiveComplete),
    publicationStatus: archiveMeta.publicationStatus || 'building-archive',
    isAiring: Boolean(archiveMeta.isAiring),
    archiveEpisodeDiscoveryComplete:
      archiveMeta.episodeDiscoveryComplete !== false,
    archiveEpisodePaginationPagesFetched: nonNegativeInt(
      archiveMeta.episodePaginationPagesFetched,
      nonNegativeInt(existing?.archiveEpisodePaginationPagesFetched, 0),
    ),
    archiveEpisodePaginationErrors: nonNegativeInt(
      archiveMeta.episodePaginationErrors,
      0,
    ),
    archiveDiscoveryCheckedAt: new Date().toISOString(),

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

    categoryKeys: uniqueStrings(categoryKeys),

    categoryLabels: uniqueStrings(categoryLabels),

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

  const season = episodeSeasonNumber(episode);

  const number = episodeNumberValue(episode);

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
    const current = groups[index];
    const files = dedupeMediaFiles([
      ...(Array.isArray(current?.files) ? current.files : []),
      ...(Array.isArray(next?.files) ? next.files : []),
    ]);
    groups[index] = {
      ...current,
      ...next,
      files,
      sourceUpdatedAt: maxDate(current?.sourceUpdatedAt, next?.sourceUpdatedAt),
    };
  } else {
    groups.push(next);
  }
}


function normalizeNumericText(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
}

function numericField(value, fallback = 0) {
  const normalized = normalizeNumericText(value).trim();
  if (!normalized) return fallback;
  const direct = Number(normalized);
  if (Number.isFinite(direct)) return direct;
  const match = normalized.match(/\d+/);
  return match ? Number(match[0]) : fallback;
}

function episodeNumberValue(episode) {
  for (const candidate of [
    episode?.episode_number,
    episode?.episodeNumber,
    episode?.episode,
    episode?.number,
    episode?.order,
  ]) {
    const value = numericField(candidate, 0);
    if (value > 0) return value;
  }

  const label = normalizeNumericText(
    episode?.name_fa || episode?.name || episode?.title || '',
  );
  const labeled = label.match(/(?:قسمت|episode|ep\.?|e)\s*[-:#]*\s*(\d{1,4})/i);
  return labeled ? Number(labeled[1]) : 0;
}

function episodeSeasonNumber(episode) {
  for (const candidate of [
    episode?.season_number,
    episode?.seasonNumber,
    episode?.season,
  ]) {
    const value = numericField(candidate, 0);
    if (value > 0) return value;
  }

  const label = normalizeNumericText(
    episode?.name_fa || episode?.name || episode?.title || '',
  );
  const labeled = label.match(/(?:فصل|season|s)\s*[-:#]*\s*(\d{1,3})/i);
  return labeled ? Number(labeled[1]) : 1;
}

function dedupeEpisodes(episodes) {
  const byKey = new Map();
  for (const episode of episodes || []) {
    if (!episode || typeof episode !== 'object') continue;
    const id = String(episode.id || '');
    const season = episodeSeasonNumber(episode);
    const number = episodeNumberValue(episode);
    const key = id ? `id:${id}` : `s:${season}:e:${number}`;
    if (!id && number <= 0) continue;
    const current = byKey.get(key);
    byKey.set(key, current ? { ...current, ...episode } : episode);
  }
  return [...byKey.values()];
}

function collectEpisodePaginationUrls(value) {
  const result = new Set();
  const seen = new Set();

  function add(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return;
    try {
      const parsed = new URL(raw, API_BASE);
      if (parsed.protocol !== 'https:' || parsed.hostname !== new URL(API_BASE).hostname) return;
      result.add(parsed.toString());
    } catch {
      // Ignore malformed pagination metadata.
    }
  }

  function walk(node, depth = 0) {
    if (!node || depth > 10 || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const entry of node) walk(entry, depth + 1);
      return;
    }

    for (const [key, entry] of Object.entries(node)) {
      if (/^(?:next_page_url|nextPageUrl)$/i.test(key)) add(entry);
      if (key === 'links' && Array.isArray(entry)) {
        for (const link of entry) {
          if (link && typeof link === 'object' && /next|بعد/i.test(String(link.label || ''))) {
            add(link.url);
          }
        }
      }
      walk(entry, depth + 1);
    }
  }

  walk(value);
  return [...result];
}

function dedupeMediaFiles(files) {
  const seen = new Set();
  const result = [];
  for (const file of files || []) {
    if (!file || typeof file !== 'object') continue;
    const key = `${String(file.mode || 'download')}:${String(file.url || file.id || '')}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(file);
  }
  return result;
}

function missingEpisodeNumbers(expectedNumbers, availableNumbers) {
  const expected = [...new Set(expectedNumbers.filter((value) => value > 0))].sort((a, b) => a - b);
  const available = new Set(availableNumbers.filter((value) => value > 0));
  return expected.filter((value) => !available.has(value));
}

function rememberSeriesEpisodeDiagnostic(series, source, episodes, groups, rejectedEpisodes = []) {
  const expectedBySeason = new Map();
  const availableBySeason = new Map();

  for (const episode of episodes || []) {
    const season = episodeSeasonNumber(episode);
    const number = episodeNumberValue(episode);
    if (!expectedBySeason.has(season)) expectedBySeason.set(season, []);
    if (number > 0) expectedBySeason.get(season).push(number);
  }

  for (const group of groups || []) {
    const season = Number(group?.seasonNumber || 1);
    const number = Number(group?.episodeNumber || 0);
    if (!availableBySeason.has(season)) availableBySeason.set(season, []);
    if (number > 0) availableBySeason.get(season).push(number);
  }

  const missing = [];
  for (const [season, expected] of expectedBySeason.entries()) {
    for (const episodeNumber of missingEpisodeNumbers(expected, availableBySeason.get(season) || [])) {
      missing.push({ seasonNumber: season, episodeNumber });
    }
  }

  rememberDiagnostic('seriesEpisodeDiagnostics', {
    seriesId: String(series?.id || series?.t_id || ''),
    title: cleanText(series?.name_fa || series?.name || ''),
    source,
    discoveredEpisodeCount: episodes.length,
    catalogEpisodeCount: groups.length,
    missing,
    rejectedEpisodes,
  });
}


function inferSeriesAiring(series, existing) {
  const values = [
    series?.status,
    series?.series_status,
    series?.broadcast_status,
    series?.state,
    existing?.status,
  ].map((value) => cleanText(value).toLowerCase()).filter(Boolean);

  const explicitEnded = Boolean(
    series?.ended === true ||
    series?.isEnded === true ||
    series?.finished === true ||
    series?.completed === true ||
    values.some((value) =>
      /(?:ended|finished|completed|canceled|cancelled|پایان|تمام\s*شده|به\s*پایان\s*رسیده)/i.test(value),
    ),
  );
  if (explicitEnded) return false;

  const explicitAiring = Boolean(
    series?.isAiring === true ||
    series?.is_airing === true ||
    series?.airing === true ||
    series?.ongoing === true ||
    series?.in_production === true ||
    values.some((value) =>
      /(?:airing|ongoing|returning|in\s*production|در\s*حال\s*پخش|درحال\s*پخش)/i.test(value),
    ),
  );
  if (explicitAiring) return true;

  const nextEpisodeDate =
    series?.nextEpisodeAirDate ||
    series?.next_episode_air_date ||
    existing?.nextEpisodeAirDate;
  const nextTimestamp = Date.parse(String(nextEpisodeDate || ''));
  if (Number.isFinite(nextTimestamp)) {
    return nextTimestamp >= Date.now() - 2 * 24 * 60 * 60 * 1000;
  }

  if (typeof existing?.isAiring === 'boolean') return existing.isAiring;
  return false;
}

function isEpisodeAfterPublishedTail(episode, groups) {
  const season = episodeSeasonNumber(episode);
  const number = episodeNumberValue(episode);
  const bySeason = new Map();

  for (const group of Array.isArray(groups) ? groups : []) {
    const groupSeason = Number(group?.seasonNumber || 1);
    const groupNumber = Number(group?.episodeNumber || 0);
    if (groupNumber <= 0) continue;
    bySeason.set(groupSeason, Math.max(bySeason.get(groupSeason) || 0, groupNumber));
  }

  const maximumSeason = Math.max(0, ...bySeason.keys());
  if (season > maximumSeason) return true;
  return number > (bySeason.get(season) || 0);
}

function seriesArchiveDeficit(item) {
  if (!item || item.type !== 'series') {
    return { missing: [], pending: 0, total: 0 };
  }

  const groups = Array.isArray(item.downloads) ? item.downloads : [];
  const missing = episodeGapsForGroups(groups);
  const sourceEpisodeCount = nonNegativeInt(item.sourceEpisodeCount, 0);
  const pendingFromCount = Math.max(0, sourceEpisodeCount - groups.length);
  const pending = Math.max(
    pendingFromCount,
    nonNegativeInt(item.archivePendingEpisodeCount, 0),
    Array.isArray(item.archivePendingEpisodes) ? item.archivePendingEpisodes.length : 0,
    item.archiveEpisodeDiscoveryComplete === false ? 1 : 0,
  );

  return {
    missing,
    pending,
    total: Math.max(missing.length, pending),
  };
}

function hasSeriesArchiveMetadata(item) {
  return Boolean(
    item?.type === 'series' &&
    (
      Object.prototype.hasOwnProperty.call(item, 'archiveComplete') ||
      nonNegativeInt(item.sourceEpisodeCount, 0) > 0
    )
  );
}

function withSeriesPublicationState(item) {
  if (!item || item.type !== 'series') return item;

  const deficit = seriesArchiveDeficit(item);
  const hasArchiveMetadata = hasSeriesArchiveMetadata(item);

  // Strict publication rule: a legacy series is hidden until its source
  // episode list has been audited. This prevents an apparently continuous but
  // truncated archive (for example only episodes 1-6 of a 30-episode season)
  // from being published merely because there is no numeric gap yet.
  if (!hasArchiveMetadata) {
    return {
      ...item,
      archiveComplete: false,
      archivePendingEpisodeCount: Math.max(1, deficit.pending),
      publicationStatus: 'building-archive',
      archiveAuditStatus: 'pending',
    };
  }

  if (item.archiveAuditStatus === 'blocked' && !retryBlockedBackfill) {
    return {
      ...item,
      archiveComplete: false,
      publicationStatus: 'building-archive',
    };
  }

  const archiveComplete =
    deficit.total === 0 &&
    item.archiveEpisodeDiscoveryComplete !== false &&
    Boolean(item.downloads?.length);
  const keepPublishedWhileAiring = Boolean(
    item.isAiring &&
    item.publicationStatus === 'published' &&
    deficit.missing.length === 0,
  );
  const publicationStatus =
    archiveComplete || keepPublishedWhileAiring
      ? 'published'
      : 'building-archive';

  return {
    ...item,
    archiveComplete,
    archivePendingEpisodeCount: deficit.pending,
    publicationStatus,
    archiveAuditStatus: 'checked',
  };
}

function episodeGapsForGroups(groups) {
  const bySeason = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    const season = Number(group?.seasonNumber || 1);
    const number = Number(group?.episodeNumber || 0);
    if (number <= 0) continue;
    if (!bySeason.has(season)) bySeason.set(season, []);
    bySeason.get(season).push(number);
  }

  const missing = [];
  for (const [season, numbers] of bySeason.entries()) {
    const maximum = Math.max(0, ...numbers);
    const available = new Set(numbers);
    for (let number = 1; number <= maximum; number += 1) {
      if (!available.has(number)) missing.push({ seasonNumber: season, episodeNumber: number });
    }
  }
  return missing;
}

function buildCatalogEpisodeGapDiagnostics(catalogItems) {
  const diagnostics = [];
  for (const item of catalogItems || []) {
    if (item?.type !== 'series' || !Array.isArray(item.downloads)) continue;
    const deficit = seriesArchiveDeficit(item);
    if (
      deficit.total > 0 ||
      item.publicationStatus !== 'published' ||
      !hasSeriesArchiveMetadata(item)
    ) {
      diagnostics.push({
        seriesId: String(item.id || ''),
        title: item.nameFa || item.name || '',
        missing: deficit.missing,
        pendingEpisodeCount: deficit.pending,
        publicationStatus: item.publicationStatus || 'published',
        archiveAuditStatus: hasSeriesArchiveMetadata(item) ? 'checked' : 'pending',
        isAiring: Boolean(item.isAiring),
      });
    }
    if (diagnostics.length >= 100) break;
  }
  return diagnostics;
}

function compareEpisodes(a, b) {
  const seasonDiff =
    episodeSeasonNumber(a) -
    episodeSeasonNumber(b);

  if (seasonDiff) return seasonDiff;

  return (
    episodeNumberValue(a) -
    episodeNumberValue(b)
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
            entry.episodeNumber != null ||
            entry.episode != null ||
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
  const irFlag = item?.ir ?? item?.is_iranian ?? item?.isIranian;
  if (
    irFlag === true ||
    Number(irFlag || 0) === 1 ||
    String(irFlag || '').toLowerCase() === 'true'
  ) {
    return true;
  }

  const language = cleanText(
    item?.original_language ||
    item?.originalLanguage ||
    item?.language_code ||
    item?.lang ||
    item?.language ||
    '',
  ).toLowerCase();
  if (language === 'fa' || language === 'fas' || language === 'per' || language === 'persian') {
    return true;
  }

  const countryValue = [
    item?.country_fa,
    item?.country,
    item?.countries,
    item?.country_name,
    item?.countryName,
    item?.country_code,
    item?.countryCode,
  ];
  let country = '';
  try {
    country = JSON.stringify(countryValue);
  } catch {
    country = countryValue.map((value) => cleanText(value)).join(' ');
  }

  return /ایران|iran|(?:^|[^a-z])ir(?:[^a-z]|$)/i.test(country);
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


function isDirectMediaUrl(value) {
  return /\.(?:mp4|m3u8)(?:$|[?#])/i.test(String(value || ''));
}

function operatorPortalDetails(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;

    const isUpera = /(^|\.)upera\.tv$/i.test(url.hostname);
    const isShortLink = /(^|\.)redl\.ink$/i.test(url.hostname);
    if (!isUpera && !isShortLink) return null;

    const pathText = decodeURIComponent(url.pathname || '');
    if (isShortLink) {
      return pathText && pathText !== '/'
        ? { action: '', hostname: url.hostname, pathname: url.pathname, shortLink: true }
        : null;
    }

    const actionMatch = pathText.match(/\/(stream|watch|play|download)(?:\/|$)/i);
    const mediaMatch = pathText.match(/\/(movie|series|episode)(?:\/|$)/i);

    // A normal movie/series page is not operator access. It must explicitly
    // contain both an access action and a media resource segment.
    if (!actionMatch || !mediaMatch) return null;

    return {
      action: String(actionMatch[1] || '').toLowerCase(),
      hostname: url.hostname,
      pathname: url.pathname,
      shortLink: false,
    };
  } catch {
    return null;
  }
}

function scalarLinkText(link) {
  if (!link || typeof link !== 'object') return '';

  return Object.entries(link)
    .filter(([, value]) =>
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean',
    )
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(' ')
    .toLowerCase();
}

function isOperatorAccessLink(link) {
  if (!link || !isHttp(link.link) || isDirectMediaUrl(link.link)) return false;

  const portal = operatorPortalDetails(link.link);
  const explicitFlag = [
    link.operatorOnly,
    link.operator_only,
    link.is_operator,
    link.isOperator,
    link.mobile_only,
    link.mobileOnly,
    link.cellular_only,
    link.cellularOnly,
  ].some((value) =>
    value === true ||
    value === 1 ||
    String(value).toLowerCase() === 'true' ||
    String(value) === '1',
  );

  const text = scalarLinkText(link);
  const explicitText = /ویژه\s*(?:اینترنت\s*)?(?:همراه|اپراتور)|همراه\s*اول|ایرانسل|رایتل|شاتل\s*موبایل|mobile\s*(?:operator|internet|data)|cellular\s*(?:only|access)|operator[-_\s]*(?:only|play|download)/i.test(text);

  if (!portal) return false;
  if (portal.shortLink) return explicitFlag || explicitText;
  return true;
}

function operatorModeForLink(link) {
  const portal = operatorPortalDetails(link?.link);
  const text = scalarLinkText(link);

  if (
    portal?.action === 'download' ||
    /دانلود|دریافت|download|save/i.test(text)
  ) {
    return 'operator-download';
  }

  return 'operator-play';
}

function supportedOperatorsForLink(link) {
  const text = scalarLinkText(link);
  const operators = [];

  if (/همراه\s*اول|mci/i.test(text)) operators.push('همراه اول');
  if (/ایرانسل|irancell/i.test(text)) operators.push('ایرانسل');
  if (/رایتل|rightel/i.test(text)) operators.push('رایتل');
  if (/شاتل\s*موبایل|shatel\s*mobile/i.test(text)) operators.push('شاتل موبایل');

  const explicit = link?.supportedOperators || link?.operators || link?.carriers;
  if (Array.isArray(explicit)) {
    operators.push(...explicit.map((value) => cleanText(value)).filter(Boolean));
  } else if (typeof explicit === 'string') {
    operators.push(
      ...explicit.split(/[,،|/]/).map((value) => cleanText(value)).filter(Boolean),
    );
  }

  return uniqueStrings(operators);
}

function toOperatorFile(link) {
  const mode = operatorModeForLink(link);
  const label = cleanText(
    link.title ||
    link.label ||
    link.name ||
    (mode === 'operator-play' ? 'پخش آنلاین با اینترنت همراه' : 'دانلود با اینترنت همراه'),
  );
  const supportedOperators = supportedOperatorsForLink(link);

  return {
    id: `operator-${mode === 'operator-play' ? 'play' : 'download'}-${simpleHash(link.link)}`,
    quality: mode === 'operator-play' ? 'پخش آنلاین' : qualityLabel(label || 'دانلود'),
    label,
    ...(link.size && Number(link.size) !== 0 ? { size: String(link.size) } : {}),
    url: link.link,
    mode,
    operatorOnly: true,
    ...(supportedOperators.length ? { supportedOperators } : {}),
  };
}

function operatorAccessFromFiles(files) {
  const hasPlay = files.some((file) => file?.mode === 'operator-play');
  const hasDownload = files.some((file) => file?.mode === 'operator-download');

  if (hasPlay && hasDownload) return 'both';
  if (hasPlay) return 'stream';
  if (hasDownload) return 'download';
  return null;
}

function groupsHaveOperatorLinks(groups) {
  return (Array.isArray(groups) ? groups : []).some((group) =>
    (Array.isArray(group?.files) ? group.files : []).some((file) =>
      file?.mode === 'operator-play' || file?.mode === 'operator-download',
    ),
  );
}

function isValidStoredOperatorFile(file) {
  if (!file || !['operator-play', 'operator-download'].includes(file.mode)) return false;
  return Boolean(operatorPortalDetails(file.url));
}

function recoverDirectFileFromInvalidOperator(file) {
  if (!file || !isDirectMediaUrl(file.url)) return null;
  const isHls = /\.m3u8(?:$|[?#])/i.test(String(file.url || ''));
  const next = {
    ...file,
    mode: isHls ? 'play' : 'download',
  };
  delete next.operatorOnly;
  delete next.supportedOperators;
  return next;
}

function sanitizeCatalogOperatorAccess(sourceItems) {
  let removed = 0;
  const sanitized = (Array.isArray(sourceItems) ? sourceItems : []).map((item) => {
    const downloads = (Array.isArray(item?.downloads) ? item.downloads : []).flatMap((section) => {
      const nextFiles = [];
      for (const file of Array.isArray(section?.files) ? section.files : []) {
        if (file?.mode === 'operator-play' || file?.mode === 'operator-download') {
          if (isValidStoredOperatorFile(file)) {
            nextFiles.push(file);
          } else {
            removed += 1;
            const recovered = recoverDirectFileFromInvalidOperator(file);
            if (recovered) nextFiles.push(recovered);
          }
        } else {
          nextFiles.push(file);
        }
      }
      if (!nextFiles.length) return [];
      return [{ ...section, files: nextFiles }];
    });

    const operatorFiles = downloads.flatMap((section) =>
      (section.files || []).filter((file) => isValidStoredOperatorFile(file)),
    );
    const hasOperator = operatorFiles.length > 0;
    const directFiles = downloads.flatMap((section) =>
      (section.files || []).filter((file) => !['operator-play', 'operator-download'].includes(file?.mode)),
    );
    const operatorOnly = hasOperator && directFiles.length === 0;
    const categoryKeys = uniqueStrings(
      (item?.categoryKeys || []).filter((key) => key !== 'mobile-operator'),
    );
    const categoryLabels = uniqueStrings(
      (item?.categoryLabels || []).filter((label) => label !== 'ویژه اینترنت همراه'),
    );
    if (hasOperator) {
      categoryKeys.push('mobile-operator');
      categoryLabels.push('ویژه اینترنت همراه');
    }

    const next = {
      ...item,
      downloads,
      access: operatorOnly ? 'operator' : 'free',
      operatorOnly,
      categoryKeys: uniqueStrings(categoryKeys),
      categoryLabels: uniqueStrings(categoryLabels),
    };

    if (hasOperator) {
      next.operatorAccess = operatorAccessFromFiles(operatorFiles);
      const supportedOperators = uniqueStrings(
        operatorFiles.flatMap((file) => file.supportedOperators || []),
      );
      if (supportedOperators.length) next.supportedOperators = supportedOperators;
      else delete next.supportedOperators;
    } else {
      delete next.operatorAccess;
      delete next.supportedOperators;
    }

    return next;
  });

  return { items: sanitized, removed };
}

function rememberDiagnostic(bucket, entry) {
  if (!Array.isArray(stats[bucket])) return;
  if (stats[bucket].length < 100) stats[bucket].push(entry);
}

function uniqueStrings(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => cleanText(value))
      .filter(Boolean),
  )];
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

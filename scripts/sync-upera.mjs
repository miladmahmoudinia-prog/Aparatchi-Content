import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const API_BASE = 'https://seeko.film/api/v1';
const IRANIAN_SERIES_SCAN_VERSION = 3;
const CATALOG_VERSION = '0.13.0-manifest-episode-artwork';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const catalogManifestPath = path.join(root, 'catalog-manifest.json');
const statePath = path.join(root, 'sync-state.json');
const reportPath = path.join(root, 'sync-report.json');
const mediaRoot = path.join(root, 'assets', 'media');
const execFileAsync = promisify(execFile);

const refId = String(process.env.UPERA_REF_ID || '').trim();
const token = String(process.env.UPERA_TOKEN || '').trim();
const tmdbBearerToken = String(process.env.TMDB_BEARER_TOKEN || '').trim();

const peopleEnrichmentTitlesPerRun = Math.min(
  24,
  positiveInt(process.env.APARATCHI_PEOPLE_TITLES_PER_RUN, 10),
);

const peopleEnrichmentMaxPeople = Math.min(
  20,
  positiveInt(process.env.APARATCHI_PEOPLE_MAX_PER_TITLE, 12),
);

const peopleEnrichmentRetryHours = Math.min(
  168,
  positiveInt(process.env.APARATCHI_PEOPLE_RETRY_HOURS, 12),
);

const episodeArtworkSeriesPerRun = Math.min(
  12,
  positiveInt(process.env.APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN, 6),
);

const episodeArtworkMirrorPerRun = Math.min(
  36,
  nonNegativeInt(process.env.APARATCHI_EPISODE_ARTWORK_MIRROR_PER_RUN, 12),
);

const moviePagesPerRun = Math.min(
  20,
  positiveInt(process.env.MOVIE_PAGES_PER_RUN, 6),
);

const seriesPagesPerRun = Math.min(
  20,
  positiveInt(process.env.SERIES_PAGES_PER_RUN, 6),
);

// The first part of every NORMAL run is reserved for actual discovery.
// These scans always start from the newest archive pages and have isolated
// affiliate-link quotas, so airing/repair work can never starve new movies.
const recentMoviePagesPerRun = Math.min(
  moviePagesPerRun,
  positiveInt(process.env.UPERA_RECENT_MOVIE_PAGES_PER_RUN, moviePagesPerRun),
);

const recentSeriesPagesPerRun = Math.min(
  seriesPagesPerRun,
  positiveInt(process.env.UPERA_RECENT_SERIES_PAGES_PER_RUN, seriesPagesPerRun),
);

const recentMovieTitlesPerRun = Math.min(
  40,
  positiveInt(process.env.UPERA_RECENT_MOVIE_TITLES_PER_RUN, 18),
);

const recentSeriesTitlesPerRun = Math.min(
  16,
  positiveInt(process.env.UPERA_RECENT_SERIES_TITLES_PER_RUN, 6),
);

const recentMovieRequestQuota = Math.min(
  40,
  positiveInt(process.env.UPERA_RECENT_MOVIE_REQUEST_QUOTA, 18),
);

const recentSeriesRequestQuota = Math.min(
  48,
  positiveInt(process.env.UPERA_RECENT_SERIES_REQUEST_QUOTA, 24),
);

const recentSeriesEpisodeLimit = Math.min(
  12,
  positiveInt(process.env.UPERA_RECENT_SERIES_EPISODES_PER_TITLE, 5),
);

const incrementalRequestQuota = Math.min(
  20,
  positiveInt(process.env.UPERA_INCREMENTAL_REQUEST_QUOTA, 8),
);

const airingRequestQuota = Math.min(
  24,
  positiveInt(process.env.UPERA_AIRING_REQUEST_QUOTA, 10),
);

const archiveMovieRequestQuota = Math.min(
  20,
  positiveInt(process.env.UPERA_ARCHIVE_MOVIE_REQUEST_QUOTA, 8),
);

const archiveSeriesRequestQuota = Math.min(
  24,
  positiveInt(process.env.UPERA_ARCHIVE_SERIES_REQUEST_QUOTA, 8),
);

const iranianSeriesRequestQuota = Math.min(
  16,
  positiveInt(process.env.UPERA_IRANIAN_SERIES_REQUEST_QUOTA, 6),
);

const operatorMovieRequestQuota = Math.min(
  16,
  positiveInt(process.env.UPERA_OPERATOR_MOVIE_REQUEST_QUOTA, 5),
);

const operatorSeriesRequestQuota = Math.min(
  20,
  positiveInt(process.env.UPERA_OPERATOR_SERIES_REQUEST_QUOTA, 6),
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

const syncModeSetting = ['AUTO', 'BACKFILL', 'NORMAL', 'PEOPLE'].includes(requestedSyncMode)
  ? requestedSyncMode
  : 'AUTO';

// Each GitHub Actions step has a hard internal time budget. The script stops
// requesting new pages before the deadline, writes catalog/state/report, and
// lets the next hourly run continue from the saved cursor. This prevents a few
// slow or broken source links from keeping one workflow alive for hours.
const runStartedAtMs = Date.now();
const runTimeLimitMinutes = Math.min(
  30,
  positiveInt(
    process.env.APARATCHI_RUN_TIME_LIMIT_MINUTES,
    syncModeSetting === 'BACKFILL' ? 18 : syncModeSetting === 'PEOPLE' ? 4 : 8,
  ),
);
const runCheckpointReserveMs = Math.min(
  120000,
  positiveInt(process.env.APARATCHI_CHECKPOINT_RESERVE_MS, 45000),
);
const requestTimeoutMs = Math.min(
  20000,
  positiveInt(process.env.APARATCHI_REQUEST_TIMEOUT_MS, 15000),
);
const requestMaxAttempts = Math.min(
  3,
  positiveInt(process.env.APARATCHI_REQUEST_MAX_ATTEMPTS, 2),
);
const runDeadlineAtMs = runStartedAtMs + runTimeLimitMinutes * 60 * 1000;

const maxBackfillNoProgressRuns = Math.min(
  10,
  positiveInt(process.env.UPERA_BACKFILL_MAX_NO_PROGRESS_RUNS, 3),
);

const backfillEpisodeLimit = Math.min(
  maxAffiliateRequests,
  positiveInt(process.env.UPERA_BACKFILL_EPISODES_PER_RUN, maxAffiliateRequests),
);

const backfillSeriesPerRun = Math.min(
  60,
  positiveInt(process.env.UPERA_BACKFILL_SERIES_PER_RUN, 24),
);

const backfillEpisodesPerSeries = Math.min(
  30,
  positiveInt(process.env.UPERA_BACKFILL_EPISODES_PER_SERIES, 12),
);

const episodeUnavailableAfterAttempts = Math.min(
  8,
  positiveInt(process.env.UPERA_EPISODE_UNAVAILABLE_AFTER_ATTEMPTS, 3),
);

// An episode that repeatedly has no usable affiliate link must not keep an
// otherwise complete series hidden forever. It is treated as unavailable and
// rechecked occasionally (or sooner when the source timestamp changes).
const unavailableEpisodeRetryHours = Math.min(
  24 * 30,
  positiveInt(process.env.UPERA_UNAVAILABLE_EPISODE_RETRY_HOURS, 168),
);

const retryBlockedBackfill = ['1', 'true', 'yes'].includes(
  String(process.env.UPERA_RETRY_BLOCKED || '').trim().toLowerCase(),
);

const blockedBackfillRetryHours = Math.min(
  24 * 30,
  positiveInt(process.env.UPERA_BLOCKED_RETRY_HOURS, 168),
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

const maxMirroredImagesPerRun = Math.min(
  240,
  nonNegativeInt(process.env.APARATCHI_SYNC_MAX_MIRRORED_IMAGES, 40),
);

const imageMirrorConcurrency = Math.min(
  8,
  positiveInt(process.env.APARATCHI_IMAGE_MIRROR_CONCURRENCY, 6),
);

// This counter must be initialized before the top-level sync flow calls
// mirrorCatalogPeopleImages(). Keeping it near the helper functions causes
// a temporal-dead-zone ReferenceError because those functions are invoked
// earlier in this module.
let mirroredImagesUsed = 0;

if (!refId) {
  throw new Error(
    'GitHub Secret با نام UPERA_REF_ID تنظیم نشده است.',
  );
}

const defaultCatalog = {
  version: CATALOG_VERSION,
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
  archiveBackfillOffset: 0,
  archiveBackfillNoProgress: {},
  archiveBackfillCompleted: {},
  archiveEpisodeFailures: {},
  peopleEnrichmentOffset: 0,
  peopleEnrichmentFailures: {},
  episodeArtworkOffset: 0,
  lastPeopleEnrichmentAt: null,
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
state.peopleEnrichmentOffset = nonNegativeInt(state.peopleEnrichmentOffset, 0);
state.episodeArtworkOffset = nonNegativeInt(state.episodeArtworkOffset, 0);
if (
  !state.peopleEnrichmentFailures ||
  typeof state.peopleEnrichmentFailures !== 'object' ||
  Array.isArray(state.peopleEnrichmentFailures)
) {
  state.peopleEnrichmentFailures = {};
}
state.lastPeopleEnrichmentAt = state.lastPeopleEnrichmentAt || null;

if (
  !state.seriesEpisodeCursor ||
  typeof state.seriesEpisodeCursor !== 'object' ||
  Array.isArray(state.seriesEpisodeCursor)
) {
  state.seriesEpisodeCursor = {};
}

state.archiveBackfillSeriesId = String(state.archiveBackfillSeriesId || '');
state.archiveBackfillSeriesTitle = String(state.archiveBackfillSeriesTitle || '');
state.archiveBackfillOffset = nonNegativeInt(state.archiveBackfillOffset, 0);
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
if (
  !state.archiveEpisodeFailures ||
  typeof state.archiveEpisodeFailures !== 'object' ||
  Array.isArray(state.archiveEpisodeFailures)
) {
  state.archiveEpisodeFailures = {};
}

let items = Array.isArray(catalog.items)
  ? catalog.items.filter(Boolean)
  : [];

// Operator access is recomputed from validated files on every run. This
// removes stale badges/categories created by older, overly broad matching.
// Existing duplicate rows (for example direct + operator versions of one title)
// are merged before the new sync starts.
const initialOperatorCleanup = sanitizeCatalogOperatorAccess(items);
const duplicateCleanup = mergeDuplicateCatalogItems(initialOperatorCleanup.items);
const finalOperatorCleanup = sanitizeCatalogOperatorAccess(duplicateCleanup.items);
const operatorCleanup = {
  items: finalOperatorCleanup.items,
  removed: initialOperatorCleanup.removed + finalOperatorCleanup.removed,
  duplicatesMerged: duplicateCleanup.merged,
};
items = operatorCleanup.items.map((item) => withSeriesPublicationState(item));

let lastAffiliateRequestAt = 0;
let affiliateRequestsUsed = 0;
let affiliateBudgetExhausted = false;
const affiliateLinkCache = new Map();
const episodeFailureRegisteredThisRun = new Set();

// A scoped quota is softer than the global run budget. Reaching it stops only
// the current phase and lets the next reserved phase continue. This is the key
// difference from the old implementation, where Iranian/airing maintenance
// could consume every affiliate request before movie discovery started.
let affiliateScopeName = '';
let affiliateScopeStart = 0;
let affiliateScopeLimit = Number.POSITIVE_INFINITY;
let affiliateScopeExhausted = false;

const stats = {
  startedAt: new Date().toISOString(),
  runTimeLimitMinutes,
  runDeadlineAt: new Date(runDeadlineAtMs).toISOString(),
  stoppedByTimeBudget: false,
  timeBudgetStopContext: '',
  remainingRunMsAtFinish: 0,
  imageMirroringSkipped: false,
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
  backfillSeriesVisited: 0,
  backfillCheckpoints: 0,
  episodesMarkedUnavailable: 0,
  backfillNoProgressRuns: 0,
  normalSyncSkippedForBackfill: false,
  backfillOrdering: 'active-then-nearest-completion',
  backfillNextSeries: null,
  episodePaginationPagesFetched: 0,
  episodePaginationErrors: 0,
  episodePaginationTruncated: 0,
  episodeDiscoveryIncomplete: 0,

  incrementalCandidates: 0,
  incrementalProcessed: 0,
  recentMoviePagesScanned: 0,
  recentMovieCandidates: 0,
  recentMovieNewCandidates: 0,
  recentMoviesProcessed: 0,
  recentSeriesPagesScanned: 0,
  recentSeriesCandidates: 0,
  recentSeriesNewCandidates: 0,
  recentSeriesProcessed: 0,
  affiliateRequestScopes: {},
  skippedByScopedBudget: 0,

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
  duplicateCatalogItemsMerged: operatorCleanup.duplicatesMerged,
  iranianSeriesDiagnostics: [],
  operatorDiagnostics: [],
  seriesEpisodeDiagnostics: [],
  catalogEpisodeGapDiagnostics: [],
  episodesDiscovered: 0,
  episodeGroupsAdded: 0,
  episodeArtworkCandidates: 0,
  episodeArtworkSeriesChecked: 0,
  episodeArtworkAdded: 0,
  episodeArtworkMirrored: 0,
  episodesRejectedNoLinks: 0,

  moviesAddedOrUpdated: 0,
  seriesAddedOrUpdated: 0,

  affiliateRequests: 0,
  affiliateCacheHits: 0,
  affiliateNotFound: 0,
  rateLimitHits: 0,
  rateLimitWaitMs: 0,
  skippedByBudget: 0,
  imagesMirrored: 0,
  imageMirrorErrors: 0,
  peopleEnrichmentCandidates: 0,
  peopleEnrichmentProcessed: 0,
  peopleEnrichmentSucceeded: 0,
  peopleEnrichmentFailed: 0,
  peopleEnrichmentSkippedFresh: 0,
  peopleEnrichmentFromSource: 0,
  peopleEnrichmentFromTmdb: 0,
  peopleEnrichmentFromImdb: 0,
  peopleAdded: 0,
  tmdbRequests: 0,
  imdbRequests: 0,

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
  syncModeSetting === 'PEOPLE'
    ? 'PEOPLE'
    : syncModeSetting === 'BACKFILL' ||
      (syncModeSetting === 'AUTO' && initialBackfillQueue.length > 0)
      ? 'BACKFILL'
      : 'NORMAL';

stats.effectiveSyncMode = effectiveSyncMode;
console.log(`حالت اجرا: ${effectiveSyncMode}`);

if (effectiveSyncMode === 'PEOPLE') {
  // Fill episode artwork first so this user-visible repair cannot be starved
  // by slower external cast lookups. Remaining time continues cast enrichment.
  await syncEpisodeArtworkMetadata();
  if (!runTimeBudgetReached('before-people-metadata', 60000)) {
    await syncPeopleMetadata();
  }
} else if (effectiveSyncMode === 'BACKFILL') {
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
  // Guaranteed discovery comes first and receives independent request quotas.
  // Page scans always begin at page 1, so newly published titles are checked
  // every hour even while the long-running archive cursors continue elsewhere.
  await withAffiliateRequestScope(
    'recent-movies',
    recentMovieRequestQuota,
    syncRecentMovieDiscovery,
  );

  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-recent-series', 90000)) {
    await withAffiliateRequestScope(
      'recent-series',
      recentSeriesRequestQuota,
      syncRecentSeriesDiscovery,
    );
  }

  // Operator-only links are a first-class discovery target. Run these passes
  // before maintenance/archive work so the global budget cannot starve them.
  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-operator-movies', 80000)) {
    await withAffiliateRequestScope(
      'operator-movies',
      operatorMovieRequestQuota,
      syncOperatorMovieArchive,
    );
  }

  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-operator-series', 75000)) {
    await withAffiliateRequestScope(
      'operator-series',
      operatorSeriesRequestQuota,
      syncOperatorSeriesArchive,
    );
  }

  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-incremental', 75000)) {
    await withAffiliateRequestScope(
      'incremental',
      incrementalRequestQuota,
      syncIncrementalTitles,
    );
  }

  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-airing', 70000)) {
    await withAffiliateRequestScope(
      'airing-series',
      airingRequestQuota,
      syncAiringSeriesUpdates,
    );
  }

  // The remaining passes continue the wider catalog crawl, but each one is
  // fenced by a small quota. None of them can steal the reserved discovery
  // capacity from the next hourly run.
  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-archive-movies', 60000)) {
    await withAffiliateRequestScope(
      'archive-movies',
      archiveMovieRequestQuota,
      syncMovieArchive,
    );
  }

  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-archive-series', 60000)) {
    await withAffiliateRequestScope(
      'archive-series',
      archiveSeriesRequestQuota,
      syncSeriesArchive,
    );
  }

  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-iranian-series', 55000)) {
    await withAffiliateRequestScope(
      'iranian-series',
      iranianSeriesRequestQuota,
      syncIranianSeriesArchive,
    );
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
items = items.map(reclassifyCatalogItem).map((item) => withSeriesPublicationState(item));
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

const imageMirroringReserveMs = effectiveSyncMode === 'PEOPLE' ? 30000 : 90000;
if (
  effectiveSyncMode !== 'BACKFILL' &&
  maxMirroredImagesPerRun > 0 &&
  !runTimeBudgetReached('image-mirroring', imageMirroringReserveMs)
) {
  await mirrorCatalogEpisodeImages(items, episodeArtworkMirrorPerRun);
  await mirrorCatalogPeopleImages(items, catalog.featuredPeople);
} else {
  stats.imageMirroringSkipped = true;
}

const now = new Date().toISOString();

const output = {
  ...catalog,
  version: CATALOG_VERSION,
  updatedAt: now,
  items,
  iranianSchedule,
  weeklySchedule,
};

state.lastSyncAt = now;

stats.finishedAt = now;
stats.finalCount = items.length;
stats.affiliateRequests = affiliateRequestsUsed;
stats.remainingRunMsAtFinish = Math.max(0, runDeadlineAtMs - Date.now());

await writeCatalogAndManifest(output);
await writeJson(statePath, state);
await writeJson(reportPath, stats);
await writeJson(
  path.join(root, `sync-report-${effectiveSyncMode.toLowerCase()}.json`),
  stats,
);
await stageMirroredAssets();

console.log(
  `پایان همگام‌سازی؛ ${items.length} عنوان حفظ شد.`,
);

function candidateSourceTimestamp(candidate) {
  return Date.parse(
    candidate?.updated_at ||
    candidate?.updatedAt ||
    candidate?.created_at ||
    candidate?.createdAt ||
    '',
  ) || 0;
}

function existingSourceTimestamp(item) {
  return Date.parse(
    item?.sourceUpdatedAt ||
    item?.updatedAt ||
    item?.sourceCreatedAt ||
    item?.createdAt ||
    '',
  ) || 0;
}

function discoveryCandidatePriority(candidate, type) {
  const existing = findExistingItem(candidate, type);
  if (!existing) return 0;
  const sourceTime = candidateSourceTimestamp(candidate);
  const existingTime = existingSourceTimestamp(existing);
  if (sourceTime && sourceTime > existingTime + 1000) return 1;
  if (type === 'movie') {
    const hasMedia = Boolean(
      existing?.streamUrl ||
      (Array.isArray(existing?.downloads) && existing.downloads.some(
        (section) => Array.isArray(section?.files) && section.files.length > 0,
      )),
    );
    if (!hasMedia) return 2;
  }
  return 99;
}

async function collectRecentPageCandidates(kind, pageCount) {
  const collected = [];
  for (let page = 1; page <= pageCount; page += 1) {
    if (runTimeBudgetReached(`recent-${kind}-page-${page}`, 90000)) break;
    try {
      const payload = kind === 'movie'
        ? await fetchMoviePage(page)
        : await fetchSeriesPage(page);
      collected.push(...(payload.items || []));
      if (kind === 'movie') stats.recentMoviePagesScanned += 1;
      else stats.recentSeriesPagesScanned += 1;
      if (page >= positiveInt(payload.lastPage, page)) break;
    } catch (error) {
      rememberError(`recent-${kind}-page-${page}`, error);
      break;
    }
  }
  return dedupeCandidates(collected);
}

async function syncRecentMovieDiscovery() {
  const candidates = await collectRecentPageCandidates('movie', recentMoviePagesPerRun);
  stats.recentMovieCandidates = candidates.length;
  const selected = candidates
    .map((candidate) => ({
      candidate,
      priority: discoveryCandidatePriority(candidate, 'movie'),
      timestamp: candidateSourceTimestamp(candidate),
    }))
    .filter((entry) => entry.priority < 99)
    .sort((a, b) => a.priority - b.priority || b.timestamp - a.timestamp)
    .slice(0, recentMovieTitlesPerRun);

  stats.recentMovieNewCandidates = selected.filter((entry) => entry.priority === 0).length;
  for (const { candidate } of selected) {
    if (affiliateBudgetExhausted || affiliateScopeExhausted) break;
    try {
      const result = await processMovie(candidate, 'recent-discovery');
      if (result?.retryLater && affiliateScopeExhausted) break;
      stats.recentMoviesProcessed += 1;
    } catch (error) {
      rememberError(`recent-movie-${candidate?.id || candidate?.t_id || 'unknown'}`, error);
    }
  }
}

async function syncRecentSeriesDiscovery() {
  const candidates = await collectRecentPageCandidates('series', recentSeriesPagesPerRun);
  stats.recentSeriesCandidates = candidates.length;
  const selected = candidates
    .map((candidate) => ({
      candidate,
      priority: discoveryCandidatePriority(candidate, 'series'),
      timestamp: candidateSourceTimestamp(candidate),
    }))
    .filter((entry) => entry.priority < 99)
    .sort((a, b) => a.priority - b.priority || b.timestamp - a.timestamp)
    .slice(0, recentSeriesTitlesPerRun);

  stats.recentSeriesNewCandidates = selected.filter((entry) => entry.priority === 0).length;
  for (const { candidate } of selected) {
    if (affiliateBudgetExhausted || affiliateScopeExhausted) break;
    try {
      const result = await processSeries(candidate, 'recent-discovery', {
        episodeStrategy: 'latest',
        episodeLimit: recentSeriesEpisodeLimit,
        onlyMissing: true,
      });
      stats.recentSeriesProcessed += 1;
      if (result?.retryLater && affiliateScopeExhausted) break;
    } catch (error) {
      rememberError(`recent-series-${candidate?.id || candidate?.t_id || 'unknown'}`, error);
    }
  }
}

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
      if (affiliateBudgetExhausted || affiliateScopeExhausted) break;

      try {
        const result = await processCandidate(candidate, 'incremental');
        stats.incrementalProcessed += 1;
        if (result?.retryLater && affiliateScopeExhausted) break;
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
    if (affiliateBudgetExhausted || affiliateScopeExhausted) break;
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
      if (result?.retryLater && affiliateScopeExhausted) break;
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
  let processedSeries = 0;
  let completedInThisRun = 0;
  const visitedThisRun = new Set();

  while (
    !affiliateBudgetExhausted &&
    !runTimeBudgetReached('backfill-loop') &&
    processedSeries < backfillSeriesPerRun
  ) {
    const queue = buildSequentialBackfillQueue();
    stats.incompleteSeriesCandidates = queue.length;
    stats.backfillQueueTotal = Math.max(stats.backfillQueueTotal, queue.length);

    if (!queue.length) {
      clearActiveBackfillSeries();
      state.archiveBackfillOffset = 0;
      break;
    }

    // The queue is already ordered for visible progress. Always take the first
    // unvisited entry instead of rotating past almost-complete series.
    const active = queue.find((candidate) => {
      const candidateId = String(candidate?.item?.id || '');
      return candidateId && !visitedThisRun.has(candidateId);
    });
    state.archiveBackfillOffset = 0;

    // Every currently queued title has already received a fair slice in this run.
    if (!active) break;

    const id = String(active.item.id || '');
    const title = active.item.nameFa || active.item.name || id;
    visitedThisRun.add(id);
    processedSeries += 1;
    stats.backfillSeriesVisited = processedSeries;
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

    console.log(`تکمیل سریع آرشیو: ${title}`);
    const beforeTotal = active.deficit.total;
    const remainingBudget = Math.max(0, maxAffiliateRequests - affiliateRequestsUsed);
    if (remainingBudget <= 1) break;

    let result;
    try {
      result = await processSeries(
        { id, type: 'series' },
        'fast-backfill',
        {
          episodeStrategy: 'latest',
          episodeLimit: Math.max(1, Math.min(
            backfillEpisodesPerSeries,
            backfillEpisodeLimit,
            Math.max(1, remainingBudget - 1),
          )),
          onlyMissing: true,
        },
      );
    } catch (error) {
      rememberError(`fast-backfill-${id || 'unknown'}`, error);
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
      completedInThisRun += 1;
    } else {
      stats.incompleteSeriesStillMissing += 1;
      if (progressed) {
        state.archiveBackfillNoProgress[id] = 0;
      } else if (!affiliateBudgetExhausted) {
        state.archiveBackfillNoProgress[id] =
          nonNegativeInt(state.archiveBackfillNoProgress[id], 0) + 1;
      }

      const noProgressRuns = nonNegativeInt(state.archiveBackfillNoProgress[id], 0);
      stats.backfillNoProgressRuns = Math.max(stats.backfillNoProgressRuns, noProgressRuns);
      if (!affiliateBudgetExhausted && noProgressRuns >= maxBackfillNoProgressRuns) {
        // Do not freeze the global queue on one broken title. Mark it for a later
        // retry and immediately continue with the remaining archive.
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
      }
    }

    rememberDiagnostic('seriesEpisodeDiagnostics', {
      seriesId: id,
      title,
      source: 'fast-backfill-summary',
      missingBefore: active.deficit.missing,
      pendingBefore: active.deficit.pending,
      missingAfter: remaining.missing,
      pendingAfter: remaining.pending,
      publicationStatus: refreshed?.publicationStatus || '',
      result: completed ? 'completed' : affiliateBudgetExhausted ? 'paused-by-budget' : 'advanced',
      addedEpisodes,
      unavailableMarked: Number(result?.unavailableMarked || 0),
    });

    clearActiveBackfillSeries();
    await persistSyncCheckpoint(`backfill-${id}`);
    if (runTimeBudgetReached('after-backfill-checkpoint')) break;
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
      if (blocked && !blockedSeriesRetryDue(entry.item)) return false;
      return (
        entry.deficit.total > 0 ||
        entry.item?.publicationStatus !== 'published' ||
        !hasSeriesArchiveMetadata(entry.item) ||
        seriesHasUnavailableRetryDue(entry.item)
      );
    })
    .sort((a, b) => {
      const activeId = String(state.archiveBackfillSeriesId || '');
      const aActive = String(a.item?.id || '') === activeId;
      const bActive = String(b.item?.id || '') === activeId;
      if (aActive !== bActive) return aActive ? -1 : 1;

      const aNeedsArchive =
        a.deficit.total > 0 ||
        a.item?.publicationStatus !== 'published' ||
        !hasSeriesArchiveMetadata(a.item);
      const bNeedsArchive =
        b.deficit.total > 0 ||
        b.item?.publicationStatus !== 'published' ||
        !hasSeriesArchiveMetadata(b.item);
      if (aNeedsArchive !== bNeedsArchive) return aNeedsArchive ? -1 : 1;

      // Finish the closest archive first so each run produces visible results
      // instead of adding a few episodes to many different series.
      const deficitDiff = a.deficit.total - b.deficit.total;
      if (deficitDiff) return deficitDiff;

      const aAiring = Boolean(a.item?.isAiring);
      const bAiring = Boolean(b.item?.isAiring);
      if (aAiring !== bAiring) return aAiring ? -1 : 1;

      const yearDiff = seriesBackfillYear(b.item) - seriesBackfillYear(a.item);
      if (yearDiff) return yearDiff;

      const dateDiff =
        seriesBackfillTimestamp(b.item) -
        seriesBackfillTimestamp(a.item);
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

    return processSeries(
      { id: seriesId },
      source,
      {
        onlyEpisodeId: candidate.id,
      },
    );
  }

  if (type === 'series') {
    return processSeries(candidate, source);
  }

  if (type === 'movie') {
    return processMovie(candidate, source);
  }

  return null;
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
  const mergedMedia = mergeMovieMedia(existing, media);
  const normalized = normalizeMovie(movie, mergedMedia, source, existing);

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

function archiveEpisodeKey(seriesId, episode) {
  const episodeId = cleanText(episode?.id || episode?.sourceEpisodeId || '');
  if (episodeId) return `${String(seriesId)}:id:${episodeId}`;
  return `${String(seriesId)}:s${episodeSeasonNumber(episode)}e${episodeNumberValue(episode)}`;
}

function existingUnavailableEpisodeMap(seriesId, existing) {
  const map = new Map();
  for (const entry of Array.isArray(existing?.archiveUnavailableEpisodes)
    ? existing.archiveUnavailableEpisodes
    : []) {
    const key = archiveEpisodeKey(seriesId, entry);
    map.set(key, {
      sourceEpisodeId: cleanText(entry?.sourceEpisodeId || entry?.id || ''),
      seasonNumber: nonNegativeInt(entry?.seasonNumber, 0),
      episodeNumber: nonNegativeInt(entry?.episodeNumber, 0),
      reason: cleanText(entry?.reason || 'no-usable-links'),
      attempts: positiveInt(entry?.attempts, episodeUnavailableAfterAttempts),
      markedAt: entry?.markedAt || new Date().toISOString(),
    });
  }
  return map;
}

function unavailableEpisodeRetryDue(entry, sourceEpisode = null) {
  if (!entry) return true;

  const markedAtMs = Date.parse(String(entry.markedAt || ''));
  const sourceUpdatedMs = Date.parse(String(
    sourceEpisode?.updated_at ||
    sourceEpisode?.updatedAt ||
    sourceEpisode?.created_at ||
    sourceEpisode?.createdAt ||
    '',
  ));
  if (
    Number.isFinite(sourceUpdatedMs) &&
    (!Number.isFinite(markedAtMs) || sourceUpdatedMs > markedAtMs)
  ) {
    return true;
  }

  if (!Number.isFinite(markedAtMs)) return true;
  return Date.now() - markedAtMs >= unavailableEpisodeRetryHours * 60 * 60 * 1000;
}

function seriesHasUnavailableRetryDue(item) {
  return (Array.isArray(item?.archiveUnavailableEpisodes)
    ? item.archiveUnavailableEpisodes
    : []
  ).some((entry) => unavailableEpisodeRetryDue(entry));
}

function blockedSeriesRetryDue(item) {
  if (retryBlockedBackfill) return true;
  const blockedAtMs = Date.parse(String(item?.archiveBlockedAt || ''));
  if (!Number.isFinite(blockedAtMs)) return true;
  return Date.now() - blockedAtMs >= blockedBackfillRetryHours * 60 * 60 * 1000;
}

function clearArchiveEpisodeFailure(seriesId, episode, unavailableMap) {
  const key = archiveEpisodeKey(seriesId, episode);
  delete state.archiveEpisodeFailures[key];
  unavailableMap.delete(key);
}

function registerArchiveEpisodeFailure(seriesId, episode, reason, unavailableMap) {
  const key = archiveEpisodeKey(seriesId, episode);
  if (episodeFailureRegisteredThisRun.has(key)) return false;
  episodeFailureRegisteredThisRun.add(key);

  const attempts = nonNegativeInt(state.archiveEpisodeFailures[key], 0) + 1;
  state.archiveEpisodeFailures[key] = attempts;
  if (attempts < episodeUnavailableAfterAttempts) return false;

  const wasUnavailable = unavailableMap.has(key);
  if (!wasUnavailable) stats.episodesMarkedUnavailable += 1;
  unavailableMap.set(key, {
    sourceEpisodeId: cleanText(episode?.id || episode?.sourceEpisodeId || ''),
    seasonNumber: episodeSeasonNumber(episode),
    episodeNumber: episodeNumberValue(episode),
    reason: cleanText(reason || 'no-usable-links'),
    attempts,
    markedAt: new Date().toISOString(),
  });
  return !wasUnavailable;
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
  const unavailableEpisodeMap = existingUnavailableEpisodeMap(id, existing);
  let unavailableMarked = 0;
  const previousGroups = Array.isArray(existing?.downloads)
    ? existing.downloads
    : [];
  const mergedGroups = [...previousGroups];
  stats.episodeArtworkAdded += hydrateEpisodeGroupArtwork(mergedGroups, episodes);

  let selectedEpisodes = [];
  let cursor = 0;

  const missingEpisodes = episodes
    .filter((episode) => !findEpisodeGroup(previousGroups, episode))
    .filter((episode) => {
      const unavailable = unavailableEpisodeMap.get(archiveEpisodeKey(id, episode));
      return !unavailable || unavailableEpisodeRetryDue(unavailable, episode);
    })
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
        if (registerArchiveEpisodeFailure(id, episode, 'no-usable-links', unavailableEpisodeMap)) {
          unavailableMarked += 1;
        }
        continue;
      }

      clearArchiveEpisodeFailure(id, episode, unavailableEpisodeMap);
      const previousGroup = findEpisodeGroup(mergedGroups, episode);
      const nextGroup = episodeGroup(episode, media);
      upsertEpisodeGroup(mergedGroups, nextGroup);

      if (!previousGroup) {
        addedEpisodes += 1;
        stats.episodeGroupsAdded += 1;
        latestAddedEpisode = episode;
      }
    } catch (error) {
      if (isRunTimeBudgetError(error)) {
        stoppedByBudget = true;
        affiliateBudgetExhausted = true;
        break;
      }
      rememberError(`episode-${episode.id}`, error);
      if (registerArchiveEpisodeFailure(id, episode, 'request-error', unavailableEpisodeMap)) {
        unavailableMarked += 1;
      }
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

  // A repeatedly unavailable source episode is excluded from the publishability
  // deficit and retried on a bounded schedule. This prevents a permanent 404
  // from hiding an otherwise complete series forever.
  const remainingSourceEpisodes = episodes.filter(
    (episode) =>
      !findEpisodeGroup(mergedGroups, episode) &&
      !unavailableEpisodeMap.has(archiveEpisodeKey(id, episode)),
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
      unavailableEpisodes: [...unavailableEpisodeMap.values()],
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
    unavailableMarked,
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

function affiliateScopeUsed() {
  return Math.max(0, affiliateRequestsUsed - affiliateScopeStart);
}

function affiliateScopeLimitReached() {
  return Number.isFinite(affiliateScopeLimit) && affiliateScopeUsed() >= affiliateScopeLimit;
}

async function withAffiliateRequestScope(name, limit, task) {
  const previous = {
    name: affiliateScopeName,
    start: affiliateScopeStart,
    limit: affiliateScopeLimit,
    exhausted: affiliateScopeExhausted,
  };
  affiliateScopeName = String(name || 'unnamed');
  affiliateScopeStart = affiliateRequestsUsed;
  affiliateScopeLimit = Math.max(0, nonNegativeInt(limit, 0));
  affiliateScopeExhausted = false;
  try {
    return await task();
  } finally {
    stats.affiliateRequestScopes[affiliateScopeName] = {
      limit: affiliateScopeLimit,
      used: affiliateScopeUsed(),
      exhausted: affiliateScopeExhausted,
    };
    affiliateScopeName = previous.name;
    affiliateScopeStart = previous.start;
    affiliateScopeLimit = previous.limit;
    affiliateScopeExhausted = previous.exhausted;
  }
}

async function fetchAffiliateLinks(
  id,
  type,
) {
  const cacheKey = `${String(type || '')}:${String(id || '')}`;
  if (affiliateLinkCache.has(cacheKey)) {
    stats.affiliateCacheHits += 1;
    return affiliateLinkCache.get(cacheKey);
  }

  if (runTimeBudgetReached('affiliate-request', 30000)) {
    stats.skippedByBudget += 1;
    return { links: [], skipped: true, reason: 'time-budget' };
  }

  if (affiliateScopeLimitReached()) {
    affiliateScopeExhausted = true;
    stats.skippedByScopedBudget += 1;
    return {
      links: [],
      skipped: true,
      reason: `scope-budget:${affiliateScopeName || 'unnamed'}`,
    };
  }

  if (
    affiliateRequestsUsed >=
    maxAffiliateRequests
  ) {
    affiliateBudgetExhausted = true;
    stats.skippedByBudget += 1;

    return {
      links: [],
      skipped: true,
      reason: 'global-request-budget',
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

  try {
    const json = await fetchJson(
      url,
      { method: 'POST' },
    );

    const links =
      json?.data?.links ??
      json?.links ??
      [];
    const result = {
      links: Array.isArray(links)
        ? links
        : [],
      skipped: false,
    };
    affiliateLinkCache.set(cacheKey, result);
    return result;
  } catch (error) {
    // The affiliate endpoint uses 404 for an existing title/episode that has
    // no affiliate files. It is a normal empty result, not a retryable outage.
    if (Number(error?.status) === 404) {
      stats.affiliateNotFound += 1;
      const result = {
        links: [],
        skipped: false,
        notFound: true,
      };
      affiliateLinkCache.set(cacheKey, result);
      return result;
    }
    throw error;
  }
}

async function throttleAffiliateRequest() {
  const elapsed =
    Date.now() -
    lastAffiliateRequestAt;

  const remaining =
    affiliateRequestDelay -
    elapsed;

  if (remaining > 0) {
    await sleepWithinRunBudget(remaining, 'affiliate-throttle');
  }

  throwIfRunTimeBudgetReached('affiliate-throttle-finished', 30000);
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

  const operatorFiles = operatorLinks
    .map((link) => toOperatorFile(link))
    .filter(Boolean);

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

function mergeDownloadSections(existingSections, incomingSections) {
  const order = [];
  const byId = new Map();

  for (const section of [
    ...(Array.isArray(existingSections) ? existingSections : []),
    ...(Array.isArray(incomingSections) ? incomingSections : []),
  ]) {
    if (!section || typeof section !== 'object') continue;
    const id = cleanText(section.id || '') || `section-${simpleHash(JSON.stringify(section))}`;
    const current = byId.get(id);
    const next = current
      ? {
          ...current,
          ...section,
          id,
          files: dedupeMediaFiles([
            ...(Array.isArray(current.files) ? current.files : []),
            ...(Array.isArray(section.files) ? section.files : []),
          ]),
        }
      : {
          ...section,
          id,
          files: dedupeMediaFiles(Array.isArray(section.files) ? section.files : []),
        };

    if (!byId.has(id)) order.push(id);
    byId.set(id, next);
  }

  return order
    .map((id) => byId.get(id))
    .filter((section) => Array.isArray(section?.files) && section.files.length > 0);
}

function mergeMovieMedia(existing, media) {
  const downloads = mergeDownloadSections(existing?.downloads, media?.downloads);
  const allFiles = downloads.flatMap((section) => section.files || []);
  const operatorFiles = allFiles.filter((file) => isValidStoredOperatorFile(file));

  return {
    ...media,
    downloads,
    streamUrl: media?.streamUrl || existing?.streamUrl || null,
    operatorFiles,
    operatorAccess: operatorAccessFromFiles(operatorFiles),
    supportedOperators: uniqueStrings(
      operatorFiles.flatMap((file) => file.supportedOperators || []),
    ),
  };
}

function chooseCanonicalTitle(left, right) {
  const values = [cleanText(left), cleanText(right)].filter(Boolean);
  if (!values.length) return '';
  return [...values].sort((a, b) => {
    const aIdentity = normalizeIdentityName(a);
    const bIdentity = normalizeIdentityName(b);
    if (aIdentity === bIdentity) return a.length - b.length;
    return b.length - a.length;
  })[0];
}

function peopleImageValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return cleanText(value);
  if (typeof value === 'object') {
    return cleanText(value.url || value.imageUrl || value.src || value.contentUrl || '');
  }
  return '';
}

function personSourceId(value) {
  const text = cleanText(value);
  const nm = text.match(/(?:^|\/)(nm\d{5,12})(?:\/|$|[?#])/i);
  return nm ? nm[1].toLowerCase() : '';
}

function sourcePersonToCatalog(person, fallbackRole = 'actor', order = 0) {
  if (!person) return null;
  if (typeof person === 'string') {
    const name = cleanText(person);
    if (!name) return null;
    return {
      id: `source-person-${simpleHash(normalizeIdentityName(name))}`,
      nameFa: name,
      name,
      role: fallbackRole,
      roleLabel: fallbackRole === 'director' ? 'کارگردان' : 'بازیگر',
      order,
      source: 'upera',
    };
  }

  if (typeof person !== 'object') return null;
  const name = cleanText(
    person.name_fa || person.nameFa || person.name || person.original_name ||
    person.full_name || person.title || '',
  );
  if (!name) return null;

  const roleText = cleanText(
    person.role || person.type || person.job || person.department || person.known_for_department || '',
  ).toLowerCase();
  const role = /director|کارگردان/.test(roleText) ? 'director' : fallbackRole;
  const tmdbId = Number(person.tmdb_id || person.tmdbId || 0);
  const externalId = cleanText(person.imdb_id || person.imdbId || person.url || '');
  const sourceId = personSourceId(externalId);
  let image = peopleImageValue(
    person.image || person.photo || person.avatar || person.profile || person.profile_path,
  );
  if (image && image.startsWith('/')) image = `https://image.tmdb.org/t/p/w500${image}`;
  if (image && !/^https?:\/\//i.test(image) && !/^(?:\.\/)?assets\/media\//i.test(image)) image = '';

  return {
    id: tmdbId > 0
      ? `tmdb-person-${tmdbId}`
      : cleanText(person.id) || sourceId || `source-person-${simpleHash(normalizeIdentityName(name))}`,
    nameFa: cleanText(person.name_fa || person.nameFa || name),
    name: cleanText(person.original_name || person.name || name),
    role,
    roleLabel: role === 'director' ? 'کارگردان' : 'بازیگر',
    ...(cleanText(person.character || person.role_name || person.as) ? {
      character: cleanText(person.character || person.role_name || person.as),
    } : {}),
    ...(image ? { image } : {}),
    order: nonNegativeInt(person.order, order),
    ...(tmdbId > 0 ? { tmdbId } : {}),
    ...(isFiniteNumber(person.popularity) ? { popularity: Number(person.popularity) } : {}),
    source: 'upera',
  };
}

function extractSourcePeople(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const result = [];
  const addArray = (value, role) => {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    values.forEach((entry, index) => {
      const person = sourcePersonToCatalog(entry, role, index);
      if (person) result.push(person);
    });
  };

  addArray(payload.people, 'actor');
  addArray(payload.cast, 'actor');
  addArray(payload.casts, 'actor');
  addArray(payload.actors, 'actor');
  addArray(payload.actor, 'actor');
  addArray(payload.directors, 'director');
  addArray(payload.director, 'director');

  if (Array.isArray(payload.crew)) {
    for (const entry of payload.crew) {
      const roleText = cleanText(entry?.job || entry?.role || '').toLowerCase();
      if (!/director|کارگردان/.test(roleText)) continue;
      const person = sourcePersonToCatalog(entry, 'director', 0);
      if (person) result.push(person);
    }
  }

  return mergePeople([], result).slice(0, peopleEnrichmentMaxPeople);
}

function validImdbTitleId(value) {
  const match = cleanText(value).match(/tt\d{5,12}/i);
  return match ? match[0].toLowerCase() : '';
}

function tmdbProfileUrl(profilePath) {
  const value = cleanText(profilePath);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://image.tmdb.org/t/p/w500/${value.replace(/^\/+/, '')}`;
}

function tmdbCreditPerson(person, role, order = 0) {
  if (!person || typeof person !== 'object') return null;
  const tmdbId = Number(person.id || 0);
  const name = cleanText(person.name || person.original_name || '');
  if (!tmdbId || !name) return null;
  const image = tmdbProfileUrl(person.profile_path);
  return {
    id: `tmdb-person-${tmdbId}`,
    tmdbId,
    nameFa: name,
    name: cleanText(person.original_name || name),
    role,
    roleLabel: role === 'director' ? 'کارگردان' : 'بازیگر',
    ...(role === 'actor' && cleanText(person.character) ? { character: cleanText(person.character) } : {}),
    ...(image ? { image } : {}),
    order: role === 'director' ? Math.min(-1, -1 - order) : nonNegativeInt(person.order, order),
    ...(isFiniteNumber(person.popularity) ? { popularity: Number(person.popularity) } : {}),
    source: 'tmdb',
  };
}

async function fetchTmdbJson(pathname, query = {}) {
  if (!tmdbBearerToken) return null;
  const url = new URL(`https://api.themoviedb.org/3/${String(pathname).replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  stats.tmdbRequests += 1;
  return fetchJson(url, {
    headers: {
      Authorization: `Bearer ${tmdbBearerToken}`,
      'Content-Type': 'application/json;charset=utf-8',
    },
  });
}

function tmdbResultYear(result, type) {
  const raw = type === 'series' ? result?.first_air_date : result?.release_date;
  const match = cleanText(raw).match(/^(\d{4})/);
  return match ? Number(match[1]) : 0;
}

function selectTmdbSearchResult(item, results) {
  const names = uniqueStrings([item?.name, item?.nameFa])
    .map(normalizeIdentityName)
    .filter(Boolean);
  const year = Number(item?.year || 0);
  const ranked = (Array.isArray(results) ? results : [])
    .map((result) => {
      const resultNames = uniqueStrings([
        result?.title, result?.original_title, result?.name, result?.original_name,
      ]).map(normalizeIdentityName).filter(Boolean);
      const exactName = resultNames.some((name) => names.includes(name));
      const resultYear = tmdbResultYear(result, item?.type);
      const yearDistance = year && resultYear ? Math.abs(year - resultYear) : 0;
      return { result, exactName, yearDistance, popularity: Number(result?.popularity || 0) };
    })
    .filter((entry) => entry.exactName && entry.yearDistance <= 1)
    .sort((a, b) => a.yearDistance - b.yearDistance || b.popularity - a.popularity);
  return ranked[0]?.result || null;
}

async function resolveTmdbTitle(item) {
  if (!tmdbBearerToken) return null;
  const mediaType = item?.type === 'series' ? 'tv' : 'movie';
  const imdbId = validImdbTitleId(item?.imdb);
  if (imdbId) {
    const found = await fetchTmdbJson(`find/${imdbId}`, { external_source: 'imdb_id' });
    const direct = mediaType === 'tv' ? found?.tv_results?.[0] : found?.movie_results?.[0];
    if (direct?.id) return { id: Number(direct.id), mediaType };
  }

  const query = cleanText(item?.name || item?.nameFa);
  if (!query) return null;
  const search = await fetchTmdbJson(`search/${mediaType}`, {
    query,
    include_adult: 'false',
    language: 'en-US',
    ...(item?.year ? { [mediaType === 'tv' ? 'first_air_date_year' : 'year']: item.year } : {}),
  });
  const selected = selectTmdbSearchResult(item, search?.results);
  return selected?.id ? { id: Number(selected.id), mediaType } : null;
}

async function enrichPeopleFromTmdb(item) {
  const title = await resolveTmdbTitle(item);
  if (!title) return null;
  const credits = await fetchTmdbJson(`${title.mediaType}/${title.id}/credits`, { language: 'en-US' });
  const directors = (Array.isArray(credits?.crew) ? credits.crew : [])
    .filter((person) => cleanText(person?.job).toLowerCase() === 'director')
    .slice(0, 2)
    .map((person, index) => tmdbCreditPerson(person, 'director', index))
    .filter(Boolean);
  const castLimit = Math.max(1, peopleEnrichmentMaxPeople - directors.length);
  const actors = (Array.isArray(credits?.cast) ? credits.cast : [])
    .slice(0, castLimit)
    .map((person, index) => tmdbCreditPerson(person, 'actor', index))
    .filter(Boolean);
  const people = mergePeople(directors, actors).slice(0, peopleEnrichmentMaxPeople);
  return people.length ? { people, tmdbId: title.id, source: 'tmdb' } : null;
}

function decodeBasicHtmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function fetchTextDocument(input) {
  const url = String(input);
  const controller = new AbortController();
  const remaining = Math.max(1000, runDeadlineAtMs - Date.now() - runCheckpointReserveMs);
  const timeout = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, remaining));
  try {
    stats.imdbRequests += 1;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} برای ${url}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function imdbJsonLdPeople(documentText) {
  const matches = [...String(documentText || '').matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )];
  for (const match of matches) {
    try {
      const parsed = JSON.parse(decodeBasicHtmlEntities(match[1]).trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const directorsRaw = Array.isArray(node.director) ? node.director : node.director ? [node.director] : [];
        const actorsRaw = Array.isArray(node.actor) ? node.actor : node.actor ? [node.actor] : [];
        const directors = directorsRaw.slice(0, 2).map((person, index) => {
          const name = cleanText(person?.name);
          if (!name) return null;
          const externalId = personSourceId(person?.url || person?.['@id'] || '');
          const image = peopleImageValue(person?.image);
          return {
            id: externalId || `imdb-person-${simpleHash(normalizeIdentityName(name))}`,
            nameFa: name,
            name,
            role: 'director',
            roleLabel: 'کارگردان',
            ...(image ? { image } : {}),
            order: -1 - index,
            source: 'imdb',
          };
        }).filter(Boolean);
        const actors = actorsRaw.slice(0, Math.max(1, peopleEnrichmentMaxPeople - directors.length)).map((person, index) => {
          const name = cleanText(person?.name);
          if (!name) return null;
          const externalId = personSourceId(person?.url || person?.['@id'] || '');
          const image = peopleImageValue(person?.image);
          return {
            id: externalId || `imdb-person-${simpleHash(normalizeIdentityName(name))}`,
            nameFa: name,
            name,
            role: 'actor',
            roleLabel: 'بازیگر',
            ...(image ? { image } : {}),
            order: index,
            source: 'imdb',
          };
        }).filter(Boolean);
        const people = mergePeople(directors, actors).slice(0, peopleEnrichmentMaxPeople);
        if (people.length) return people;
      }
    } catch {
      // Other JSON-LD blocks may not be title metadata.
    }
  }
  return [];
}

async function resolveImdbTitleId(item) {
  const existing = validImdbTitleId(item?.imdb);
  if (existing) return existing;
  const query = cleanText(item?.name || item?.nameFa);
  if (!query) return '';

  stats.imdbRequests += 1;
  const suggestionUrl = `https://v2.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`;
  const suggestion = await fetchJson(suggestionUrl);
  const itemNames = uniqueStrings([item?.name, item?.nameFa])
    .map(normalizeIdentityName)
    .filter(Boolean);
  const itemYear = Number(item?.year || 0);
  const ranked = (Array.isArray(suggestion?.d) ? suggestion.d : [])
    .map((candidate) => {
      const id = validImdbTitleId(candidate?.id);
      const title = normalizeIdentityName(candidate?.l || candidate?.title || '');
      const year = Number(candidate?.y || 0);
      const typeText = cleanText(candidate?.q || candidate?.qid || '').toLowerCase();
      const nameMatches = Boolean(title && itemNames.includes(title));
      const yearDistance = itemYear && year ? Math.abs(itemYear - year) : 0;
      const typeMatches = item?.type === 'series'
        ? /series|mini|tv/.test(typeText)
        : !/series|episode/.test(typeText);
      return { id, nameMatches, yearDistance, typeMatches, rank: Number(candidate?.rank || 999999) };
    })
    .filter((candidate) => candidate.id && candidate.nameMatches && candidate.yearDistance <= 1 && candidate.typeMatches)
    .sort((a, b) => a.yearDistance - b.yearDistance || a.rank - b.rank);
  return ranked[0]?.id || '';
}

async function enrichPeopleFromImdb(item) {
  const imdbId = await resolveImdbTitleId(item);
  if (!imdbId) return null;
  let html = await fetchTextDocument(`https://www.imdb.com/title/${imdbId}/`);
  let people = imdbJsonLdPeople(html);
  if (!people.length && !runTimeBudgetReached('imdb-reference-fallback', 45000)) {
    html = await fetchTextDocument(`https://www.imdb.com/title/${imdbId}/reference/`);
    people = imdbJsonLdPeople(html);
  }
  return people.length ? { people, source: 'imdb' } : null;
}

async function enrichPeopleFromSource(item) {
  let detail = null;
  if (item?.type === 'movie') {
    detail = await fetchMovieDetail(item.id);
  } else if (item?.type === 'series') {
    const url = new URL(
      `${API_BASE}/ghost/get/series/${encodeURIComponent(item.id)}`,
    );
    url.searchParams.set('affiliate', '1');
    const json = await fetchJson(url);
    const data = json?.data ?? json;
    if (data?.series && !Array.isArray(data.series)) detail = data.series;
    else if (Array.isArray(data?.series)) detail = data.series[0] || null;
    else if (data?.type === 'series') detail = data;
  }

  const people = extractSourcePeople(detail);
  return people.length ? { people, source: 'upera' } : null;
}

function peopleRetryAllowed(item, nowMs = Date.now()) {
  const next = Date.parse(item?.peopleEnrichmentNextRetryAt || '') || 0;
  return next <= nowMs;
}

function peopleEnrichmentNeedsWork(item) {
  if (!item || !['movie', 'series'].includes(item.type)) return false;
  const people = (Array.isArray(item.people) ? item.people : [])
    .filter((person) => person?.role === 'actor' || person?.role === 'director');
  const hasDirector = people.some((person) => person.role === 'director');
  return people.length < 3 || !hasDirector;
}

function peopleCandidateTimestamp(item) {
  return Date.parse(
    item?.sourceCreatedAt || item?.createdAt || item?.sourceUpdatedAt || item?.updatedAt || '',
  ) || 0;
}

async function fetchSeriesEpisodeArtworkMetadata(id) {
  const url = new URL(`${API_BASE}/ghost/get/series/${encodeURIComponent(id)}`);
  url.searchParams.set('affiliate', '1');
  const json = await fetchJson(url);
  const data = json?.data ?? json;
  return dedupeEpisodes(collectEpisodes(data)).sort(compareEpisodes);
}

async function syncEpisodeArtworkMetadata(options = {}) {
  const maxTitles = Math.max(1, Math.min(
    episodeArtworkSeriesPerRun,
    positiveInt(options.maxTitles, episodeArtworkSeriesPerRun),
  ));
  const candidates = items
    .filter((item) => item?.type === 'series')
    .filter((item) => (Array.isArray(item.downloads) ? item.downloads : []).some((group) =>
      Number(group?.episodeNumber || 0) > 0 &&
      cleanText(group?.sourceEpisodeId) &&
      !cleanText(group?.artwork),
    ))
    .sort((a, b) => {
      const checkedDifference = (Date.parse(String(a?.episodeArtworkCheckedAt || '')) || 0) -
        (Date.parse(String(b?.episodeArtworkCheckedAt || '')) || 0);
      return checkedDifference || peopleCandidateTimestamp(b) - peopleCandidateTimestamp(a);
    });

  stats.episodeArtworkCandidates = candidates.length;
  if (!candidates.length) {
    state.episodeArtworkOffset = 0;
    return;
  }

  const start = state.episodeArtworkOffset % candidates.length;
  const selected = Array.from(
    { length: Math.min(maxTitles, candidates.length) },
    (_, index) => candidates[(start + index) % candidates.length],
  );
  let visited = 0;
  for (const item of selected) {
    if (runTimeBudgetReached('episode-artwork-metadata', 45000)) break;
    visited += 1;
    stats.episodeArtworkSeriesChecked += 1;
    item.episodeArtworkCheckedAt = new Date().toISOString();
    try {
      const episodes = await fetchSeriesEpisodeArtworkMetadata(item.id);
      stats.episodeArtworkAdded += hydrateEpisodeGroupArtwork(item.downloads, episodes);
    } catch (error) {
      rememberError(`episode-artwork-${item.id}`, error);
    }
  }
  state.episodeArtworkOffset = candidates.length
    ? (start + visited) % candidates.length
    : 0;
}

async function syncPeopleMetadata(options = {}) {
  const nowMs = Date.now();
  const maxTitles = Math.max(1, Math.min(
    peopleEnrichmentTitlesPerRun,
    positiveInt(options.maxTitles, peopleEnrichmentTitlesPerRun),
  ));
  const candidates = items
    .filter((item) => peopleEnrichmentNeedsWork(item))
    .filter((item) => {
      const allowed = peopleRetryAllowed(item, nowMs);
      if (!allowed) stats.peopleEnrichmentSkippedFresh += 1;
      return allowed;
    })
    .sort((a, b) => peopleCandidateTimestamp(b) - peopleCandidateTimestamp(a));

  stats.peopleEnrichmentCandidates = candidates.length;
  if (!candidates.length) {
    state.peopleEnrichmentOffset = 0;
    state.lastPeopleEnrichmentAt = new Date().toISOString();
    return;
  }

  const start = options.preferRecent ? 0 : state.peopleEnrichmentOffset % candidates.length;
  const selected = Array.from(
    { length: Math.min(maxTitles, candidates.length) },
    (_, index) => candidates[(start + index) % candidates.length],
  );

  let visited = 0;
  for (const item of selected) {
    if (runTimeBudgetReached('people-enrichment', 45000)) break;
    visited += 1;
    stats.peopleEnrichmentProcessed += 1;
    const id = String(item.id || '');
    try {
      let sourceResult = null;
      try {
        sourceResult = await enrichPeopleFromSource(item);
      } catch {
        // External sources below can still complete the record.
      }

      const sourcePeople = sourceResult?.people || [];
      const sourceHasDirector = sourcePeople.some((person) => person.role === 'director');
      const sourceComplete = sourcePeople.length >= 3 && sourceHasDirector;
      let externalResult = null;
      if (!sourceComplete && tmdbBearerToken) externalResult = await enrichPeopleFromTmdb(item);
      if (!sourceComplete && !externalResult) externalResult = await enrichPeopleFromImdb(item);

      const people = mergePeople(sourcePeople, externalResult?.people || []);
      const result = people.length
        ? {
            people,
            source: externalResult?.source || sourceResult?.source || 'upera',
            ...(externalResult?.tmdbId ? { tmdbId: externalResult.tmdbId } : {}),
          }
        : null;

      if (!result?.people?.length) throw new Error('فهرست عوامل معتبری پیدا نشد.');
      const before = Array.isArray(item.people) ? item.people.length : 0;
      item.people = mergePeople(item.people, result.people).slice(0, peopleEnrichmentMaxPeople);
      const hasDirector = item.people.some((person) => person.role === 'director');
      item.peopleEnrichmentStatus = item.people.length >= 3 && hasDirector
        ? 'complete'
        : 'partial';
      item.peopleEnrichmentCheckedAt = new Date().toISOString();
      item.peopleEnrichmentSource = result.source;
      if (item.peopleEnrichmentStatus === 'complete') {
        delete item.peopleEnrichmentNextRetryAt;
      } else {
        item.peopleEnrichmentNextRetryAt = new Date(
          Date.now() + peopleEnrichmentRetryHours * 60 * 60 * 1000,
        ).toISOString();
      }
      if (result.tmdbId) item.tmdbId = result.tmdbId;
      delete state.peopleEnrichmentFailures[id];
      stats.peopleEnrichmentSucceeded += 1;
      stats.peopleAdded += Math.max(0, item.people.length - before);
      if (result.source === 'tmdb') stats.peopleEnrichmentFromTmdb += 1;
      else if (result.source === 'imdb') stats.peopleEnrichmentFromImdb += 1;
      else stats.peopleEnrichmentFromSource += 1;
    } catch (error) {
      const failures = nonNegativeInt(state.peopleEnrichmentFailures[id], 0) + 1;
      state.peopleEnrichmentFailures[id] = failures;
      item.peopleEnrichmentStatus = 'failed';
      item.peopleEnrichmentCheckedAt = new Date().toISOString();
      item.peopleEnrichmentNextRetryAt = new Date(
        Date.now() + peopleEnrichmentRetryHours * 60 * 60 * 1000,
      ).toISOString();
      stats.peopleEnrichmentFailed += 1;
      rememberError(`people-${id || 'unknown'}`, error);
    }
  }

  state.peopleEnrichmentOffset = candidates.length
    ? (start + visited) % candidates.length
    : 0;
  state.lastPeopleEnrichmentAt = new Date().toISOString();
}

function mergePeople(left, right) {
  const result = [];
  const indexByKey = new Map();
  for (const person of [
    ...(Array.isArray(left) ? left : []),
    ...(Array.isArray(right) ? right : []),
  ]) {
    if (!person || typeof person !== 'object') continue;
    const key = cleanText(person.tmdbId || person.id || '') || normalizeIdentityName(person.nameFa || person.name || '');
    if (!key) continue;
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, result.length);
      result.push({ ...person });
      continue;
    }

    const current = result[existingIndex];
    const currentImage = cleanText(current.image);
    const incomingImage = cleanText(person.image);
    const preferredImage = /^(?:\.\/)?assets\/media\//i.test(currentImage)
      ? currentImage
      : incomingImage || currentImage;
    result[existingIndex] = {
      ...current,
      ...person,
      id: current.id || person.id,
      nameFa: current.nameFa || person.nameFa || person.name,
      name: current.name || person.name || person.nameFa,
      role: current.role === 'director' || person.role === 'director' ? 'director' : (person.role || current.role),
      roleLabel: current.role === 'director' || person.role === 'director'
        ? 'کارگردان'
        : (person.roleLabel || current.roleLabel || 'بازیگر'),
      ...(preferredImage ? { image: preferredImage } : {}),
      order: Math.min(
        Number.isFinite(Number(current.order)) ? Number(current.order) : 999,
        Number.isFinite(Number(person.order)) ? Number(person.order) : 999,
      ),
    };
  }
  return result;
}

function mergeDuplicateCatalogPair(current, incoming) {
  const type = current.type || incoming.type;
  let downloads;

  if (type === 'series') {
    downloads = [...(Array.isArray(current.downloads) ? current.downloads : [])];
    for (const group of Array.isArray(incoming.downloads) ? incoming.downloads : []) {
      upsertEpisodeGroup(downloads, group);
    }
    downloads.sort(compareEpisodeGroups);
  } else {
    downloads = mergeDownloadSections(current.downloads, incoming.downloads);
  }

  const seasonNumbers = new Set(
    downloads
      .map((group) => Number(group?.seasonNumber || 0))
      .filter((value) => value > 0),
  );

  return {
    ...current,
    ...incoming,
    id: current.id,
    slug: current.slug || incoming.slug,
    type,
    nameFa: chooseCanonicalTitle(current.nameFa, incoming.nameFa),
    name: chooseCanonicalTitle(current.name, incoming.name),
    imdb: current.imdb || incoming.imdb,
    poster: current.poster || incoming.poster,
    posterFallback: current.posterFallback || incoming.posterFallback,
    backdrop: current.backdrop || incoming.backdrop,
    backdropFallback: current.backdropFallback || incoming.backdropFallback,
    overview: cleanText(current.overview).length >= cleanText(incoming.overview).length
      ? current.overview
      : incoming.overview,
    genres: uniqueStrings([...(current.genres || []), ...(incoming.genres || [])]),
    countryCodes: uniqueStrings([...(current.countryCodes || []), ...(incoming.countryCodes || [])]),
    countryLabels: uniqueStrings([...(current.countryLabels || []), ...(incoming.countryLabels || [])]),
    countryNames: uniqueStrings([...(current.countryNames || []), ...(incoming.countryNames || [])]),
    people: mergePeople(current.people, incoming.people),
    availableLanguages: uniqueStrings([...(current.availableLanguages || []), ...(incoming.availableLanguages || [])]),
    categoryKeys: uniqueStrings([...(current.categoryKeys || []), ...(incoming.categoryKeys || [])]),
    categoryLabels: uniqueStrings([...(current.categoryLabels || []), ...(incoming.categoryLabels || [])]),
    downloads,
    streamUrl: current.streamUrl || incoming.streamUrl,
    streamMode: current.streamUrl || incoming.streamUrl ? 'video' : undefined,
    createdAt: [current.createdAt, incoming.createdAt].filter(Boolean).sort()[0],
    sourceCreatedAt: [current.sourceCreatedAt, incoming.sourceCreatedAt].filter(Boolean).sort()[0],
    updatedAt: maxDate(current.updatedAt, incoming.updatedAt),
    sourceUpdatedAt: maxDate(current.sourceUpdatedAt, incoming.sourceUpdatedAt),
    meaningfulUpdatedAt: maxDate(current.meaningfulUpdatedAt, incoming.meaningfulUpdatedAt),
    firstSeenAt: [current.firstSeenAt, incoming.firstSeenAt].filter(Boolean).sort()[0],
    lastSyncedAt: maxDate(current.lastSyncedAt, incoming.lastSyncedAt),
    ...(type === 'series' ? {
      episodeCount: downloads.length,
      seasonCount: seasonNumbers.size,
      sourceEpisodeCount: Math.max(
        nonNegativeInt(current.sourceEpisodeCount, 0),
        nonNegativeInt(incoming.sourceEpisodeCount, 0),
        downloads.length,
      ),
      publicationStatus:
        current.publicationStatus === 'published' || incoming.publicationStatus === 'published'
          ? 'published'
          : 'building-archive',
      archiveComplete: Boolean(current.archiveComplete || incoming.archiveComplete),
    } : {}),
  };
}

function mergeDuplicateCatalogItems(sourceItems) {
  const result = [];
  const indexesByName = new Map();
  let merged = 0;

  for (const item of Array.isArray(sourceItems) ? sourceItems : []) {
    if (!item || !['movie', 'series'].includes(item.type)) {
      result.push(item);
      continue;
    }

    const names = identityNames(item);
    let matchIndex = -1;
    for (const name of names) {
      const candidates = indexesByName.get(`${item.type}:${name}`) || [];
      matchIndex = candidates.find((index) => yearsAreCompatible(result[index]?.year, item.year)) ?? -1;
      if (matchIndex >= 0) break;
    }

    if (matchIndex < 0) {
      const index = result.length;
      result.push(item);
      for (const name of names) {
        const key = `${item.type}:${name}`;
        indexesByName.set(key, [...(indexesByName.get(key) || []), index]);
      }
      continue;
    }

    result[matchIndex] = mergeDuplicateCatalogPair(result[matchIndex], item);
    merged += 1;
    for (const name of identityNames(result[matchIndex])) {
      const key = `${result[matchIndex].type}:${name}`;
      const indexes = indexesByName.get(key) || [];
      if (!indexes.includes(matchIndex)) indexesByName.set(key, [...indexes, matchIndex]);
    }
  }

  return { items: result, merged };
}

function nestedImageValue(value, depth = 0) {
  if (depth > 4 || value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    const text = cleanText(value);
    if (!text || /\.(?:mp4|m3u8|mkv|avi)(?:$|[?#])/i.test(text)) return '';
    return text;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = nestedImageValue(entry, depth + 1);
      if (candidate) return candidate;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const key of [
    'backdrop', 'still', 'thumbnail', 'thumb', 'video_thumbnail', 'videoThumbnail',
    'image', 'image_url', 'imageUrl', 'episode_image', 'episodeImage',
    'poster', 'poster_url', 'posterUrl', 'episode_poster', 'episodePoster',
    'cover', 'original', 'large', 'medium', 'url', 'src', 'path', 'file', 'filename',
  ]) {
    if (!(key in value)) continue;
    const candidate = nestedImageValue(value[key], depth + 1);
    if (candidate) return candidate;
  }
  return '';
}

function episodeArtworkUrl(episode) {
  for (const [value, folder] of [
    [episode?.backdrop, 'backdrops'],
    [episode?.still, 'backdrops'],
    [episode?.thumbnail, 'backdrops'],
    [episode?.thumb, 'backdrops'],
    [episode?.video_thumbnail ?? episode?.videoThumbnail, 'backdrops'],
    [episode?.image ?? episode?.episode_image ?? episode?.episodeImage, 'backdrops'],
    [episode?.poster ?? episode?.episode_poster ?? episode?.episodePoster, 'posters'],
    [episode?.cover, 'posters'],
    [episode?.images ?? episode?.media ?? episode?.attachments, 'backdrops'],
  ]) {
    const raw = nestedImageValue(value);
    if (raw) return imageUrl(raw, folder);
  }
  return '';
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
  const artwork = episodeArtworkUrl(episode);

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
    ...(artwork ? { artwork } : {}),
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
  // وقتی نسخه رایگان و نسخه ویژه همراه شناسه‌های متفاوت دارند،
  // شناسه کاتالوگ قبلی را نگه می‌داریم تا عنوان دوباره ساخته نشود
  // و لینک‌های عمیق/علاقه‌مندی‌ها بین سینک‌ها تغییر نکنند.
  const id = String(
    existing?.id || movie.id || movie.t_id,
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
      {
        nameFa: movie.name_fa || movie.name,
        name: movie.name || movie.name_fa,
        existing,
      },
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

    people: mergePeople(existing?.people, extractSourcePeople(movie)),

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
  // نسخه مستقیم و نسخه اپراتوری یک سریال ممکن است در منبع
  // شناسه‌های جدا داشته باشند؛ شناسه موجود کاتالوگ باید پایدار بماند.
  const id = String(
    existing?.id || series.id || series.t_id,
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
      {
        nameFa: series.name_fa || series.name,
        name: series.name || series.name_fa,
        existing,
      },
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

    people: mergePeople(existing?.people, extractSourcePeople(series)),

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
    archiveUnavailableEpisodes: Array.isArray(archiveMeta.unavailableEpisodes)
      ? archiveMeta.unavailableEpisodes.slice(0, 200)
      : Array.isArray(existing?.archiveUnavailableEpisodes)
        ? existing.archiveUnavailableEpisodes
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

function normalizeClassificationText(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();
}

function hasClassificationTerm(text, terms) {
  const padded = ` ${normalizeClassificationText(text)} `;
  return terms.some((term) =>
    padded.includes(` ${normalizeClassificationText(term)} `),
  );
}

function classifyContent(
  type,
  ir,
  genres,
  metadata = {},
) {
  const normalizedGenres = (Array.isArray(genres) ? genres : [])
    .map((genre) => normalizeClassificationText(genre))
    .filter(Boolean);
  const genreText = normalizedGenres.join(' ');
  const titleText = normalizeClassificationText([
    metadata.nameFa,
    metadata.name,
  ].filter(Boolean).join(' '));
  const existing = metadata.existing || {};
  const existingKind = normalizeClassificationText(existing.contentKind);
  const allowExistingFallback = normalizedGenres.length === 0;

  const isAnimation = normalizedGenres.some((genre) =>
    genre.includes('انیمیشن') || genre.includes('animation'),
  ) || Boolean(allowExistingFallback && existing.isAnimation);

  const knownNarrativeWhistle = hasClassificationTerm(titleText, ['سوت', 'whistle']) &&
    hasClassificationTerm(genreText, ['ترسناک', 'وحشت', 'هیجان انگیز', 'horror', 'thriller', 'drama']);
  const isDocumentary = !knownNarrativeWhistle && (
    normalizedGenres.some((genre) =>
      genre.includes('مستند') || genre.includes('documentary'),
    ) || Boolean(allowExistingFallback && existingKind === 'documentary')
  );

  const adultOrHeavy = hasClassificationTerm(genreText, [
    'ترسناک', 'وحشت', 'جنگی', 'جنایی', 'هیجان انگیز', 'بزرگسال',
    'horror', 'war', 'crime', 'thriller', 'adult',
  ]);

  const isQuran = hasClassificationTerm(titleText, [
    'قرآن', 'قرآنی', 'ترتیل', 'تلاوت', 'quran', 'recitation',
  ]);
  const religiousProgramTerms = [
    'ادعیه', 'دعای', 'دعا', 'مداحی', 'نوحه', 'زیارت', 'ترتیل', 'تلاوت',
  ];
  const isReligious = Boolean(
    isQuran ||
    hasClassificationTerm(titleText, [
      ...religiousProgramTerms,
      'مذهبی', 'عاشورا', 'کربلا', 'پیامبر', 'نبی', 'امام', 'religious',
    ]) ||
    hasClassificationTerm(genreText, ['مذهبی', 'religious']) ||
    (allowExistingFallback && ['religious program', 'quran program', 'religious movie', 'religious series'].includes(existingKind))
  );
  const isReligiousProgram = Boolean(
    isQuran ||
    hasClassificationTerm(titleText, religiousProgramTerms) ||
    (allowExistingFallback && ['religious program', 'quran program'].includes(existingKind))
  );

  const explicitKidsTitle = hasClassificationTerm(titleText, [
    'کودک', 'کودکان', 'کودکانه', 'برنامه کودک', 'ترانه کودک',
    'خاله نسرین', 'خاله سوسکه', 'با بابام', 'بیا آشتی کنیم', 'بنیامین',
    'ننه لالا', 'kids', 'children', 'nursery',
  ]);
  const explicitKidsGenre = hasClassificationTerm(genreText, [
    'کودک', 'کودکان', 'kids', 'children',
  ]);
  const isKids = Boolean(
    !adultOrHeavy &&
    (
      explicitKidsTitle ||
      explicitKidsGenre ||
      (allowExistingFallback && ['kids', 'children program'].includes(existingKind))
    )
  );

  const isTalkShow = Boolean(
    type === 'series' &&
    (
      hasClassificationTerm(genreText, ['تاک شو', 'talk show']) ||
      hasClassificationTerm(titleText, ['تاک شو', 'talk show']) ||
      (allowExistingFallback && existingKind === 'talk show')
    )
  );
  const isRealityCompetition = Boolean(
    type === 'series' &&
    (
      hasClassificationTerm(genreText, [
        'رئالیتی شو', 'مسابقه تلویزیونی', 'reality', 'game show',
      ]) ||
      hasClassificationTerm(titleText, [
        'رئالیتی شو', 'مسابقه', 'گیم شو', 'سیزده شمالی',
        'شب های مافیا', 'جوکر', 'reality', 'game show',
      ]) ||
      (allowExistingFallback && existingKind === 'reality competition')
    )
  );
  const isProgram = isTalkShow || isRealityCompetition;

  const categoryKeys = [type === 'movie' ? 'movies' : 'series'];
  const categoryLabels = [type === 'movie' ? 'فیلم‌ها' : 'مجموعه‌ها'];

  // Narrative religious films/series may also remain in their normal regional
  // shelf. Programs, kids content, animation and documentaries stay in their
  // dedicated shelves and do not pollute the standard series/movie lists.
  const excludeFromRegional = Boolean(
    isAnimation || isDocumentary || isKids || isProgram || isReligiousProgram,
  );
  if (!excludeFromRegional) {
    if (type === 'movie') {
      categoryKeys.push(ir ? 'iranian-movies' : 'foreign-movies');
      categoryLabels.push(ir ? 'فیلم ایرانی' : 'فیلم خارجی');
    } else {
      categoryKeys.push(ir ? 'iranian-series' : 'foreign-series');
      categoryLabels.push(ir ? 'سریال ایرانی' : 'سریال خارجی');
    }
  }

  if (isAnimation) {
    categoryKeys.push(type === 'movie' ? 'animation-movies' : 'animation-series');
    categoryLabels.push(type === 'movie' ? 'انیمیشن سینمایی' : 'انیمیشن سریالی');
  }
  if (isKids) {
    categoryKeys.push('kids');
    categoryLabels.push('کودکان');
  }
  if (isReligious) {
    categoryKeys.push('religious');
    categoryLabels.push('مذهبی و مناسبتی');
    if (isQuran) {
      categoryKeys.push('quran');
      categoryLabels.push('قرآن و ادعیه');
    }
  }
  if (isProgram) {
    categoryKeys.push('programs');
    categoryLabels.push('برنامه‌ها و مسابقه‌ها');
    if (isTalkShow) {
      categoryKeys.push('talk-shows');
      categoryLabels.push('تاک‌شو');
    }
    if (isRealityCompetition) {
      categoryKeys.push('reality');
      categoryLabels.push('مسابقه و رئالیتی‌شو');
    }
  }
  if (isDocumentary) {
    categoryKeys.push('documentaries');
    categoryLabels.push('مستند');
  }

  let contentKind = type;
  if (isQuran || isReligiousProgram) contentKind = 'religious-program';
  else if (isReligious) contentKind = type === 'movie' ? 'religious-movie' : 'religious-series';
  else if (isKids) contentKind = isAnimation ? 'kids' : 'children-program';
  else if (isRealityCompetition) contentKind = 'reality-competition';
  else if (isTalkShow) contentKind = 'talk-show';
  else if (isAnimation) contentKind = type === 'movie' ? 'animation-movie' : 'animation-series';
  else if (isDocumentary) contentKind = 'documentary';

  return {
    categoryKeys: [...new Set(categoryKeys)],
    categoryLabels: [...new Set(categoryLabels)],
    contentKind,
    isAnimation,
    isTalkShow,
    isDocumentary,
  };
}

function isManagedCategoryKey(value) {
  return [
    'movies', 'series', 'iranian-movies', 'foreign-movies', 'iranian-series', 'foreign-series',
    'animation-movies', 'animation-series', 'kids', 'religious', 'quran',
    'programs', 'talk-shows', 'reality', 'documentaries',
  ].includes(String(value));
}

function isManagedCategoryLabel(value) {
  return [
    'فیلم‌ها', 'مجموعه‌ها', 'فیلم ایرانی', 'فیلم خارجی', 'سریال ایرانی', 'سریال خارجی',
    'انیمیشن سینمایی', 'انیمیشن سریالی', 'کودکان', 'مذهبی و مناسبتی', 'قرآن و ادعیه',
    'برنامه‌ها و مسابقه‌ها', 'تاک‌شو', 'مسابقه و رئالیتی‌شو', 'مستند',
  ].includes(String(value));
}

function reclassifyCatalogItem(item) {
  if (!item || !['movie', 'series'].includes(item.type)) return item;
  const classification = classifyContent(
    item.type,
    Boolean(item.ir),
    Array.isArray(item.genres) ? item.genres : [],
    { nameFa: item.nameFa, name: item.name, existing: {} },
  );
  const preservedKeys = (Array.isArray(item.categoryKeys) ? item.categoryKeys : [])
    .filter((key) => !isManagedCategoryKey(key));
  const preservedLabels = (Array.isArray(item.categoryLabels) ? item.categoryLabels : [])
    .filter((label) => !isManagedCategoryLabel(label));
  return {
    ...item,
    ...classification,
    categoryKeys: uniqueStrings([...classification.categoryKeys, ...preservedKeys]),
    categoryLabels: uniqueStrings([...classification.categoryLabels, ...preservedLabels]),
  };
}

function identityYear(value) {
  const year = Number(value);
  return Number.isFinite(year) && year > 1800 ? year : 0;
}

function yearsAreCompatible(left, right) {
  const a = identityYear(left);
  const b = identityYear(right);
  return !a || !b || Math.abs(a - b) <= 1;
}

function normalizeIdentityName(value) {
  let text = cleanText(value);
  const accessSuffix = /(?:[\s\-–—|:]*[([{]?\s*)?(?:نسخه\s*)?(?:ویژه\s*(?:اینترنت\s*)?همراه|اپراتوری|فیلیمو|filimo|mobile\s*operator|operator\s*only)\s*[)\]}]?\s*$/i;
  for (let index = 0; index < 3; index += 1) {
    const next = text.replace(accessSuffix, '').trim();
    if (next === text) break;
    text = next;
  }
  return normalizeName(text);
}

function identityNames(value) {
  return uniqueStrings([
    normalizeIdentityName(value?.name_fa || value?.nameFa || ''),
    normalizeIdentityName(value?.name || ''),
  ]);
}

function namesOverlap(left, right) {
  const leftNames = new Set(identityNames(left));
  return identityNames(right).some((name) => leftNames.has(name));
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
  const year = identityYear(candidate?.year);

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
        item.type === type &&
        namesOverlap(candidate, item) &&
        yearsAreCompatible(year, item.year),
      );
    }) || null
  );
}

function replaceItem(next) {
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
      namesOverlap(item, next) &&
      yearsAreCompatible(item.year, next.year)
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

function hydrateEpisodeGroupArtwork(groups, episodes) {
  let added = 0;
  for (const episode of Array.isArray(episodes) ? episodes : []) {
    const group = findEpisodeGroup(groups, episode);
    if (!group || cleanText(group.artwork)) continue;
    const artwork = episodeArtworkUrl(episode);
    if (!artwork) continue;
    group.artwork = artwork;
    added += 1;
  }
  return added;
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
  const availableCoordinates = new Set(
    groups.map((group) => archiveEpisodeCoordinateKey(group)),
  );
  const unavailableCoordinates = new Set(
    (Array.isArray(item.archiveUnavailableEpisodes)
      ? item.archiveUnavailableEpisodes
      : []
    )
      .map((entry) => archiveEpisodeCoordinateKey(entry))
      .filter((coordinate) => !availableCoordinates.has(coordinate)),
  );
  const missing = episodeGapsForGroups(groups).filter(
    (episode) => !unavailableCoordinates.has(archiveEpisodeCoordinateKey(episode)),
  );
  const sourceEpisodeCount = nonNegativeInt(item.sourceEpisodeCount, 0);
  const pendingFromCount = Math.max(
    0,
    sourceEpisodeCount - availableCoordinates.size - unavailableCoordinates.size,
  );
  const hasExplicitPendingList = Array.isArray(item.archivePendingEpisodes);
  const auditedDiscoveryComplete = Boolean(
    item.archiveAuditStatus === 'checked' &&
    item.archiveEpisodeDiscoveryComplete !== false &&
    nonNegativeInt(item.archiveEpisodePaginationErrors, 0) === 0 &&
    cleanText(item.archiveDiscoveryCheckedAt) &&
    hasExplicitPendingList,
  );
  const explicitPendingCount = hasExplicitPendingList
    ? item.archivePendingEpisodes.filter(
        (episode) => !unavailableCoordinates.has(archiveEpisodeCoordinateKey(episode)),
      ).length
    : 0;
  const pending = auditedDiscoveryComplete
    ? Math.max(pendingFromCount, explicitPendingCount)
    : Math.max(
        pendingFromCount,
        nonNegativeInt(item.archivePendingEpisodeCount, 0),
        explicitPendingCount,
        item.archiveEpisodeDiscoveryComplete === false ? 1 : 0,
      );

  return {
    missing,
    pending,
    total: Math.max(missing.length, pending),
  };
}

function archiveEpisodeCoordinateKey(episode) {
  return `s${episodeSeasonNumber(episode)}e${episodeNumberValue(episode)}`;
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

  if (
    item.archiveAuditStatus === 'blocked' &&
    deficit.total > 0 &&
    !blockedSeriesRetryDue(item)
  ) {
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

  // Movies used to be placed after every series/episode candidate, so a small
  // request budget could repeatedly end with zero movie updates. Guaranteed
  // page discovery already covers both types; this fallback now gives movies
  // first access to its own small scoped quota.
  if (type === 'movie') return 0;
  if (type === 'series' || type === 'episode') return 1;
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

function createRunTimeBudgetError(context = 'runtime') {
  const error = new Error(`APARATCHI_RUN_TIME_BUDGET:${context}`);
  error.code = 'APARATCHI_RUN_TIME_BUDGET';
  return error;
}

function isRunTimeBudgetError(error) {
  return Boolean(
    error?.code === 'APARATCHI_RUN_TIME_BUDGET' ||
    String(error?.message || '').startsWith('APARATCHI_RUN_TIME_BUDGET:'),
  );
}

function runTimeBudgetReached(context = 'runtime', reserveMs = runCheckpointReserveMs) {
  const reached = Date.now() + Math.max(0, reserveMs) >= runDeadlineAtMs;
  if (reached) {
    affiliateBudgetExhausted = true;
    stats.stoppedByTimeBudget = true;
    if (!stats.timeBudgetStopContext) stats.timeBudgetStopContext = context;
  }
  return reached;
}

function throwIfRunTimeBudgetReached(context = 'runtime', reserveMs = runCheckpointReserveMs) {
  if (runTimeBudgetReached(context, reserveMs)) {
    throw createRunTimeBudgetError(context);
  }
}

async function sleepWithinRunBudget(ms, context = 'sleep') {
  const allowed = Math.max(0, runDeadlineAtMs - Date.now() - runCheckpointReserveMs);
  if (allowed <= 0) throw createRunTimeBudgetError(context);
  await sleep(Math.min(Math.max(0, ms), allowed));
  throwIfRunTimeBudgetReached(context);
}

async function fetchJson(
  input,
  options = {},
) {
  const url = input instanceof URL
    ? input.toString()
    : String(input);

  const maxAttempts = requestMaxAttempts;
  let lastError;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    throwIfRunTimeBudgetReached('fetch-json', 20000);
    const controller = new AbortController();
    const remainingForRequest = Math.max(1000, runDeadlineAtMs - Date.now() - runCheckpointReserveMs);
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1000, Math.min(requestTimeoutMs, remainingForRequest)),
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
            ? Math.min(20000, Math.max(3000, retrySeconds * 1000))
            : Math.min(15000, 5000 * attempt);

        stats.rateLimitHits += 1;
        stats.rateLimitWaitMs += waitMs;

        lastError = new Error(
          `HTTP 429 برای ${redact(url)}`,
        );

        console.warn(
          `محدودیت آپرا؛ ${Math.ceil(waitMs / 1000)} ثانیه انتظار.`,
        );

        await sleepWithinRunBudget(waitMs, 'rate-limit-wait');
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
        error.status = response.status;
        error.retryable = retryable;

        if (
          retryable &&
          attempt < maxAttempts
        ) {
          lastError = error;

          await sleepWithinRunBudget(
            Math.min(8000, 2000 * attempt),
            'http-retry-wait',
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
      if (runTimeBudgetReached('fetch-json-catch', 15000)) {
        throw createRunTimeBudgetError('fetch-json-catch');
      }
      lastError = error;

      if (error?.retryable === false) {
        break;
      }

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
        await sleepWithinRunBudget(
          Math.min(8000, 2000 * attempt),
          'network-retry-wait',
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
        ? {
            action: '',
            mediaType: '',
            resourceId: '',
            hostname: url.hostname,
            pathname: url.pathname,
            shortLink: true,
            exactStream: false,
          }
        : null;
    }

    const streamMatch = pathText.match(/^\/stream\/(movie|episode)\/([^/?#]+)\/?$/i);
    if (streamMatch) {
      return {
        action: 'stream',
        mediaType: String(streamMatch[1] || '').toLowerCase(),
        resourceId: String(streamMatch[2] || ''),
        hostname: url.hostname,
        pathname: url.pathname,
        shortLink: false,
        exactStream: true,
      };
    }

    const actionMatch = pathText.match(/\/(watch|play|download)(?:\/|$)/i);
    const mediaMatch = pathText.match(/\/(movie|series|episode)(?:\/|$)/i);
    if (!actionMatch || !mediaMatch) return null;

    return {
      action: String(actionMatch[1] || '').toLowerCase(),
      mediaType: String(mediaMatch[1] || '').toLowerCase(),
      resourceId: '',
      hostname: url.hostname,
      pathname: url.pathname,
      shortLink: false,
      exactStream: false,
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
  if (!portal) return null;
  if (portal.exactStream) return 'operator-play';

  const text = scalarLinkText(link);
  if (portal.action === 'download' || /دانلود|دریافت|download|save/i.test(text)) {
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
  if (!mode) return null;

  const portal = operatorPortalDetails(link.link);
  const label = cleanText(
    link.title ||
    link.label ||
    link.name ||
    (mode === 'operator-download'
      ? 'دانلود با اینترنت همراه'
      : portal?.mediaType === 'episode'
        ? 'پخش قسمت با اینترنت همراه'
        : 'پخش فیلم با اینترنت همراه'),
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
    const hasDirect = directFiles.length > 0 || isDirectMediaUrl(item?.streamUrl);
    const operatorOnly = hasOperator && !hasDirect;
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

async function mirrorCatalogEpisodeImages(catalogItems, requestedLimit) {
  const limit = Math.max(0, Math.min(requestedLimit, maxMirroredImagesPerRun));
  if (!limit || maxMirroredImagesPerRun <= 0) return;
  const targetsByUrl = new Map();
  for (const item of Array.isArray(catalogItems) ? catalogItems : []) {
    for (const group of Array.isArray(item?.downloads) ? item.downloads : []) {
      if (Number(group?.episodeNumber || 0) <= 0) continue;
      const value = cleanText(group?.artwork);
      if (!value || /^(?:\.\/)?assets\/media\//i.test(value) || !/^https?:\/\//i.test(value)) continue;
      const target = targetsByUrl.get(value) || { setters: [], updatedAt: '' };
      target.setters.push((next) => { group.artwork = next; });
      target.updatedAt = maxDate(target.updatedAt, group?.sourceUpdatedAt, item?.sourceUpdatedAt, item?.updatedAt);
      targetsByUrl.set(value, target);
    }
  }

  const targets = [...targetsByUrl.entries()].sort(([, a], [, b]) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
  );
  let reserved = 0;
  for (let offset = 0; offset < targets.length && reserved < limit && mirroredImagesUsed < maxMirroredImagesPerRun; offset += imageMirrorConcurrency) {
    const available = Math.min(
      imageMirrorConcurrency,
      limit - reserved,
      maxMirroredImagesPerRun - mirroredImagesUsed,
    );
    const batch = targets.slice(offset, offset + available);
    reserved += batch.length;
    mirroredImagesUsed += batch.length;
    await Promise.all(batch.map(async ([url, target]) => {
      const next = await mirrorImageUrl(url, 'episodes');
      if (!next || next === url) return;
      for (const setter of target.setters) setter(next);
      stats.episodeArtworkMirrored += 1;
    }));
  }
}

async function mirrorCatalogPeopleImages(catalogItems, featuredPeople) {
  if (maxMirroredImagesPerRun <= 0) return;

  const targetsByUrl = new Map();
  const register = (person) => {
    const value = cleanText(person?.image);
    if (!value || /^(?:\.\/)?assets\/media\//i.test(value)) return;
    if (!/^https?:\/\//i.test(value)) return;
    const setters = targetsByUrl.get(value) || [];
    setters.push((next) => { person.image = next; });
    targetsByUrl.set(value, setters);
  };

  for (const item of Array.isArray(catalogItems) ? catalogItems : []) {
    for (const person of Array.isArray(item?.people) ? item.people : []) register(person);
  }
  for (const person of Array.isArray(featuredPeople) ? featuredPeople : []) register(person);

  const targets = [...targetsByUrl.entries()].sort(([a], [b]) =>
    Number(/image\.tmdb\.org/i.test(b)) - Number(/image\.tmdb\.org/i.test(a)),
  );

  for (let offset = 0; offset < targets.length && mirroredImagesUsed < maxMirroredImagesPerRun; offset += imageMirrorConcurrency) {
    const batch = targets.slice(offset, offset + imageMirrorConcurrency);
    await Promise.all(batch.map(async ([url, setters]) => {
      if (mirroredImagesUsed >= maxMirroredImagesPerRun) return;
      mirroredImagesUsed += 1;
      const next = await mirrorImageUrl(url, 'people');
      if (!next || next === url) return;
      for (const setter of setters) setter(next);
    }));
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

async function persistSyncCheckpoint(reason = 'checkpoint') {
  const now = new Date().toISOString();
  const checkpointItems = items
    .map(reclassifyCatalogItem)
    .map((item) => withSeriesPublicationState(item));
  const checkpointOutput = {
    ...catalog,
    version: CATALOG_VERSION,
    updatedAt: now,
    items: checkpointItems,
    iranianSchedule: Array.isArray(catalog.iranianSchedule) ? catalog.iranianSchedule : [],
    weeklySchedule: Array.isArray(catalog.weeklySchedule) ? catalog.weeklySchedule : [],
  };
  state.lastSyncAt = now;
  stats.lastCheckpointAt = now;
  stats.lastCheckpointReason = reason;
  stats.backfillCheckpoints = nonNegativeInt(stats.backfillCheckpoints, 0) + 1;
  stats.affiliateRequests = affiliateRequestsUsed;
  stats.finalCount = checkpointItems.length;
  stats.remainingRunMsAtCheckpoint = Math.max(0, runDeadlineAtMs - Date.now());
  await writeCatalogAndManifest(checkpointOutput);
  await writeJson(statePath, state);
  await writeJson(reportPath, stats);
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

async function writeCatalogAndManifest(value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const manifest = {
    schemaVersion: 1,
    revision: createHash('sha256').update(serialized).digest('hex'),
    catalogVersion: cleanText(value?.version || CATALOG_VERSION),
    catalogUpdatedAt: cleanText(value?.updatedAt || ''),
    sizeBytes: Buffer.byteLength(serialized),
  };
  await fs.writeFile(catalogPath, serialized, 'utf8');
  await writeJson(catalogManifestPath, manifest);
}

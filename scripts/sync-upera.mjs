import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeClientCatalogArtifacts } from './client-catalog.mjs';
import { applyVerifiedPersianTitleOverrides } from './persian-title-overrides.mjs';
import { applyOperatorMetadataRepair } from './operator-metadata-repair.mjs';
import {
  classifyCatalogItem as classifyCatalogRules,
  classicComedyCollectionFor,
  isManagedCategoryKey as managedCategoryKey,
  isManagedCategoryLabel as managedCategoryLabel,
} from './classification.mjs';

const API_BASE = 'https://seeko.film/api/v1';
const PANEL_API_BASE = 'https://panel-api.upera.tv/api/v1';
const FILIMO_OWNER_ID = 9194919;
const IRANIAN_SERIES_SCAN_VERSION = 5;
const SERIES_COMPLETENESS_AUDIT_VERSION = 2;
const MEDIA_LANGUAGE_AUDIT_VERSION = 8;
const IRANIAN_SERIES_REBUILD_VERSION = 1;
const ARCHIVE_COMPLETION_ORDER_VERSION = 1;
const CATALOG_VERSION = '0.25.0-language-operator-artwork-truth';
const AFFILIATE_URL_KEYS = [
  'link', 'url', 'href', 'download_url', 'downloadUrl', 'download_link', 'downloadLink',
  'stream_url', 'streamUrl', 'stream_link', 'streamLink', 'file_url', 'fileUrl', 'file',
];

const PERSIAN_EPISODE_ORDINAL = '(?:اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|یازدهم|دوازدهم|سیزدهم|چهاردهم|پانزدهم|شانزدهم|هفدهم|هجدهم|نوزدهم|بیستم|بیست\\s*و\\s*(?:یکم|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم)|سی\\s*و\\s*(?:یکم|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم)|آخر|پایانی|\\d{1,4})';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const catalogManifestPath = path.join(root, 'catalog-manifest.json');
const statePath = path.join(root, 'sync-state.json');
const reportPath = path.join(root, 'sync-report.json');
const mediaRoot = path.join(root, 'assets', 'media');
const execFileAsync = promisify(execFile);

const refId = String(process.env.UPERA_REF_ID || '').trim();
const token = String(process.env.UPERA_TOKEN || '').trim();
const panelToken = String(process.env.UPERA_PANEL_TOKEN || '').trim();
const tmdbBearerToken = String(process.env.TMDB_BEARER_TOKEN || '').trim();

const peopleEnrichmentTitlesPerRun = Math.min(
  120,
  positiveInt(process.env.APARATCHI_PEOPLE_TITLES_PER_RUN, 40),
);

const peopleEnrichmentMaxPeople = Math.min(
  20,
  positiveInt(process.env.APARATCHI_PEOPLE_MAX_PER_TITLE, 12),
);

const peopleEnrichmentRetryHours = Math.min(
  168,
  positiveInt(process.env.APARATCHI_PEOPLE_RETRY_HOURS, 12),
);

const operatorOverviewTitlesPerRun = Math.min(
  30,
  nonNegativeInt(process.env.APARATCHI_OPERATOR_OVERVIEWS_PER_RUN, 12),
);

const operatorClassificationTitlesPerRun = Math.min(
  40,
  nonNegativeInt(process.env.APARATCHI_OPERATOR_CLASSIFICATION_PER_RUN, 16),
);

const episodeArtworkSeriesPerRun = Math.min(
  120,
  positiveInt(process.env.APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN, 24),
);

const episodeArtworkMirrorPerRun = Math.min(
  72,
  nonNegativeInt(process.env.APARATCHI_EPISODE_ARTWORK_MIRROR_PER_RUN, 12),
);

const episodeFrameCapturesPerRun = Math.min(
  160,
  nonNegativeInt(process.env.APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN, 48),
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
  500,
  positiveInt(process.env.UPERA_RECENT_MOVIE_TITLES_PER_RUN, 18),
);

const recentSeriesTitlesPerRun = Math.min(
  500,
  positiveInt(process.env.UPERA_RECENT_SERIES_TITLES_PER_RUN, 6),
);

const recentMovieRequestQuota = Math.min(
  240,
  positiveInt(process.env.UPERA_RECENT_MOVIE_REQUEST_QUOTA, 18),
);

const recentSeriesRequestQuota = Math.min(
  240,
  positiveInt(process.env.UPERA_RECENT_SERIES_REQUEST_QUOTA, 24),
);

const mediaRepairRequestQuota = Math.min(
  120,
  positiveInt(process.env.UPERA_MEDIA_REPAIR_REQUEST_QUOTA, 60),
);

const recentSeriesEpisodeLimit = Math.min(
  60,
  positiveInt(process.env.UPERA_RECENT_SERIES_EPISODES_PER_TITLE, 5),
);

const incrementalRequestQuota = Math.min(
  240,
  positiveInt(process.env.UPERA_INCREMENTAL_REQUEST_QUOTA, 8),
);

const airingRequestQuota = Math.min(
  240,
  positiveInt(process.env.UPERA_AIRING_REQUEST_QUOTA, 10),
);

const archiveMovieRequestQuota = Math.min(
  240,
  positiveInt(process.env.UPERA_ARCHIVE_MOVIE_REQUEST_QUOTA, 8),
);

const archiveSeriesRequestQuota = Math.min(
  240,
  positiveInt(process.env.UPERA_ARCHIVE_SERIES_REQUEST_QUOTA, 8),
);

const iranianSeriesRequestQuota = Math.min(
  240,
  positiveInt(process.env.UPERA_IRANIAN_SERIES_REQUEST_QUOTA, 6),
);

const operatorDiscoveryEnabled = String(
  process.env.UPERA_OPERATOR_DISCOVERY_ENABLED || 'true',
).trim().toLowerCase() !== 'false';

const operatorMovieRequestQuota = Math.min(
  240,
  positiveInt(process.env.UPERA_OPERATOR_MOVIE_REQUEST_QUOTA, 8),
);

const operatorSeriesRequestQuota = Math.min(
  240,
  positiveInt(process.env.UPERA_OPERATOR_SERIES_REQUEST_QUOTA, 9),
);

// Verified mobile-operator streams supplied from Upera's own player. These
// overrides are intentionally keyed by the ordinary source title + episode
// coordinate so they can only create a sibling operator post for that exact
// title and can never be attached by fuzzy name matching.
const verifiedOperatorStreamOverrides = [];

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

const syncModeSetting = ['AUTO', 'BACKFILL', 'NORMAL', 'IRANIAN', 'PEOPLE'].includes(requestedSyncMode)
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
    syncModeSetting === 'BACKFILL' ? 18 : syncModeSetting === 'IRANIAN' ? 15 : syncModeSetting === 'PEOPLE' ? 4 : 8,
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
  120,
  positiveInt(process.env.UPERA_BACKFILL_EPISODES_PER_SERIES, 12),
);

const episodeUnavailableAfterAttempts = Math.min(
  8,
  positiveInt(process.env.UPERA_EPISODE_UNAVAILABLE_AFTER_ATTEMPTS, 3),
);

// Repeatedly unavailable source episodes are tracked for diagnostics and
// retry scheduling, but they still count as missing. Archive backfill stays on
// the same series until every discoverable source episode has usable media.
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
  500,
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
  8,
  positiveInt(process.env.UPERA_OPERATOR_SERIES_PAGES_PER_RUN, 4),
);

const operatorSeriesTitlesPerRun = positiveInt(
  process.env.UPERA_OPERATOR_SERIES_TITLES_PER_RUN,
  6,
);

const operatorMoviePagesPerRun = Math.min(
  8,
  positiveInt(process.env.UPERA_OPERATOR_MOVIE_PAGES_PER_RUN, 4),
);

const operatorMovieTitlesPerRun = positiveInt(
  process.env.UPERA_OPERATOR_MOVIE_TITLES_PER_RUN,
  8,
);

// Operator discovery must be cheap enough to run every hour, even while the
// historical year-by-year archive queue is active. Probe a few representative
// episodes (newest/oldest/middle) instead of spending the whole run on one
// long series before we even know whether it has operator-only media.
const operatorProbeEpisodesPerSeries = Math.min(
  6,
  positiveInt(process.env.UPERA_OPERATOR_PROBE_EPISODES_PER_SERIES, 3),
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
  iranianSeriesRebuildVersion: 0,
  iranianSeriesNoProgress: {},
  iranianSeriesActiveId: '',
  operatorSeriesPage: 1,
  operatorSeriesOffset: 0,
  operatorMoviePage: 1,
  operatorMovieOffset: 0,
  airingSeriesOffset: 0,
  seriesEpisodeCursor: {},
  seriesLanguageAuditCursor: {},
  archiveBackfillSeriesId: '',
  archiveBackfillSeriesTitle: '',
  archiveBackfillItemId: '',
  archiveBackfillItemType: '',
  archiveBackfillItemTitle: '',
  archiveCompletionOrderVersion: ARCHIVE_COMPLETION_ORDER_VERSION,
  archiveBackfillOffset: 0,
  archiveBackfillNoProgress: {},
  archiveBackfillCompleted: {},
  archiveEpisodeFailures: {},
  peopleEnrichmentOffset: 0,
  peopleEnrichmentFailures: {},
  episodeArtworkOffset: 0,
  mediaRepairOffset: 0,
  mediaHealthOffset: 0,
  mediaRepairFailures: {},
  lastPeopleEnrichmentAt: null,
  lastSyncAt: null,
};

const catalog = await readJson(catalogPath, defaultCatalog);
const state = await readJson(statePath, defaultState);

const isTrustedGeneratedEpisodeArtwork = (value) =>
  /^(?:\.\/)?assets\/media\/episodes\/[a-f0-9]{24}\.jpg$/i.test(cleanText(value));

let removedUntrustedEpisodeArtwork = 0;
for (const item of Array.isArray(catalog.items) ? catalog.items : []) {
  if (item?.type !== 'series') continue;
  for (const group of Array.isArray(item.downloads) ? item.downloads : []) {
    if (Number(group?.episodeNumber || 0) <= 0) continue;
    if (!cleanText(group.artwork) || isTrustedGeneratedEpisodeArtwork(group.artwork)) continue;
    group.artwork = '';
    removedUntrustedEpisodeArtwork += 1;
  }
}
if (removedUntrustedEpisodeArtwork) {
  console.log('Removed ' + removedUntrustedEpisodeArtwork + ' untrusted episode artwork references; exact frames will be regenerated.');
}

state.moviePage = positiveInt(state.moviePage, 1);
state.movieOffset = nonNegativeInt(state.movieOffset, 0);
state.seriesPage = positiveInt(state.seriesPage, 1);
state.seriesOffset = nonNegativeInt(state.seriesOffset, 0);
state.iranianSeriesPage = positiveInt(state.iranianSeriesPage, 1);
state.iranianSeriesOffset = nonNegativeInt(state.iranianSeriesOffset, 0);
state.iranianSeriesActiveId = cleanText(state.iranianSeriesActiveId || '');
if (!state.iranianSeriesNoProgress || typeof state.iranianSeriesNoProgress !== 'object' || Array.isArray(state.iranianSeriesNoProgress)) state.iranianSeriesNoProgress = {};
if (Number(state.iranianSeriesScanVersion || 0) !== IRANIAN_SERIES_SCAN_VERSION) {
  state.iranianSeriesPage = 1;
  state.iranianSeriesOffset = 0;
  state.iranianSeriesActiveId = '';
  state.iranianSeriesNoProgress = {};
  state.iranianSeriesScanVersion = IRANIAN_SERIES_SCAN_VERSION;
}
state.operatorSeriesPage = positiveInt(state.operatorSeriesPage, 1);
state.operatorSeriesOffset = nonNegativeInt(state.operatorSeriesOffset, 0);
state.operatorMoviePage = positiveInt(state.operatorMoviePage, 1);
state.operatorMovieOffset = nonNegativeInt(state.operatorMovieOffset, 0);
state.airingSeriesOffset = nonNegativeInt(state.airingSeriesOffset, 0);
state.peopleEnrichmentOffset = nonNegativeInt(state.peopleEnrichmentOffset, 0);
state.episodeArtworkOffset = nonNegativeInt(state.episodeArtworkOffset, 0);
state.mediaRepairOffset = nonNegativeInt(state.mediaRepairOffset, 0);
state.mediaHealthOffset = nonNegativeInt(state.mediaHealthOffset, 0);
if (!state.mediaRepairFailures || typeof state.mediaRepairFailures !== 'object' || Array.isArray(state.mediaRepairFailures)) state.mediaRepairFailures = {};
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

if (
  !state.seriesLanguageAuditCursor ||
  typeof state.seriesLanguageAuditCursor !== 'object' ||
  Array.isArray(state.seriesLanguageAuditCursor)
) {
  state.seriesLanguageAuditCursor = {};
}

state.archiveBackfillSeriesId = String(state.archiveBackfillSeriesId || '');
state.archiveBackfillSeriesTitle = String(state.archiveBackfillSeriesTitle || '');
state.archiveBackfillItemId = String(state.archiveBackfillItemId || state.archiveBackfillSeriesId || '');
state.archiveBackfillItemType = String(state.archiveBackfillItemType || (state.archiveBackfillItemId ? 'series' : ''));
state.archiveBackfillItemTitle = String(state.archiveBackfillItemTitle || state.archiveBackfillSeriesTitle || '');
state.archiveCompletionOrderVersion = ARCHIVE_COMPLETION_ORDER_VERSION;
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

const operatorMetadataRepair = applyOperatorMetadataRepair(items);
if (operatorMetadataRepair.changed > 0) {
  console.log(
    `ترمیم متادیتای ویژه همراه: ${operatorMetadataRepair.changed} عنوان، ` +
    `${operatorMetadataRepair.overviewFilled} خلاصه، ${operatorMetadataRepair.peopleFilled} فهرست عوامل و ` +
    `${operatorMetadataRepair.imdbFilled} شناسه IMDb.`,
  );
}

items = items.filter((item) => !(
  item?.type === 'series' &&
  catalogVariant(item) === 'operator' &&
  baseCatalogId(item) === '0211f520-f2b9-11eb-8904-6179943b9168'
));

function reconcileStoredLanguageFiles(files) {
  const source = (Array.isArray(files) ? files : []).map((file) => {
    if (file?.language === 'dubbed' || file?.language === 'subtitled') return { ...file };
    const tag = mediaLanguageTag(`${file?.label || ''} ${file?.quality || ''}`);
    return tag ? { ...file, language: tag } : { ...file };
  });
  const explicit = new Set(source.map((file) => file.language).filter((value) => value === 'dubbed' || value === 'subtitled'));
  const unknown = source.filter((file) => !file.language);
  if (!unknown.length) return source;
  if (explicit.has('dubbed') && explicit.has('subtitled')) return source.filter((file) => Boolean(file.language));
  if (explicit.size === 1) {
    return source.filter((file) =>
      file.language === 'dubbed' ||
      file.language === 'subtitled' ||
      isValidStoredOperatorFile(file) ||
      isValidStoredPublicPortalFile(file)
    );
  }
  return source;
}

function reconcileStoredLanguageSections(item) {
  if (!item || !Array.isArray(item.downloads)) return item;
  if (item.type === 'series') {
    return {
      ...item,
      downloads: item.downloads.map((group) => ({
        ...group,
        files: reconcileStoredLanguageFiles(group?.files),
      })),
    };
  }

  const prepared = item.downloads.map((section) => {
    const sectionTag = mediaLanguageTag(`${section?.title || ''} ${section?.badge || ''}`);
    const files = (Array.isArray(section?.files) ? section.files : []).map((file) =>
      file?.language || !sectionTag ? { ...file } : { ...file, language: sectionTag },
    );
    return { ...section, files };
  });
  const explicit = new Set(prepared.flatMap((section) => section.files || [])
    .map((file) => file.language)
    .filter((value) => value === 'dubbed' || value === 'subtitled'));

  return {
    ...item,
    downloads: prepared.flatMap((section) => {
      const sectionTag = mediaLanguageTag(`${section?.title || ''} ${section?.badge || ''}`);
      if (sectionTag) return [{ ...section, files: reconcileStoredLanguageFiles(section.files) }];
      if (explicit.has('dubbed') && explicit.has('subtitled')) return [];
      if (explicit.size === 1) {
        const verifiedPortalFiles = (Array.isArray(section.files) ? section.files : [])
          .filter((file) => isValidStoredOperatorFile(file) || isValidStoredPublicPortalFile(file));
        if (verifiedPortalFiles.length) {
          return [{
            ...section,
            title: 'پخش آنلاین',
            badge: 'پخش',
            files: verifiedPortalFiles,
          }];
        }
        return [];
      }
      return [{
        ...section,
        title: 'لینک‌های دریافت',
        badge: 'دریافت',
        files: section.files || [],
      }];
    }),
  };
}

items = items.map(reconcileStoredLanguageSections);

// One-time clean rebuild of Iranian narrative series. Old revisions could
// publish a shell with "تا قسمت N" while the episode files were empty. Preserve
// metadata, but clear only Iranian narrative episode media and rebuild it
// sequentially. Foreign series, documentaries, movies and people are untouched.
if (Number(state.iranianSeriesRebuildVersion || 0) < IRANIAN_SERIES_REBUILD_VERSION) {
  let resetCount = 0;
  items = items.map((item) => {
    if (item?.type !== 'series') return item;
    const rules = classifyCatalogRules({ ...item, categoryKeys: [], categoryLabels: [] });
    if (!rules.ir || rules.isDocumentary || rules.contentKind === 'documentary') return item;
    resetCount += 1;
    return {
      ...item,
      downloads: [],
      episodeCount: 0,
      seasonCount: 0,
      latestEpisode: null,
      sourceEpisodeCount: 0,
      archivePendingEpisodeCount: 1,
      archivePendingEpisodes: [],
      archiveUnavailableEpisodes: [],
      archiveComplete: false,
      archiveAuditStatus: 'pending',
      publicationStatus: 'building-archive',
      visibilityLocked: false,
      mediaLanguageAuditVersion: 0,
    };
  });
  state.iranianSeriesPage = 1;
  state.iranianSeriesOffset = 0;
  state.iranianSeriesNoProgress = {};
  state.iranianSeriesActiveId = '';
  state.iranianSeriesRebuildVersion = IRANIAN_SERIES_REBUILD_VERSION;
  // Only suppress old visibility migrations when an Iranian shell was actually
  // reset. Regression/foreign-only catalogs must retain their old compatibility
  // behavior.
  if (resetCount > 0) {
    state.legacySeriesVisibilityMigrationCompleted = true;
    state.historicalVisibleSeriesRecoveryCompleted = true;
  }
  console.log(`بازسازی تمیز سریال ایرانی: ${resetCount} عنوان برای تکمیل ترتیبی ریست شد.`);
}

// Repair damage from older destructive sync revisions once. The workflow now
// fetches recent history, so any series that used to be visible but vanished
// from catalog.json can be restored before the monotonic guard takes over.
if (!state.historicalVisibleSeriesRecoveryCompleted) {
  try {
    const { stdout: historyOutput } = await execFileAsync(
      'git',
      ['log', '--format=%H', '-n', '40', '--', 'catalog.json'],
      { cwd: root, maxBuffer: 2 * 1024 * 1024 },
    );
    const commits = String(historyOutput || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (commits.length > 1) {
      const knownIds = new Set(items.filter((item) => item?.type === 'series' && item?.id).map((item) => String(item.id)));
      let recovered = 0;
      for (const commit of commits.slice(1)) {
        if (recovered >= 120) break;
        let historicalCatalog;
        try {
          const { stdout } = await execFileAsync(
            'git',
            ['show', `${commit}:catalog.json`],
            { cwd: root, maxBuffer: 64 * 1024 * 1024 },
          );
          historicalCatalog = JSON.parse(stdout);
        } catch {
          continue;
        }
        for (const historicalItem of Array.isArray(historicalCatalog?.items) ? historicalCatalog.items : []) {
          if (historicalItem?.type !== 'series' || !historicalItem?.id) continue;
          const id = String(historicalItem.id);
          if (knownIds.has(id)) continue;
          const downloads = Array.isArray(historicalItem.downloads) ? historicalItem.downloads : [];
          const hadVisibleMedia = downloads.some((group) => Array.isArray(group?.files) && group.files.length > 0);
          const explicitlyVisible = Boolean(
            historicalItem.visibilityLocked ||
            historicalItem.publicationStatus === 'published',
          );
          const predatesPublicationGate = historicalItem.publicationStatus === undefined;
          if (!hadVisibleMedia || (!explicitlyVisible && !predatesPublicationGate)) continue;
          items.push({
            ...historicalItem,
            visibilityLocked: true,
            publicationStatus: 'published',
          });
          knownIds.add(id);
          recovered += 1;
          if (recovered >= 120) break;
        }
      }
      state.historicalVisibleSeriesRecoveryCompleted = true;
      state.historicalVisibleSeriesRecoveredCount = recovered;
      if (recovered > 0) console.log(`بازیابی تاریخی: ${recovered} سریال حذف‌شده دوباره به کاتالوگ برگشت.`);
    }
  } catch {
    // Local/test environments may have no git history. Do not mark migration
    // complete there; the GitHub workflow will retry with fetched history.
  }
}

// One-time compatibility migration: series that already existed before this
// patch were visible to users. Keep those titles visible while their archive is
// audited/backfilled. Newly discovered series after this migration still wait
// until completion before publication.
if (!state.legacySeriesVisibilityMigrationCompleted) {
  items = items.map((item) => (
    item?.type === 'series' &&
    Array.isArray(item.downloads) &&
    item.downloads.length > 0
      ? {
          ...item,
          visibilityLocked: true,
          publicationStatus: 'published',
        }
      : item
  ));
  state.legacySeriesVisibilityMigrationCompleted = true;
}

// Snapshot the post-migration visibility state. This is the exact set of series
// the current run is forbidden to remove or hide.
const originalSeriesById = new Map(
  items
    .filter((item) => item?.type === 'series' && item?.id)
    .map((item) => [String(item.id), structuredClone(item)]),
);

// Operator access is recomputed from validated files on every run. This
// removes stale badges/categories created by older, overly broad matching.
// Existing duplicate rows (for example direct + operator versions of one title)
// are merged before the new sync starts.
const purchaseCleanup = sanitizeCatalogUnsupportedPurchases(items);
const initialOperatorCleanup = sanitizeCatalogOperatorAccess(purchaseCleanup.items);
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
// PEOPLE mode can start episode-artwork work before execution reaches the
// helper declarations below. Keep this counter initialized with the other
// run-scoped state to avoid the top-level `let` temporal dead zone.
let episodeFrameCapturesUsed = 0;

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
  backfillOrdering: 'oldest-production-year-then-one-active-title',
  backfillNextSeries: null,
  episodePaginationPagesFetched: 0,
  episodePaginationErrors: 0,
  episodePaginationTruncated: 0,
  episodeDiscoveryIncomplete: 0,

  incrementalCandidates: 0,
  incrementalSeriesDeferred: 0,
  incrementalProcessed: 0,
  recentMoviePagesScanned: 0,
  recentMovieCandidates: 0,
  recentMovieNewCandidates: 0,
  recentMoviesProcessed: 0,
  recentSeriesPagesScanned: 0,
  recentSeriesCandidates: 0,
  recentSeriesNewCandidates: 0,
  recentSeriesProcessed: 0,
  recentSeriesDeferredByArchiveQueue: 0,
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
  episodeFramesGenerated: 0,
  episodeFrameErrors: 0,
  seriesKeptVisibleDuringBackfill: 0,
  seriesRestoredByMonotonicGuard: 0,
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

  mediaRepairCandidates: 0,
  mediaRepairChecked: 0,
  mediaRepairRecovered: 0,
  mediaRepairStillMissing: 0,
  mediaRepairHiddenConfirmed: 0,
  mediaHealthCandidates: 0,
  mediaHealthChecked: 0,
  mediaHealthHealthy: 0,
  mediaHealthDead: 0,
  mediaHealthUnknown: 0,
  mediaHealthRecovered: 0,
  removedWithoutFreeLinks: 0,
  errors: [],
  errorsTruncated: 0,
};

console.log(
  `شروع همگام‌سازی امن؛ ${items.length} عنوان قبلی حفظ می‌شود.`,
);

const initialBackfillQueue = buildSequentialArchiveQueue();
stats.backfillQueueTotal = initialBackfillQueue.length;

const effectiveSyncMode =
  syncModeSetting === 'PEOPLE'
    ? 'PEOPLE'
    : syncModeSetting === 'IRANIAN'
      ? 'IRANIAN'
      : syncModeSetting === 'BACKFILL' ||
        (syncModeSetting === 'AUTO' && initialBackfillQueue.length > 0)
        ? 'BACKFILL'
        : 'NORMAL';

stats.effectiveSyncMode = effectiveSyncMode;
console.log(`حالت اجرا: ${effectiveSyncMode}`);

// «ویژه همراه» is an independent hourly discovery lane. Historically it only
// ran in NORMAL mode, and operator-series discovery was additionally disabled
// whenever an archive backfill existed. Since a real catalog can stay in
// BACKFILL mode for weeks, that starved this section indefinitely. Run the
// bounded operator probes before either NORMAL or BACKFILL work so old-archive
// completion can never block discovery of new operator-only movies/series.
if (effectiveSyncMode !== 'PEOPLE' && operatorDiscoveryEnabled) {
  await syncOperatorPriorityDiscovery();
}

if (effectiveSyncMode === 'PEOPLE') {
  // PEOPLE mode exists primarily to repair cast/director metadata. Do that first
  // so a large episode-artwork queue cannot consume the entire run budget.
  await syncPeopleMetadata();
  if (!runTimeBudgetReached('before-operator-overviews', 45000)) {
    await enrichMissingOperatorOverviews();
  }
  if (!runTimeBudgetReached('before-episode-artwork-metadata', 60000)) {
    await syncEpisodeArtworkMetadata();
  }
} else if (effectiveSyncMode === 'IRANIAN') {
  // Dedicated hourly lane: one Iranian narrative series stays selected until
  // every discoverable episode has usable media. Probe page one first so a
  // newly released Iranian series is not forced to wait for the long archive
  // cursor to wrap back from an older page.
  await withAffiliateRequestScope(
    'iranian-series',
    iranianSeriesRequestQuota,
    async () => {
      // Finish ordinary Iranian series that already have real direct media
      // before scanning more new titles. These partial archives were previously
      // skipped forever because the discovery lane ignored every existing item.
      await syncIranianIncompleteSeries();
      if (affiliateBudgetExhausted || affiliateScopeExhausted) return;
      await syncRecentIranianSeriesDiscovery();
      // Recent airing updates and sequential archive publication have separate
      // responsibilities. A harmless page-one refresh must never starve the
      // archive queue while request budget remains.
      if (!affiliateBudgetExhausted && !affiliateScopeExhausted) {
        await syncIranianSeriesArchive();
      }
    },
  );
} else if (effectiveSyncMode === 'BACKFILL') {
  // The archive queue is intentionally exclusive: one series is completed
  // as far as the request budget allows before the next series is selected.
  // No new movie/series archive pages are scanned in this mode, so repeated
  // runs shrink the existing backlog instead of continuously adding more
  // incomplete titles.
  stats.normalSyncSkippedForBackfill = true;
  await syncSequentialArchiveBackfill();

  // If the active archive finished before the request budget was consumed,
  // keep already-published weekly series current without discovering titles.
  if (!affiliateBudgetExhausted) {
    await syncAiringSeriesUpdates();
  }
} else {
  // Published, currently-airing series are checked first. A newly released
  // episode must be visible in this hourly run before broader discovery spends
  // the request budget. Discovery then scans movies and the next sequential
  // series archive from page 1.
  await withAffiliateRequestScope(
    'airing-series',
    airingRequestQuota,
    syncAiringSeriesUpdates,
  );

  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-recent-movies', 90000)) {
    await withAffiliateRequestScope(
      'recent-movies',
      recentMovieRequestQuota,
      syncRecentMovieDiscovery,
    );
  }

  // Finish fresh-title discovery before spending the remaining budget on
  // old-media repair. Previously the repair lane ran first and could starve
  // recent series, leaving newly discovered series shells without episode media.
  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-recent-series', 90000)) {
    await withAffiliateRequestScope(
      'recent-series',
      recentSeriesRequestQuota,
      syncRecentSeriesDiscovery,
    );
  }

  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-media-repair', 80000)) {
    await withAffiliateRequestScope(
      'media-repair',
      mediaRepairRequestQuota,
      syncIncompleteMovieMedia,
    );
  }

  if (!runTimeBudgetReached('before-media-health-audit', 70000)) {
    await withAffiliateRequestScope(
      'media-health-audit',
      Math.min(12, recentMovieRequestQuota),
      syncMovieMediaHealthAudit,
    );
  }

  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-incremental', 75000)) {
    await withAffiliateRequestScope(
      'incremental',
      incrementalRequestQuota,
      syncIncrementalTitles,
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

  if (
    !affiliateBudgetExhausted &&
    buildSequentialBackfillQueue().length === 0 &&
    !runTimeBudgetReached('before-archive-series', 60000)
  ) {
    await withAffiliateRequestScope(
      'archive-series',
      archiveSeriesRequestQuota,
      syncSeriesArchive,
    );
  }

  if (
    !affiliateBudgetExhausted &&
    buildSequentialBackfillQueue().length === 0 &&
    !runTimeBudgetReached('before-iranian-series', 55000)
  ) {
    await withAffiliateRequestScope(
      'iranian-series',
      iranianSeriesRequestQuota,
      syncIranianSeriesArchive,
    );
  }

}

// Existing series are append/update-only. No hourly sync stage is allowed to
// remove a concrete series ID. More importantly, a series that was visible at
// the START of this run can never become hidden because a later API response
// was partial. Building archives remain hidden until genuinely publishable.
const currentSeriesById = new Map(
  items
    .filter((item) => item?.type === 'series' && item?.id)
    .map((item) => [String(item.id), item]),
);
for (const [id, originalSeries] of originalSeriesById.entries()) {
  const wasVisible = Boolean(
    originalSeries.visibilityLocked ||
    originalSeries.publicationStatus === 'published',
  );
  const current = currentSeriesById.get(id);
  if (!current) {
    const restored = wasVisible
      ? { ...originalSeries, visibilityLocked: true, publicationStatus: 'published' }
      : originalSeries;
    items.push(restored);
    currentSeriesById.set(id, restored);
    stats.seriesRestoredByMonotonicGuard += 1;
    continue;
  }

  const strictIranian = Boolean(effectiveIranianIdentity(current) && !current?.isDocumentary && current?.contentKind !== 'documentary');
  if (wasVisible && !strictIranian && current.publicationStatus !== 'published') {
    const index = items.indexOf(current);
    const restoredVisibility = {
      ...current,
      visibilityLocked: true,
      publicationStatus: 'published',
    };
    if (index >= 0) items[index] = restoredVisibility;
    currentSeriesById.set(id, restoredVisibility);
    stats.seriesRestoredByMonotonicGuard += 1;
  }
}

// A title can exist twice in Upera: the ordinary Upera edition and a separate
// mobile-operator/Filimo edition. They must remain two independent catalog
// posts even when their name, year and IMDb id are identical.
items = collapseInvalidatedOperatorDuplicates(splitOperatorCatalogVariants(items));

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
if (!runTimeBudgetReached('before-operator-classification', 35000)) {
  await enrichOperatorClassificationMetadata();
}
items = items.map(reclassifyCatalogItem).map((item) => withSeriesPublicationState(item));
stats.seriesAwaitingArchiveAudit = items.filter(
  (item) => item?.type === 'series' && !hasSeriesArchiveMetadata(item),
).length;
stats.backfillBacklogRemaining = buildSequentialArchiveQueue().length;
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

function movieHasUsableMedia(item) {
  if (isDirectMediaUrl(item?.streamUrl) || operatorPortalDetails(item?.streamUrl)) return true;
  return (Array.isArray(item?.downloads) ? item.downloads : []).some(
    (section) => (Array.isArray(section?.files) ? section.files : []).some((file) =>
      isDirectMediaUrl(file?.url) || isValidStoredOperatorFile(file) || isValidStoredPublicPortalFile(file),
    ),
  );
}

function catalogHasDownload(item) {
  return (Array.isArray(item?.downloads) ? item.downloads : []).some((section) =>
    (Array.isArray(section?.files) ? section.files : []).some((file) =>
      file?.mode === 'download' && isDownloadableMediaUrl(file?.url),
    ),
  );
}

function catalogHasPublicPlayback(item) {
  if (isPlayableMediaUrl(item?.streamUrl) || operatorPortalDetails(item?.streamUrl)) return true;
  return (Array.isArray(item?.downloads) ? item.downloads : []).some((section) =>
    (Array.isArray(section?.files) ? section.files : []).some((file) =>
      isValidStoredPublicPortalFile(file) ||
      (file?.mode === 'play' && isPlayableMediaUrl(file?.url)),
    ),
  );
}

function movieRepresentativeDirectUrl(item) {
  if (isDirectMediaUrl(item?.streamUrl)) return cleanText(item.streamUrl);
  for (const section of Array.isArray(item?.downloads) ? item.downloads : []) {
    for (const file of Array.isArray(section?.files) ? section.files : []) {
      if (isDirectMediaUrl(file?.url)) return cleanText(file.url);
    }
  }
  return '';
}

async function probeDirectMediaUrl(urlValue) {
  const url = cleanText(urlValue);
  if (!isDirectMediaUrl(url)) return 'unknown';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: /\.mp4(?:$|[?#])/i.test(url)
        ? { Range: 'bytes=0-1', Accept: '*/*' }
        : { Range: 'bytes=0-2047', Accept: '*/*' },
    });
    const status = Number(response.status || 0);
    try { await response.body?.cancel(); } catch { /* no-op */ }
    if (status === 200 || status === 206) return 'healthy';
    if (status === 404 || status === 410) return 'dead';
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timeout);
  }
}

async function syncMovieMediaHealthAudit() {
  const nowMs = Date.now();
  const healthyRetryMs = 7 * 24 * 60 * 60 * 1000;
  const suspectRetryMs = 12 * 60 * 60 * 1000;
  const candidates = items.filter((item) => {
    if (item?.type !== 'movie' || !movieHasUsableMedia(item)) return false;
    const url = movieRepresentativeDirectUrl(item);
    if (!url) return false; // Operator portal links are validated structurally elsewhere.
    const last = Date.parse(String(item?.mediaAuditCheckedAt || '')) || 0;
    const retryMs = ['broken-links', 'missing-links', 'confirmed-unavailable'].includes(String(item?.mediaAuditStatus || ''))
      ? suspectRetryMs
      : healthyRetryMs;
    return !last || nowMs - last >= retryMs;
  });
  stats.mediaHealthCandidates = candidates.length;
  if (!candidates.length) { state.mediaHealthOffset = 0; return; }

  const limit = Math.min(24, candidates.length);
  const start = state.mediaHealthOffset % candidates.length;
  const selected = Array.from({ length: limit }, (_, step) => candidates[(start + step) % candidates.length]);
  const results = [];
  for (let offset = 0; offset < selected.length; offset += 4) {
    if (runTimeBudgetReached('media-health-probe', 50000)) break;
    const batch = selected.slice(offset, offset + 4);
    results.push(...await Promise.all(batch.map(async (item) => ({
      item,
      status: await probeDirectMediaUrl(movieRepresentativeDirectUrl(item)),
    }))));
  }

  let repairsUsed = 0;
  for (const result of results) {
    const item = result.item;
    const id = String(item.id);
    const current = items.find((entry) => entry?.type === 'movie' && String(entry?.id) === id);
    if (!current) continue;
    let target = current;
    stats.mediaHealthChecked += 1;
    target.mediaAuditCheckedAt = new Date().toISOString();

    if (result.status === 'healthy') {
      target.mediaAuditStatus = 'ok';
      delete state.mediaRepairFailures[id];
      stats.mediaHealthHealthy += 1;
      continue;
    }
    if (result.status !== 'dead') {
      stats.mediaHealthUnknown += 1;
      continue;
    }

    stats.mediaHealthDead += 1;
    const failure = state.mediaRepairFailures[id] || { count: 0, firstAt: new Date().toISOString() };
    failure.count = nonNegativeInt(failure.count, 0) + 1;
    failure.lastAt = new Date().toISOString();
    state.mediaRepairFailures[id] = failure;
    target.mediaAuditStatus = 'broken-links';

    // A dead CDN URL can often be repaired by refreshing the affiliate payload.
    // Bound this expensive path so catalog health checks never starve discovery.
    if (repairsUsed < 6 && !affiliateBudgetExhausted && !affiliateScopeExhausted) {
      repairsUsed += 1;
      const beforeUrl = movieRepresentativeDirectUrl(target);
      const refreshed = await processMovie(target, 'media-health-repair', { replaceMedia: true });
      const refreshedItem = items.find((entry) => entry?.type === 'movie' && String(entry?.id) === id);
      const afterUrl = movieRepresentativeDirectUrl(refreshedItem);
      if (refreshed?.added && refreshedItem && afterUrl) {
        target = refreshedItem;
        const recheck = await probeDirectMediaUrl(afterUrl);
        refreshedItem.mediaAuditCheckedAt = new Date().toISOString();
        if (recheck === 'healthy') {
          refreshedItem.mediaAuditStatus = 'ok';
          delete state.mediaRepairFailures[id];
          stats.mediaHealthRecovered += 1;
          continue;
        }
        // If the source returned the same dead URL, preserve the failure count.
        if (afterUrl !== beforeUrl && recheck === 'unknown') {
          refreshedItem.mediaAuditStatus = 'missing-links';
          continue;
        }
      }
    }

    const spanMs = Date.now() - (Date.parse(failure.firstAt) || Date.now());
    if (failure.count >= 3 && spanMs >= 20 * 60 * 60 * 1000) {
      target.mediaAuditStatus = 'confirmed-unavailable';
      stats.mediaRepairHiddenConfirmed += 1;
    }
  }

  state.mediaHealthOffset = (start + Math.max(1, stats.mediaHealthChecked)) % Math.max(1, candidates.length);
}

async function syncIncompleteMovieMedia() {
  const nowMs = Date.now();
  const retryMs = 2 * 60 * 60 * 1000;
  const candidates = items
    .filter((item) => {
      if (item?.type !== 'movie') return false;
      const needsLinks = !movieHasUsableMedia(item);
      const needsLanguageAudit =
        nonNegativeInt(item.mediaLanguageAuditVersion, 0) < MEDIA_LANGUAGE_AUDIT_VERSION;
      if (!needsLinks && !needsLanguageAudit) return false;
      const last = Date.parse(String(item?.mediaAuditCheckedAt || '')) || 0;
      return !last || nowMs - last >= retryMs;
    })
    // Empty-media titles are repaired first; then the same lane steadily
    // re-audits old movies for dubbed/subtitled variants after parser changes.
    .sort((a, b) =>
      Number(movieHasUsableMedia(a)) - Number(movieHasUsableMedia(b)) ||
      archiveItemYear(a) - archiveItemYear(b) ||
      archiveItemTimestamp(a) - archiveItemTimestamp(b),
    );

  stats.mediaRepairCandidates = candidates.length;
  if (!candidates.length) { state.mediaRepairOffset = 0; return; }

  const limit = Math.min(120, candidates.length);
  const start = state.mediaRepairOffset % candidates.length;
  let visited = 0;
  for (let step = 0; step < limit; step += 1) {
    if (affiliateBudgetExhausted || affiliateScopeExhausted || runTimeBudgetReached('media-repair', 70000)) break;
    const item = candidates[(start + step) % candidates.length];
    const id = String(item.id);
    const hadUsableMedia = movieHasUsableMedia(item);
    stats.mediaRepairChecked += 1;
    visited += 1;

    let result;
    try {
      result = await processMovie(item, 'media-repair', { fullMediaAudit: true, replaceMedia: true });
    } catch (error) {
      if (isRunTimeBudgetError(error)) throw error;
      // A single slow/broken affiliate response must not abort the whole
      // hourly sync. Keep the existing media untouched and move the cursor so
      // this title is retried in a later run after the rest make progress.
      rememberError(`media-repair-${id}`, error);
      stats.mediaRepairStillMissing += 1;
      continue;
    }
    const current = items.find((entry) => entry?.type === 'movie' && String(entry?.id) === id);

    if (result?.added && current && movieHasUsableMedia(current)) {
      current.mediaLanguageAuditVersion = MEDIA_LANGUAGE_AUDIT_VERSION;
      current.mediaAuditStatus = 'ok';
      current.mediaAuditCheckedAt = new Date().toISOString();
      delete state.mediaRepairFailures[id];
      stats.mediaRepairRecovered += 1;
      continue;
    }

    if (current && result?.reason === 'no-usable-links') {
      current.mediaAuditCheckedAt = new Date().toISOString();

      // Never destroy/hide a previously healthy title because one affiliate
      // refresh temporarily returned an empty payload. Leave its old media in
      // place and retry the language audit later.
      if (hadUsableMedia && movieHasUsableMedia(current)) {
        current.mediaAuditStatus = 'ok';
        stats.mediaRepairStillMissing += 1;
        continue;
      }

      const failure = state.mediaRepairFailures[id] || { count: 0, firstAt: new Date().toISOString() };
      failure.count = nonNegativeInt(failure.count, 0) + 1;
      failure.lastAt = current.mediaAuditCheckedAt;
      state.mediaRepairFailures[id] = failure;
      current.mediaAuditStatus = failure.count >= 3 && (Date.now() - (Date.parse(failure.firstAt) || Date.now())) >= 20 * 60 * 60 * 1000
        ? 'confirmed-unavailable'
        : 'missing-links';
      if (current.mediaAuditStatus === 'confirmed-unavailable') stats.mediaRepairHiddenConfirmed += 1;
      else stats.mediaRepairStillMissing += 1;
    }
  }

  state.mediaRepairOffset = (start + Math.max(1, visited)) % Math.max(1, candidates.length);
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
  // Fresh/current series are independent from archive backfill.
  stats.recentSeriesDeferredByArchiveQueue = 0;

  const selected = candidates
    .map((candidate) => ({
      candidate,
      priority: discoveryCandidatePriority(candidate, 'series'),
      timestamp: candidateSourceTimestamp(candidate),
      existing: findExistingItem(candidate, 'series'),
    }))
    .filter((entry) => entry.priority < 99)
    // Already-published airing series are maintained by the dedicated airing
    // pass below. Discovery is only allowed to start one unpublished archive.
    .filter((entry) => entry.existing?.publicationStatus !== 'published')
    .sort((a, b) => a.priority - b.priority || b.timestamp - a.timestamp)
    .slice(0, recentSeriesTitlesPerRun);

  stats.recentSeriesNewCandidates = selected.filter((entry) => entry.priority === 0).length;
  for (const { candidate, existing } of selected) {
    if (affiliateBudgetExhausted || affiliateScopeExhausted) break;
    try {
      const result = await processSeries(candidate, 'recent-discovery', {
        episodeStrategy: 'latest',
        episodeLimit: recentSeriesEpisodeLimit,
        onlyMissing: true,
      });
      if (!existing && result?.added) {
        const added = findExistingItem(candidate, 'series');
        if (added) {
          added.meaningfulUpdatedAt = added.meaningfulUpdatedAt || new Date().toISOString();
          added.updateLabel = 'سریال جدید';
        }
      }
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

      const type = detectType(candidate);
      if (type === 'series') {
        const existing = findExistingItem(candidate, 'series');
        if (
          !existing ||
          existing.publicationStatus !== 'published' ||
          existing.isAiring !== true
        ) {
          stats.incrementalSeriesDeferred += 1;
          continue;
        }
      }

      if (type === 'episode') {
        const parentId = String(
          candidate?.series_id ||
          candidate?.seriesId ||
          candidate?.t_id ||
          '',
        );
        const existingSeries = items.find((item) =>
          item?.type === 'series' &&
          String(item.id) === parentId,
        );
        if (
          !existingSeries ||
          existingSeries.publicationStatus !== 'published' ||
          existingSeries.isAiring !== true
        ) {
          stats.incrementalSeriesDeferred += 1;
          continue;
        }
      }

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
  const currentYear = new Date().getUTCFullYear();
  const candidates = items
    .filter((item) =>
      item?.type === 'series' &&
      (
        item?.isAiring === true ||
        // Iranian feeds frequently omit/clear the airing flag even while a
        // current production is still receiving episodes. Keep current-year
        // published Iranian series in the bounded hourly refresh lane so a
        // title such as «اهل ایران» cannot remain frozen at an old episode.
        (effectiveIranianIdentity(item) && Number(item?.year || 0) >= currentYear)
      ) &&
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
    if (affiliateBudgetExhausted || affiliateScopeExhausted || runTimeBudgetReached('airing-series-refresh', 60000)) break;
    try {
      const result = await processSeries(
        { id: item.id, type: 'series' },
        'airing-refresh',
        {
          episodeStrategy: 'latest',
          episodeLimit: 12,
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

async function syncRecentIranianSeriesDiscovery() {
  let payload;
  try {
    payload = await fetchIranianSeriesPage(1);
  } catch (error) {
    rememberError('iranian-series-recent-page-1', error);
    return false;
  }

  const candidates = dedupeCandidates(payload.items)
    .map((candidate) => ({
      candidate,
      sourceId: String(baseCatalogId(candidate) || candidate?.t_id || candidate?.series_id || ''),
      existing: findExistingItem(candidate, 'series'),
      timestamp: candidateSourceTimestamp(candidate),
    }))
    .filter(({ sourceId, existing, timestamp }) => {
      // Terminal recent-page checks are remembered across the bounded shell
      // passes. A row is reconsidered only when the source timestamp changes,
      // so rejected/no-op rows cannot multiply API work 24 times per run.
      const checkedTimestamp = Number(
        state.iranianRecentSeriesCheckedAt?.[sourceId] || 0,
      );
      if (timestamp > 0 && checkedTimestamp >= timestamp) return false;
      if (!existing) return true;
      const storedTimestamp = Math.max(
        Date.parse(String(existing?.sourceUpdatedAt || '')) || 0,
        Date.parse(String(existing?.sourceCreatedAt || '')) || 0,
      );
      return timestamp > storedTimestamp;
    })
    .sort((a, b) =>
      Number(inferIranian(b.candidate)) - Number(inferIranian(a.candidate)) ||
      b.timestamp - a.timestamp
    )
    .slice(0, 12);

  for (const { candidate, existing, sourceId, timestamp } of candidates) {
    if (affiliateBudgetExhausted || affiliateScopeExhausted) return true;
    stats.iranianSeriesCandidates += 1;
    let result;
    try {
      result = await processSeries(candidate, 'iranian-recent', {
        requireIranian: true,
        episodeStrategy: 'latest',
        episodeLimit: Math.min(120, Math.max(1, priorityEpisodesPerSeries)),
        onlyMissing: true,
      });
    } catch (error) {
      rememberError(`iranian-series-recent-${sourceId || 'unknown'}`, error);
      result = { added: false, reason: 'request-error', retryLater: false };
    }

    const refreshed = items.find((item) =>
      item?.type === 'series' &&
      (String(baseCatalogId(item)) === sourceId || String(item.id || '') === sourceId)
    );
    const belongsToIranianSeries = Boolean(
      refreshed &&
      classifyCatalogRules({ ...refreshed, categoryKeys: [], categoryLabels: [] }).categoryKeys.includes('iranian-series')
    );
    const wasPublished = Boolean(
      existing?.publicationStatus === 'published' ||
      existing?.visibilityLocked
    );
    const newlyPublished = Boolean(
      !wasPublished &&
      refreshed?.publicationStatus === 'published' &&
      refreshed?.archiveComplete === true
    );
    const meaningfulRecentProgress = Boolean(
      newlyPublished ||
      Number(result?.addedEpisodes || 0) > 0 ||
      (
        result?.added &&
        refreshed &&
        refreshed.publicationStatus !== 'published'
      )
    );

    const terminalRecentCheck = Boolean(
      !result?.retryLater &&
      result?.reason !== 'request-error' &&
      (!meaningfulRecentProgress || result?.archiveComplete)
    );
    if (terminalRecentCheck && sourceId && timestamp > 0) {
      if (
        !state.iranianRecentSeriesCheckedAt ||
        typeof state.iranianRecentSeriesCheckedAt !== 'object' ||
        Array.isArray(state.iranianRecentSeriesCheckedAt)
      ) {
        state.iranianRecentSeriesCheckedAt = {};
      }
      state.iranianRecentSeriesCheckedAt[sourceId] = Math.max(
        Number(state.iranianRecentSeriesCheckedAt[sourceId] || 0),
        timestamp,
      );
      // Page one is small, but keep a bounded history so stale source ids can
      // never make sync-state.json grow without limit.
      state.iranianRecentSeriesCheckedAt = Object.fromEntries(
        Object.entries(state.iranianRecentSeriesCheckedAt)
          .filter(([id, value]) => id && Number(value) > 0)
          .sort(([, left], [, right]) => Number(right) - Number(left))
          .slice(0, 96),
      );
    }

    rememberDiagnostic('iranianSeriesDiagnostics', {
      id: sourceId,
      title: cleanText(candidate?.name_fa || candidate?.name || refreshed?.nameFa || refreshed?.name || ''),
      result: result?.archiveComplete ? 'completed' : result?.added ? 'advanced' : 'rejected',
      reason: result?.reason || '',
      addedEpisodes: Number(result?.addedEpisodes || 0),
      remainingEpisodeCount: Number(result?.remainingEpisodeCount || 0),
      retryLater: Boolean(result?.retryLater),
      newlyPublished,
      meaningfulProgress: meaningfulRecentProgress,
      discovery: 'recent-page-1',
    });

    if (result?.retryLater) return true;
    if (!belongsToIranianSeries) continue;
    if (meaningfulRecentProgress) return true;
  }
  return false;
}


function archiveItemYear(item) {
  const year = Number(item?.year);
  return Number.isInteger(year) && year >= 1880 && year <= 2100 ? year : 9999;
}

function archiveItemTimestamp(item) {
  for (const candidate of [item?.sourceCreatedAt, item?.createdAt, item?.firstSeenAt]) {
    const timestamp = Date.parse(String(candidate || ''));
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return Number.MAX_SAFE_INTEGER;
}

function movieMediaAuditDue(item) {
  if (!item || item.type !== 'movie') return false;
  if (item.mediaAuditStatus === 'confirmed-unavailable') return false;
  return !movieHasUsableMedia(item) || nonNegativeInt(item.mediaLanguageAuditVersion, 0) < MEDIA_LANGUAGE_AUDIT_VERSION;
}

function seriesMediaAuditDue(item) {
  return Boolean(
    item?.type === 'series' &&
    nonNegativeInt(item.mediaLanguageAuditVersion, 0) < MEDIA_LANGUAGE_AUDIT_VERSION,
  );
}

function buildSequentialArchiveQueue() {
  const entries = [];
  for (let catalogIndex = 0; catalogIndex < items.length; catalogIndex += 1) {
    const item = items[catalogIndex];
    if (!item || !['movie', 'series'].includes(item.type)) continue;
    // Operator siblings are derived from their standard source record. They
    // are not real Upera title ids and must never become archive/API cursors.
    if (catalogVariant(item) === 'operator') continue;
    if (item.type === 'movie') {
      if (!movieMediaAuditDue(item)) continue;
      entries.push({ item, catalogIndex, kind: 'movie', deficit: { total: movieHasUsableMedia(item) ? 0 : 1 } });
      continue;
    }
    const deficit = seriesArchiveDeficit(item);
    const blocked = item?.archiveAuditStatus === 'blocked';
    if (blocked && !blockedSeriesRetryDue(item)) continue;
    const needsSeriesWork = Boolean(
      deficit.total > 0 ||
      item?.publicationStatus !== 'published' ||
      !hasSeriesArchiveMetadata(item) ||
      seriesHasUnavailableRetryDue(item) ||
      seriesCompletenessAuditDue(item) ||
      seriesMediaAuditDue(item)
    );
    if (needsSeriesWork) entries.push({ item, catalogIndex, kind: 'series', deficit });
  }

  return entries.sort((a, b) => {
    // Series completion is the dedicated BACKFILL lane. Movies already have
    // their own bounded media-repair lane in NORMAL runs, so an old movie audit
    // must never consume the whole archive run before a series is selected.
    const typeDiff = Number(b.kind === 'series') - Number(a.kind === 'series');
    if (typeDiff) return typeDiff;

    const activeId = String(state.archiveBackfillItemId || '');
    const activeType = String(state.archiveBackfillItemType || '');
    const aActive = String(a.item?.id || '') === activeId && a.item?.type === activeType;
    const bActive = String(b.item?.id || '') === activeId && b.item?.type === activeType;
    if (aActive !== bActive) return aActive ? -1 : 1;

    // The archive is deterministic: finish the oldest discovered production
    // year first, across movies, series, animation, anime, documentaries and
    // programs (all of those are represented by movie/series source records).
    const yearDiff = archiveItemYear(a.item) - archiveItemYear(b.item);
    if (yearDiff) return yearDiff;

    const dateDiff = archiveItemTimestamp(a.item) - archiveItemTimestamp(b.item);
    if (dateDiff) return dateDiff;
    const titleDiff = String(a.item?.nameFa || a.item?.name || '').localeCompare(
      String(b.item?.nameFa || b.item?.name || ''), 'fa',
    );
    if (titleDiff) return titleDiff;
    return a.catalogIndex - b.catalogIndex;
  });
}

function chooseActiveArchiveItem(queue) {
  const activeId = String(state.archiveBackfillItemId || '');
  const activeType = String(state.archiveBackfillItemType || '');
  if (activeId && activeType) {
    const active = queue.find((entry) =>
      String(entry.item?.id || '') === activeId && entry.item?.type === activeType,
    );
    if (active) return active;
  }
  const first = queue[0] || null;
  if (!first) {
    state.archiveBackfillItemId = '';
    state.archiveBackfillItemType = '';
    state.archiveBackfillItemTitle = '';
    return null;
  }
  state.archiveBackfillItemId = String(first.item?.id || '');
  state.archiveBackfillItemType = String(first.item?.type || '');
  state.archiveBackfillItemTitle = cleanText(first.item?.nameFa || first.item?.name || '');
  return first;
}

function clearActiveArchiveItem(expectedType = '', expectedId = '') {
  if (expectedType && state.archiveBackfillItemType && state.archiveBackfillItemType !== expectedType) return;
  if (expectedId && state.archiveBackfillItemId && String(state.archiveBackfillItemId) !== String(expectedId)) return;
  state.archiveBackfillItemId = '';
  state.archiveBackfillItemType = '';
  state.archiveBackfillItemTitle = '';
}

async function syncSequentialArchiveBackfill() {
  let moviesCompletedThisRun = 0;
  while (
    !affiliateBudgetExhausted &&
    !runTimeBudgetReached('year-archive-backfill', 60000) &&
    moviesCompletedThisRun < 100
  ) {
    const queue = buildSequentialArchiveQueue();
    stats.backfillQueueTotal = Math.max(stats.backfillQueueTotal, queue.length);
    if (!queue.length) {
      clearActiveArchiveItem();
      clearActiveBackfillSeries();
      return;
    }

    const active = chooseActiveArchiveItem(queue);
    if (!active) return;
    const item = active.item;
    const id = String(item.id || '');
    const title = cleanText(item.nameFa || item.name || id);

    if (item.type === 'series') {
      state.archiveBackfillSeriesId = id;
      state.archiveBackfillSeriesTitle = title;
      await syncSequentialSeriesBackfill();
      const refreshed = items.find((entry) => entry?.type === 'series' && String(entry.id) === id);
      const stillQueued = refreshed && buildSequentialArchiveQueue().some((entry) =>
        entry.item?.type === 'series' && String(entry.item?.id || '') === id,
      );
      if (!stillQueued) clearActiveArchiveItem('series', id);
      // One series owns a BACKFILL run. This preserves deterministic resume
      // semantics and prevents one episode from being added to many series.
      return;
    }

    console.log(`تکمیل آرشیو سال ${archiveItemYear(item)}: فیلم «${title}»`);
    const hadUsableMedia = movieHasUsableMedia(item);
    let result;
    try {
      result = await processMovie(item, 'year-backfill', {
        fullMediaAudit: true,
        replaceMedia: hadUsableMedia,
      });
    } catch (error) {
      rememberError(`year-backfill-movie-${id}`, error);
      result = { added: false, reason: 'request-error' };
    }

    const refreshed = items.find((entry) => entry?.type === 'movie' && String(entry.id) === id) || item;
    if (result?.added && movieHasUsableMedia(refreshed)) {
      refreshed.mediaLanguageAuditVersion = MEDIA_LANGUAGE_AUDIT_VERSION;
      refreshed.mediaAuditStatus = 'ok';
      refreshed.mediaAuditCheckedAt = new Date().toISOString();
      delete state.mediaRepairFailures[id];
      clearActiveArchiveItem('movie', id);
      moviesCompletedThisRun += 1;
      await persistSyncCheckpoint(`year-backfill-movie-complete-${id}`);
      continue;
    }

    const failure = state.mediaRepairFailures[id] || { count: 0, firstAt: new Date().toISOString() };
    failure.count = nonNegativeInt(failure.count, 0) + 1;
    failure.lastAt = new Date().toISOString();
    state.mediaRepairFailures[id] = failure;
    refreshed.mediaAuditCheckedAt = failure.lastAt;
    refreshed.mediaAuditStatus = hadUsableMedia ? 'ok' : 'missing-links';

    // A zero-media movie must not freeze the oldest production year. Resolve it
    // out of the sequential archive queue after one clean "no usable links"
    // response; the independent NORMAL media-repair lane keeps retrying it every
    // couple of hours, so a temporary source omission can still recover later.
    if (!hadUsableMedia && result?.reason === 'no-usable-links') {
      refreshed.mediaLanguageAuditVersion = MEDIA_LANGUAGE_AUDIT_VERSION;
      refreshed.mediaAuditStatus = 'confirmed-unavailable';
      clearActiveArchiveItem('movie', id);
      moviesCompletedThisRun += 1;
      await persistSyncCheckpoint(`year-backfill-movie-deferred-${id}`);
      continue;
    }

    // Existing usable media stays published. Give its full language audit a few
    // deterministic retries so dub/subtitle variants are not missed because of
    // one transient affiliate response.
    if (failure.count >= 3) {
      refreshed.mediaLanguageAuditVersion = MEDIA_LANGUAGE_AUDIT_VERSION;
      if (!movieHasUsableMedia(refreshed)) refreshed.mediaAuditStatus = 'confirmed-unavailable';
      clearActiveArchiveItem('movie', id);
      moviesCompletedThisRun += 1;
      await persistSyncCheckpoint(`year-backfill-movie-resolved-${id}`);
      continue;
    }

    await persistSyncCheckpoint(`year-backfill-movie-${id}`);
    // Retry this exact movie on the next run before advancing within the year.
    return;
  }
}

async function syncSequentialSeriesBackfill() {
  const queue = buildSequentialBackfillQueue();
  stats.incompleteSeriesCandidates = queue.length;
  stats.backfillQueueTotal = Math.max(stats.backfillQueueTotal, queue.length);

  if (!queue.length) {
    clearActiveBackfillSeries();
    state.archiveBackfillOffset = 0;
    return;
  }

  // Lock the queue to exactly one series. The same id is kept in sync-state
  // across hourly runs until it is complete (or explicitly blocked). This is
  // what prevents the old "one episode on many different series" behaviour.
  const active = chooseActiveBackfillSeries(queue);
  if (!active) return;

  const id = String(active.item.id || '');
  const title = active.item.nameFa || active.item.name || id;
  state.archiveBackfillOffset = 0;
  state.archiveBackfillSeriesId = id;
  state.archiveBackfillSeriesTitle = title;
  stats.backfillSeriesVisited = 1;
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

  console.log(`تکمیل ترتیبی آرشیو: ${title}`);

  let completedInThisRun = false;
  let noProgressRecorded = false;

  while (
    !affiliateBudgetExhausted &&
    !runTimeBudgetReached('backfill-active-series')
  ) {
    const current = items.find((item) =>
      item?.type === 'series' && String(item.id) === id,
    );
    const before = seriesArchiveDeficit(current);
    const remainingBudget = Math.max(0, maxAffiliateRequests - affiliateRequestsUsed);
    if (remainingBudget <= 1) break;

    let result;
    try {
      // Completeness has priority over language re-auditing. Re-fetching every
      // already-known episode before filling gaps wastes the hourly budget and
      // was the reason old series stayed at 1/4/6 episodes for many runs. Once
      // the archive has no episode deficit, the same active series gets a full
      // dubbed/subtitle media audit before the queue advances.
      const currentDeficit = seriesArchiveDeficit(current);
      const refreshAllMedia = seriesMediaAuditDue(current) && currentDeficit.total === 0;
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
          onlyMissing: !refreshAllMedia,
          refreshAllMedia,
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
      remaining.total === 0 &&
      !seriesMediaAuditDue(refreshed),
    );
    const progressed = Boolean(
      addedEpisodes > 0 ||
      remaining.total < before.total ||
      completed,
    );

    rememberDiagnostic('seriesEpisodeDiagnostics', {
      seriesId: id,
      title,
      source: 'fast-backfill-summary',
      missingBefore: before.missing,
      pendingBefore: before.pending,
      missingAfter: remaining.missing,
      pendingAfter: remaining.pending,
      publicationStatus: refreshed?.publicationStatus || '',
      result: completed ? 'completed' : affiliateBudgetExhausted ? 'paused-by-budget' : progressed ? 'advanced' : 'no-progress',
      addedEpisodes,
      unavailableMarked: Number(result?.unavailableMarked || 0),
    });

    if (completed) {
      stats.incompleteSeriesRepaired += 1;
      stats.backfillSeriesCompletedThisRun.push({ id, title });
      state.archiveBackfillCompleted[id] = new Date().toISOString();
      delete state.archiveBackfillNoProgress[id];
      clearActiveBackfillSeries();
      completedInThisRun = true;
      await persistSyncCheckpoint(`backfill-completed-${id}`);
      // A second archive starts on the next hourly run, never in this one.
      break;
    }

    stats.incompleteSeriesStillMissing += 1;

    if (progressed) {
      state.archiveBackfillNoProgress[id] = 0;
      await persistSyncCheckpoint(`backfill-progress-${id}`);
      if (result?.retryLater || affiliateBudgetExhausted) break;
      // Keep spending the remaining budget on this exact same series.
      continue;
    }

    if (!noProgressRecorded && !affiliateBudgetExhausted) {
      state.archiveBackfillNoProgress[id] =
        nonNegativeInt(state.archiveBackfillNoProgress[id], 0) + 1;
      noProgressRecorded = true;
    }

    const noProgressRuns = nonNegativeInt(state.archiveBackfillNoProgress[id], 0);
    stats.backfillNoProgressRuns = Math.max(stats.backfillNoProgressRuns, noProgressRuns);
    if (!affiliateBudgetExhausted && noProgressRuns >= maxBackfillNoProgressRuns) {
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
      // Keep the active id locked. The next hourly BACKFILL retries this exact
      // series instead of advancing to a different archive with a visible gap.
      state.archiveBackfillSeriesId = id;
      state.archiveBackfillSeriesTitle = title;
    }

    await persistSyncCheckpoint(`backfill-paused-${id}`);
    break;
  }

  if (completedInThisRun) {
    console.log(`سریال «${title}» کامل و منتشر شد؛ سریال بعدی در اجرای ساعتی بعد شروع می‌شود.`);
  }
}

function seriesCompletenessAuditDue(item) {
  if (!item || item.type !== 'series') return false;
  if (item.isAiring === true && item.publicationStatus === 'published') return false;
  return nonNegativeInt(item.archiveCompletenessAuditVersion, 0) < SERIES_COMPLETENESS_AUDIT_VERSION;
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
        seriesHasUnavailableRetryDue(entry.item) ||
        seriesCompletenessAuditDue(entry.item) ||
        seriesMediaAuditDue(entry.item)
      );
    })
    .sort((a, b) => {
      const activeId = String(state.archiveBackfillSeriesId || '');
      const aActive = String(a.item?.id || '') === activeId;
      const bActive = String(b.item?.id || '') === activeId;
      if (aActive !== bActive) return aActive ? -1 : 1;

      // After an explicitly active series, always start with the oldest
      // production year. Once selected, that id remains locked across runs
      // until the archive is complete.
      const yearDiff = seriesBackfillYear(a.item) - seriesBackfillYear(b.item);
      if (yearDiff) return yearDiff;

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
  const previousId = String(state.archiveBackfillSeriesId || '');
  state.archiveBackfillSeriesId = '';
  state.archiveBackfillSeriesTitle = '';
  if (state.archiveBackfillItemType === 'series' && (!previousId || String(state.archiveBackfillItemId || '') === previousId)) {
    clearActiveArchiveItem('series', previousId);
  }
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

async function syncIranianIncompleteSeries() {
  const candidates = items
    .filter((item) =>
      item?.type === 'series' &&
      effectiveIranianIdentity(item) &&
      !item?.isDocumentary &&
      item?.contentKind !== 'documentary' &&
      item?.publicationStatus !== 'published' &&
      seriesArchiveDeficit(item).total > 0 &&
      (
        catalogHasDownload(item) ||
        catalogHasPublicPlayback(item)
      ),
    )
    .sort((a, b) => {
      const deficit = seriesArchiveDeficit(a).total - seriesArchiveDeficit(b).total;
      if (deficit) return deficit;
      return String(a?.updatedAt || '').localeCompare(String(b?.updatedAt || ''));
    });

  let completed = 0;
  for (const candidate of candidates) {
    if (
      completed >= 2 ||
      affiliateBudgetExhausted ||
      affiliateScopeExhausted ||
      runTimeBudgetReached('iranian-incomplete-series', 65000)
    ) break;

    const id = String(candidate.id || '');
    const before = seriesArchiveDeficit(candidate);
    const remainingBudget = Math.max(0, maxAffiliateRequests - affiliateRequestsUsed);
    if (!id || remainingBudget <= 1) break;

    let result;
    try {
      result = await processSeries(
        { id, type: 'series' },
        'fast-backfill',
        {
          episodeStrategy: 'latest',
          episodeLimit: Math.max(1, Math.min(
            priorityEpisodesPerSeries,
            120,
            remainingBudget - 1,
          )),
          onlyMissing: true,
          requireIranian: true,
        },
      );
    } catch (error) {
      rememberError('iranian-incomplete-' + id, error);
      continue;
    }

    const refreshed = items.find((item) =>
      item?.type === 'series' && String(item.id) === id,
    );
    const after = seriesArchiveDeficit(refreshed);
    const published = Boolean(
      refreshed?.archiveComplete === true &&
      refreshed?.publicationStatus === 'published' &&
      after.total === 0
    );

    rememberDiagnostic('iranianSeriesDiagnostics', {
      id,
      title: refreshed?.nameFa || refreshed?.name || candidate?.nameFa || candidate?.name || id,
      result: published ? 'published-existing' : after.total < before.total ? 'advanced-existing' : 'no-progress-existing',
      reason: result?.reason || '',
      addedEpisodes: Number(result?.addedEpisodes || 0),
      remainingEpisodeCount: after.total,
      retryLater: Boolean(result?.retryLater),
      newlyPublished: published,
      discovery: 'existing-incomplete-first',
    });

    if (published) {
      completed += 1;
      await persistSyncCheckpoint('iranian-existing-published-' + id);
      continue;
    }

    if (after.total < before.total || Number(result?.addedEpisodes || 0) > 0) {
      await persistSyncCheckpoint('iranian-existing-progress-' + id);
      // Keep the remaining hourly budget on this exact archive next run rather
      // than spreading one episode across several different series.
      break;
    }
  }

  return completed;
}

async function syncIranianSeriesArchive() {
  // This lane discovers one genuinely NEW Iranian series at a time. Existing
  // titles are skipped in the same invocation instead of wasting an hourly run.
  const maxNoProgress = 2;
  let pagesVisited = 0;
  const seenPages = new Set();

  const suppressed = (candidate, sourceId) => {
    const identity = normalizeIdentityName(String(candidate?.name_fa || candidate?.nameFa || '') + ' ' + String(candidate?.name || ''));
    return sourceId === 'f72e7850-344c-11f1-9db2-59adfc143adb' ||
      identity.includes('peopleofiran') || identity.includes('اهلایران') ||
      identity.includes('thewesties') || identity.includes('وستیها');
  };

  const advanceCursor = (page, payload, candidates, nextOffset) => {
    state.iranianSeriesActiveId = '';
    state.iranianSeriesOffset = nextOffset;
    if (nextOffset >= candidates.length) {
      state.iranianSeriesPage = nextPage(page, payload.lastPage);
      state.iranianSeriesOffset = 0;
      stats.iranianSeriesPagesProcessed += 1;
      pagesVisited += 1;
    }
  };

  while (
    !affiliateBudgetExhausted &&
    !affiliateScopeExhausted &&
    pagesVisited < Math.max(1, iranianSeriesPagesPerRun) &&
    !runTimeBudgetReached('iranian-series-discovery', 65000)
  ) {
    const page = positiveInt(state.iranianSeriesPage, 1);
    if (seenPages.has(page)) break;
    seenPages.add(page);

    let payload;
    try {
      payload = await fetchIranianSeriesPage(page);
    } catch (error) {
      rememberError('iranian-series-page-' + page, error);
      break;
    }

    const candidates = dedupeCandidates(payload.items)
      .sort((a, b) => Number(inferIranian(b)) - Number(inferIranian(a)));
    if (!candidates.length) {
      state.iranianSeriesPage = nextPage(page, payload.lastPage);
      state.iranianSeriesOffset = 0;
      state.iranianSeriesActiveId = '';
      stats.iranianSeriesPagesProcessed += 1;
      pagesVisited += 1;
      continue;
    }

    let offset = nonNegativeInt(state.iranianSeriesOffset, 0);
    if (offset >= candidates.length) offset = 0;
    const lockedId = cleanText(state.iranianSeriesActiveId || '');
    if (lockedId) {
      const lockedIndex = candidates.findIndex((entry) =>
        String(baseCatalogId(entry) || entry?.t_id || entry?.series_id || '') === lockedId,
      );
      if (lockedIndex >= 0) offset = lockedIndex;
      else state.iranianSeriesActiveId = '';
    }

    let pageAdvanced = false;
    while (
      offset < candidates.length &&
      !affiliateBudgetExhausted &&
      !affiliateScopeExhausted &&
      !runTimeBudgetReached('iranian-series-candidate', 60000)
    ) {
      const candidate = candidates[offset];
      const sourceId = String(baseCatalogId(candidate) || candidate?.t_id || candidate?.series_id || '');
      const progressKey = sourceId || ('p' + page + '-o' + offset);

      if (suppressed(candidate, sourceId) || !inferIranian(candidate)) {
        delete state.iranianSeriesNoProgress[progressKey];
        advanceCursor(page, payload, candidates, offset + 1);
        offset = nonNegativeInt(state.iranianSeriesOffset, 0);
        if (state.iranianSeriesPage !== page) { pageAdvanced = true; break; }
        continue;
      }

      const existing = findExistingItem(candidate, 'series');
      const isLocked = Boolean(state.iranianSeriesActiveId && state.iranianSeriesActiveId === sourceId);
      if (existing && !isLocked) {
        delete state.iranianSeriesNoProgress[progressKey];
        advanceCursor(page, payload, candidates, offset + 1);
        offset = nonNegativeInt(state.iranianSeriesOffset, 0);
        if (state.iranianSeriesPage !== page) { pageAdvanced = true; break; }
        continue;
      }

      if (!state.iranianSeriesActiveId && sourceId) state.iranianSeriesActiveId = sourceId;
      stats.iranianSeriesCandidates += 1;

      let result;
      try {
        result = await processSeries(candidate, 'iranian-priority', {
          requireIranian: true,
          episodeStrategy: 'latest',
          episodeLimit: Math.min(120, Math.max(1, priorityEpisodesPerSeries)),
          onlyMissing: true,
        });
      } catch (error) {
        rememberError('iranian-series-' + progressKey, error);
        result = { added: false, reason: 'request-error', retryLater: false };
      }

      const refreshed = items.find((item) =>
        item?.type === 'series' &&
        (String(baseCatalogId(item)) === sourceId || String(item.id || '') === sourceId)
      );
      const belongsToIranianSeries = Boolean(
        refreshed &&
        classifyCatalogRules({ ...refreshed, categoryKeys: [], categoryLabels: [] }).categoryKeys.includes('iranian-series')
      );
      const publishedNow = Boolean(
        belongsToIranianSeries &&
        refreshed?.archiveComplete === true &&
        refreshed?.publicationStatus === 'published' &&
        Number(result?.remainingEpisodeCount || 0) === 0
      );

      rememberDiagnostic('iranianSeriesDiagnostics', {
        id: sourceId,
        title: cleanText(candidate?.name_fa || candidate?.name || refreshed?.nameFa || refreshed?.name || ''),
        result: publishedNow ? 'published-new' : result?.added ? 'advanced-new' : 'rejected',
        reason: result?.reason || '',
        addedEpisodes: Number(result?.addedEpisodes || 0),
        remainingEpisodeCount: Number(result?.remainingEpisodeCount || 0),
        retryLater: Boolean(result?.retryLater),
        newlyPublished: publishedNow,
        discovery: 'new-only-country-IR',
      });

      if (publishedNow) {
        delete state.iranianSeriesNoProgress[progressKey];
        advanceCursor(page, payload, candidates, offset + 1);
        await persistSyncCheckpoint('iranian-published-new-' + progressKey);
        return true;
      }

      const progressed = Boolean(
        belongsToIranianSeries &&
        (Number(result?.addedEpisodes || 0) > 0 || (result?.added && refreshed?.publicationStatus === 'building-archive'))
      );
      if (progressed || result?.retryLater) {
        state.iranianSeriesNoProgress[progressKey] = 0;
        await persistSyncCheckpoint('iranian-progress-new-' + progressKey);
        return false;
      }

      const attempts = nonNegativeInt(state.iranianSeriesNoProgress[progressKey], 0) + 1;
      state.iranianSeriesNoProgress[progressKey] = attempts;
      const terminal = !belongsToIranianSeries || ['not-iranian', 'no-usable-links', 'missing-detail'].includes(String(result?.reason || ''));
      if (terminal || attempts >= maxNoProgress) {
        if (refreshed && belongsToIranianSeries && refreshed.publicationStatus !== 'published') {
          replaceItem({
            ...refreshed,
            archiveComplete: false,
            publicationStatus: 'building-archive',
            visibilityLocked: false,
            archiveAuditStatus: 'blocked',
            archiveBlockedReason: result?.reason || 'iranian-discovery-no-progress',
            archiveBlockedAttempts: attempts,
            archiveBlockedAt: new Date().toISOString(),
          });
        }
        state.iranianSeriesActiveId = '';
        advanceCursor(page, payload, candidates, offset + 1);
        offset = nonNegativeInt(state.iranianSeriesOffset, 0);
        if (state.iranianSeriesPage !== page) { pageAdvanced = true; break; }
        continue;
      }

      await persistSyncCheckpoint('iranian-no-progress-new-' + progressKey);
      return false;
    }

    if (pageAdvanced) continue;
    if (offset >= candidates.length) {
      state.iranianSeriesPage = nextPage(page, payload.lastPage);
      state.iranianSeriesOffset = 0;
      state.iranianSeriesActiveId = '';
      stats.iranianSeriesPagesProcessed += 1;
      pagesVisited += 1;
    }
  }

  return false;
}
async function syncOperatorPriorityDiscovery() {
  // These scopes are deliberately independent from the year-by-year archive
  // queue. Each run advances its own page/offset cursor, so even a very large
  // historical backlog cannot freeze «ویژه همراه» at zero forever.
  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-operator-movies', 100000)) {
    await withAffiliateRequestScope(
      'operator-movies',
      operatorMovieRequestQuota,
      syncOperatorMovieArchive,
    );
  }

  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-operator-series', 90000)) {
    await withAffiliateRequestScope(
      'operator-series',
      operatorSeriesRequestQuota,
      syncOperatorSeriesArchive,
    );
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
          requirePortalStream: true,
          panelCandidate: Boolean(panelToken),
          operatorProbe: !panelToken,
          episodeLimit: panelToken ? priorityEpisodesPerSeries : operatorProbeEpisodesPerSeries,
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

      // Operator discovery has an independent request scope. An archive queue
      // must not stop it after the first title; continue until this lane's own
      // title/request budget is reached.
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
          requirePortalStream: true,
          panelCandidate: Boolean(panelToken),
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
  const id = baseCatalogId(candidate) || candidate?.t_id;

  if (!id) {
    return { retryLater: false, added: false, reason: 'missing-id' };
  }

  let movie = candidate;

  if (!hasBasicMetadata(movie) || options.panelCandidate === true || !Object.prototype.hasOwnProperty.call(movie, 'dubbed')) {
    try {
      const detail = await fetchMovieDetail(id);
      movie = detail ? { ...candidate, ...detail, id } : movie;
    } catch (error) {
      // Upera owner-panel IDs are not always valid Seeko public IDs.
      // Keep the authenticated panel metadata and continue to show_links.
      if (options.panelCandidate !== true) throw error;
      rememberError(`panel-movie-detail-${id}`, error);
    }
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

  const media = parseMediaLinks(linkResult.links, providerPrimaryMediaLanguage(movie));

  if (options.requireOperator && !media.operatorFiles.length) {
    stats.operatorMoviesRejectedNoOperatorLink += 1;
    return { retryLater: false, added: false, reason: 'no-operator-link' };
  }

  if (options.requirePortalStream && !media.portalFiles.length) {
    return { retryLater: false, added: false, reason: 'no-panel-player-link' };
  }

  if (!media.downloads.length && !media.streamUrl) {
    console.log(
      `فیلم ${id} لینک رایگان مستقیم یا ویژه اینترنت همراه نداشت؛ مورد قبلی حذف نشد.`,
    );

    return { retryLater: false, added: false, reason: 'no-usable-links' };
  }

  const existing = options.panelCandidate === true
    ? findExistingPanelTitle(movie, 'movie')
    : findExistingItem(movie, 'movie');
  if (
    options.panelCandidate === true &&
    media.operatorFiles.length === 0 &&
    media.publicPortalFiles.length > 0 &&
    existing &&
    catalogHasDownload(existing) &&
    catalogHasPublicPlayback(existing)
  ) {
    return { retryLater: false, added: false, reason: 'existing-public-title-already-complete' };
  }
  // The affiliate response is a complete language/media snapshot. During a
  // language audit, replace stale ordinary sections instead of merging them;
  // merging kept an old unlabeled URL beside its dubbed copy and the mobile
  // client then had no reliable way to choose the correct language.
  const freshHasUsableOrdinaryMedia = Boolean(
    media?.streamUrl ||
    (Array.isArray(media?.downloads) && media.downloads.some((section) =>
      (Array.isArray(section?.files) ? section.files : []).some((file) =>
        file?.mode === 'download' || file?.mode === 'play' || !file?.mode,
      ),
    ))
  );
  const mergedMedia = options.replaceMedia === true && freshHasUsableOrdinaryMedia
    ? media
    : mergeMovieMedia(existing, media);
  const normalized = normalizeMovie(movie, mergedMedia, source, existing);
  // fetchAffiliateLinks() returns the complete movie affiliate payload, so a
  // successful parse is already a full media-language audit. Mark it now; new
  // titles should not immediately re-enter the repair queue just to discover
  // the same dubbed/subtitle variants again.
  normalized.mediaLanguageAuditVersion = MEDIA_LANGUAGE_AUDIT_VERSION;
  normalized.mediaAuditStatus = 'ok';
  normalized.mediaAuditCheckedAt = new Date().toISOString();

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

function selectOperatorProbeEpisodes(episodes, limit) {
  const sorted = [...(Array.isArray(episodes) ? episodes : [])].sort(compareEpisodes);
  const max = Math.max(1, positiveInt(limit, operatorProbeEpisodesPerSeries));
  if (sorted.length <= max) return sorted;

  const selected = [];
  const seen = new Set();
  const addAt = (index) => {
    const episode = sorted[Math.max(0, Math.min(sorted.length - 1, index))];
    if (!episode) return;
    const key = cleanText(episode.id || `${episodeSeasonNumber(episode)}:${episodeNumberValue(episode)}`);
    if (!key || seen.has(key)) return;
    seen.add(key);
    selected.push(episode);
  };

  // Most operator feeds expose the newest episode reliably, while first and
  // middle probes catch older or season-specific operator availability.
  addAt(sorted.length - 1);
  addAt(0);
  addAt(Math.floor((sorted.length - 1) / 2));

  // Fill any remaining probe slots evenly across the whole run of episodes.
  for (let slot = 1; selected.length < max && slot < max * 3; slot += 1) {
    addAt(Math.round(((sorted.length - 1) * slot) / Math.max(1, max - 1)));
  }

  return selected.slice(0, max);
}

async function processSeries(
  candidate,
  source,
  options = {},
) {
  const id =
    baseCatalogId(candidate) ||
    candidate?.t_id ||
    candidate?.series_id;

  if (!id) {
    return { retryLater: false, completeBackfill: true, added: false, reason: 'missing-id' };
  }

  let detail;
  try {
    detail = await fetchSeriesDetail(id);
  } catch (error) {
    if (options.panelCandidate !== true) throw error;
    // Owner-panel series IDs can be absent from Seeko. Fall back to the
    // authenticated panel row instead of rejecting a valid operator title.
    rememberError(`panel-series-detail-${id}`, error);
    detail = {
      series: { ...candidate, id, type: 'series' },
      episodes: [],
      episodeDiscoveryComplete: true,
      episodePaginationPagesFetched: 0,
      episodePaginationErrors: 0,
    };
  }
  if (options.panelCandidate === true) {
    try {
      const panelEpisodes = await fetchPanelSeriesEpisodes(id);
      // The owner panel is the authoritative episode list for panel IDs.
      detail.episodes = panelEpisodes;
      detail.episodeDiscoveryComplete = true;
      detail.episodePaginationErrors = 0;
    } catch (error) {
      detail.episodeDiscoveryComplete = false;
      detail.episodePaginationErrors = Math.max(1, Number(detail.episodePaginationErrors || 0));
      rememberError(`panel-series-episodes-${id}`, error);
    }
  }
  // The page row can carry a newer updated_at than the detail endpoint.
  // Preserve the newest source timestamp so a completed title is not mistaken
  // for fresh work on every Iranian-lane pass.
  const series = detail.series
    ? {
        ...detail.series,
        updated_at: maxDate(
          detail.series?.updated_at,
          detail.series?.updatedAt,
          candidate?.updated_at,
          candidate?.updatedAt,
          candidate?.created_at,
          candidate?.createdAt,
        ),
      }
    : null;
  const episodeDiscoveryComplete = detail.episodeDiscoveryComplete !== false;

  if (!series) {
    return { retryLater: false, completeBackfill: true, added: false, reason: 'missing-detail' };
  }

  const iranian = inferIranian(series);
  if (options.requireIranian && !iranian) {
    stats.iranianSeriesRejectedNotIranian += 1;
    return { retryLater: false, completeBackfill: true, added: false, reason: 'not-iranian' };
  }

  const episodeBelongsToRequestedSeries = (episode) => {
    const ownerIds = uniqueStrings([
      episode?.series_id,
      episode?.seriesId,
      episode?.parent_series_id,
      episode?.parentSeriesId,
      episode?.series?.id,
    ].map((value) => cleanText(value)).filter(Boolean));
    // Some valid legacy episode rows omit the parent id. Keep those, but when
    // the API supplies ownership metadata it must match the requested series.
    return ownerIds.length === 0 || ownerIds.includes(String(id));
  };

  const episodes = detail.episodes
    .filter(
      (episode) =>
        episode &&
        episode.id &&
        Number(episode.show ?? 1) !== 0 &&
        episodeBelongsToRequestedSeries(episode) &&
        // Some legacy series payloads contain unrelated/promotional rows with
        // an id but no episode coordinate. They cannot be rendered or matched
        // to a catalog episode and must not keep an otherwise complete archive
        // permanently pending.
        episodeNumberValue(episode) > 0,
    )
    .sort(compareEpisodes);

  // Source payloads can expose several ids for the same season/episode. Keep
  // every id in `episodes` so affiliate fallbacks are all attempted, but count
  // each coordinate only once when deciding whether the archive is complete.
  const episodesByCoordinate = [];
  const seenEpisodeCoordinates = new Set();
  for (const episode of episodes) {
    const coordinate = archiveEpisodeCoordinateKey(episode);
    if (seenEpisodeCoordinates.has(coordinate)) continue;
    seenEpisodeCoordinates.add(coordinate);
    episodesByCoordinate.push(episode);
  }

  const existing = options.panelCandidate === true
    ? findExistingPanelTitle(series, 'series')
    : findExistingItem(series, 'series');
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
    .filter((episode) => { const group = findEpisodeGroup(previousGroups, episode); return !group || !episodeGroupHasUsableMedia(group); })
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
  } else if (options.panelCandidate === true) {
    const limit = positiveInt(options.episodeLimit, priorityEpisodesPerSeries);
    const savedCursor = nonNegativeInt(state.seriesEpisodeCursor[id], 0);
    cursor = savedCursor < episodes.length ? savedCursor : 0;
    selectedEpisodes = episodes.slice(cursor, cursor + limit);
  } else if (options.operatorProbe === true) {
    selectedEpisodes = selectOperatorProbeEpisodes(
      episodes,
      positiveInt(options.episodeLimit, operatorProbeEpisodesPerSeries),
    );
  } else if (options.refreshAllMedia === true) {
    const limit = positiveInt(options.episodeLimit, priorityEpisodesPerSeries);
    const savedCursor = nonNegativeInt(state.seriesLanguageAuditCursor[id], 0);
    cursor = savedCursor < episodes.length ? savedCursor : 0;
    selectedEpisodes = episodes.slice(cursor, cursor + limit);
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
  // Backfilling a historical gap is not a user-visible "update". Only an
  // episode beyond the archive tail that existed before this run may move a
  // published series to the front of updated/new shelves.
  let latestForwardEpisode = null;
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

      const media = parseMediaLinks(linkResult.links, providerPrimaryMediaLanguage(series));
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


      if (options.requirePortalStream && !media.portalFiles.length) {
        rejectedEpisodes.push({
          id: String(episode.id),
          seasonNumber: episodeSeasonNumber(episode),
          episodeNumber: episodeNumberValue(episode),
          reason: 'no-panel-player-link',
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
      if (
        options.panelCandidate === true &&
        media.operatorFiles.length === 0 &&
        media.publicPortalFiles.length > 0 &&
        previousGroup &&
        catalogHasDownload({ downloads: [previousGroup] }) &&
        catalogHasPublicPlayback({ downloads: [previousGroup] })
      ) {
        continue;
      }
      const nextGroup = episodeGroup(episode, media, series);
      if (options.refreshAllMedia === true && previousGroup) {
        const preservedVerifiedPortalFiles = (Array.isArray(previousGroup.files) ? previousGroup.files : [])
          .filter((file) => isValidStoredOperatorFile(file) || isValidStoredPublicPortalFile(file));
        nextGroup.files = dedupeMediaFiles([
          ...(Array.isArray(nextGroup.files) ? nextGroup.files : []),
          ...preservedVerifiedPortalFiles,
        ]);
        const previousIndex = mergedGroups.indexOf(previousGroup);
        if (previousIndex >= 0) mergedGroups.splice(previousIndex, 1);
      }
      upsertEpisodeGroup(mergedGroups, nextGroup);

      if (!previousGroup) {
        addedEpisodes += 1;
        stats.episodeGroupsAdded += 1;
        latestAddedEpisode = episode;
        if (isEpisodeAfterPublishedTail(episode, previousGroups)) {
          latestForwardEpisode = episode;
        }
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

  // A newly published episode must not wait behind the historical artwork
  // backlog. Capture its exact frame in the same sync run whenever ffmpeg is
  // available; the PEOPLE lane will retry it if this bounded attempt fails.
  if (latestForwardEpisode) {
    const latestForwardGroup = findEpisodeGroup(mergedGroups, latestForwardEpisode);
    if (latestForwardGroup) {
      await generateEpisodeFrameArtwork({ id }, latestForwardGroup);
    }
  }

  let completeBackfill = true;
  let mediaLanguageAuditComplete = !options.refreshAllMedia;
  if (options.refreshAllMedia === true) {
    const nextCursor = cursor + processedEpisodes;
    mediaLanguageAuditComplete = !stoppedByBudget && nextCursor >= episodes.length;
    state.seriesLanguageAuditCursor[id] = mediaLanguageAuditComplete ? 0 : nextCursor;
  } else if (source === 'backfill' || options.panelCandidate === true) {
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

  const isAiring = inferSeriesAiring(series, existing);
  const isMeaningfulEpisodeUpdate = Boolean(addedEpisodes > 0 && latestForwardEpisode && existing);
  const isPublishedAiringEpisodeUpdate = Boolean(
    isMeaningfulEpisodeUpdate &&
    existing?.publicationStatus === 'published' &&
    isAiring &&
    (source === 'airing-refresh' || source === 'incremental'),
  );

  let updateLabel = existing?.updateLabel || '';

  if (isMeaningfulEpisodeUpdate && latestForwardEpisode) {
    const episodeNumber = episodeNumberValue(latestForwardEpisode);
    updateLabel = `قسمت ${toPersianDigits(episodeNumber)} اضافه شد`;
  } else if (updateLabel === 'بروزرسانی شد') {
    // A metadata/media refresh without a genuinely newer episode is not an
    // update badge and must not pin this title at the front.
    updateLabel = '';
  }

  // Every source episode without a matching usable group stays in the archive
  // deficit, even after repeated failures. This is what keeps the backfill queue
  // on the same series instead of silently publishing a gapped archive.
  const remainingSourceEpisodes = episodesByCoordinate.filter(
    (episode) => { const group = findEpisodeGroup(mergedGroups, episode); return !group || !episodeGroupHasUsableMedia(group); },
  );
  const archiveComplete =
    episodeDiscoveryComplete &&
    episodesByCoordinate.length > 0 &&
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
  const keepPreviouslyVisible = Boolean(
    !iranian &&
    existing?.visibilityLocked &&
    mergedGroups.some(episodeGroupHasUsableMedia),
  );
  const publicationStatus =
    archiveComplete || keepPublishedWhileAiring || keepPreviouslyVisible
      ? 'published'
      : 'building-archive';
  const publishedAt = publicationStatus === 'published'
    ? (existing?.publishedAt || (existing?.publicationStatus !== 'published'
        ? new Date().toISOString()
        : existing?.firstSeenAt))
    : existing?.publishedAt;

  if (publicationStatus === 'building-archive') {
    stats.seriesHiddenUntilComplete += 1;
  } else if (existing?.publicationStatus !== 'published') {
    stats.seriesPublishedAfterCompletion += 1;
  }
  if (keepPublishedWhileAiring && !archiveComplete) {
    stats.airingSeriesKeptPublished += 1;
  }
  if (keepPreviouslyVisible && !archiveComplete) {
    stats.seriesKeptVisibleDuringBackfill += 1;
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
      publishedAt,
      sourceEpisodeCount: episodesByCoordinate.length,
      pendingEpisodes: remainingSourceEpisodes,
      unavailableEpisodes: [...unavailableEpisodeMap.values()],
      episodeDiscoveryComplete,
      episodePaginationPagesFetched: detail.episodePaginationPagesFetched || 0,
      episodePaginationErrors: detail.episodePaginationErrors || 0,
      meaningfulUpdatedAt: isMeaningfulEpisodeUpdate
        ? new Date().toISOString()
        : existing?.meaningfulUpdatedAt,
      mediaLanguageAuditComplete,
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
    sourceEpisodeCount: episodesByCoordinate.length,
    episodeDiscoveryComplete,
    newlyPublished: Boolean(
      publicationStatus === 'published' &&
      existing?.publicationStatus !== 'published' &&
      !existing?.visibilityLocked
    ),
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
  // Verified against Seeko on 2026-08-31: country=IR is the actual Iranian
  // archive selector. persian=1 returns the generic media-language feed.
  const variants = [
    { free: 1, persian: '', country: 'IR', traffic: 1, noFreeFallback: true },
    { free: '', persian: '', country: 'IR', traffic: 1, noFreeFallback: true },
  ];
  const results = [];
  for (const filters of variants) {
    try {
      results.push(await fetchScopedArchivePage('series', page, filters));
    } catch (error) {
      rememberError('iranian-series-filter-' + page + '-' + JSON.stringify(filters), error);
    }
  }
  return {
    items: dedupeCandidates(results.flatMap((result) => result.items || [])),
    lastPage: Math.max(1, ...results.map((result) => Number(result.lastPage || 1))),
  };
}
async function fetchOperatorSeriesPage(page) {
  if (panelToken) return fetchPanelFilimoPage('series', page);
  return fetchScopedArchivePage('series', page, {
    free: '',
    persian: '',
    traffic: 1,
  });
}

async function fetchOperatorMoviePage(page) {
  if (panelToken) return fetchPanelFilimoPage('movies', page);
  return fetchScopedArchivePage('movies', page, {
    free: '',
    persian: '',
    traffic: 1,
  });
}

function panelAuthorizationValue() {
  return /^Bearer\s+/i.test(panelToken) ? panelToken : `Bearer ${panelToken}`;
}

async function fetchPanelJson(input, options = {}) {
  if (!panelToken) throw new Error('UPERA_PANEL_TOKEN تنظیم نشده است.');
  return fetchJson(input, {
    ...options,
    headers: {
      Authorization: panelAuthorizationValue(),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function fetchPanelFilimoPage(kind, page) {
  const endpoint = kind === 'movies' ? 'movies' : 'series';
  const json = await fetchPanelJson(`${PANEL_API_BASE}/owner/get/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify({
      query: '',
      ir: -1,
      sale_method: 3,
      payment_method: 0,
      specific_id: null,
      nodata: 1,
      owner: FILIMO_OWNER_ID,
      page: positiveInt(page, 1),
    }),
  });
  return pagedResult(json, endpoint);
}

async function fetchPanelSeriesEpisodes(seriesId) {
  const episodes = [];
  let page = 1;
  let lastPage = 1;
  do {
    const url = new URL(`${PANEL_API_BASE}/owner/get/series/season/${encodeURIComponent(seriesId)}`);
    url.searchParams.set('page', String(page));
    const json = await fetchPanelJson(url, { method: 'POST' });
    const result = pagedResult(json, 'season');
    episodes.push(...result.items);
    lastPage = Math.min(maxEpisodePaginationPages, positiveInt(result.lastPage, 1));
    page += 1;
  } while (page <= lastPage && !runTimeBudgetReached('panel-series-episodes', 50000));
  return dedupeEpisodes(episodes).sort(compareEpisodes);
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

function affiliateUrlFromRecord(record) {
  if (!record || typeof record !== 'object') return '';
  for (const key of AFFILIATE_URL_KEYS) {
    const value = cleanText(record[key]);
    if (isHttp(value)) return value;
  }
  return '';
}

function extractAffiliateLinkRecords(value, hints = [], output = []) {
  if (Array.isArray(value)) {
    for (const entry of value) extractAffiliateLinkRecords(entry, hints, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;

  const directUrl = affiliateUrlFromRecord(value);
  if (directUrl) {
    output.push({
      ...value,
      link: directUrl,
      _group_hint: uniqueStrings([cleanText(value._group_hint), ...hints]).join(' '),
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (AFFILIATE_URL_KEYS.includes(key)) continue;
    if (!child || typeof child !== 'object') continue;
    extractAffiliateLinkRecords(child, [...hints, key], output);
  }
  return output;
}

function panelTrafficFlag(value, fallback = null) {
  if (!value || typeof value !== 'object') return fallback;
  for (const key of ['traffic_oo', 'trafficOo', 'trafficOO']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const number = Number(value[key]);
      if (number === 0 || number === 1) return number;
    }
  }
  return fallback;
}

function findPanelTrafficFlag(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return null;
  const direct = panelTrafficFlag(value, null);
  if (direct === 0 || direct === 1) return direct;
  for (const child of Object.values(value)) {
    if (!child || typeof child !== 'object') continue;
    const found = findPanelTrafficFlag(child, depth + 1);
    if (found === 0 || found === 1) return found;
  }
  return null;
}

async function fetchPanelShowLinks(id, type) {
  if (!panelToken || !['movie', 'episode'].includes(String(type))) return [];
  const json = await fetchPanelJson(
    `${PANEL_API_BASE}/owner/show_links/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
  );
  const data = json?.data ?? json ?? {};
  const rootTraffic = findPanelTrafficFlag(data);
  const records = extractAffiliateLinkRecords(data);

  const verified = records.map((link) => {
    const traffic = panelTrafficFlag(link, rootTraffic);
    return {
      ...link,
      _panel_verified: true,
      ...(traffic === 0 || traffic === 1 ? { _traffic_oo: traffic } : {}),
    };
  }).filter((link) => Number(link._traffic_oo) === 0 || Number(link._traffic_oo) === 1);

  // Never manufacture a player URL from traffic_oo alone. show_links can
  // return only paid upera.shop acquisition links with traffic_oo=0/1. A title
  // is playable only when the authenticated panel response itself contains an
  // exact player/stream URL. This prevents purchase pages from masquerading as
  // online playback in Aparatchi.
  return uniqueByUrl(verified);
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

  let panelLinks = [];
  try {
    panelLinks = await fetchPanelShowLinks(id, type);
  } catch (error) {
    rememberError(`panel-show-links-${type}-${id}`, error);
  }

  try {
    const json = await fetchJson(
      url,
      { method: 'POST' },
    );

    const rawLinks =
      json?.data?.links ??
      json?.links ??
      json?.data ??
      [];
    const publicLinks = extractAffiliateLinkRecords(rawLinks);
    const result = {
      // Upera has returned both flat arrays and grouped objects (for example
      // dubbed/subtitle buckets) across deployments. Flatten every link-like
      // record while preserving the parent group names as language hints.
      links: uniqueByUrl([
        ...publicLinks.filter((link) => !operatorPortalDetails(link?.link)),
        ...panelLinks,
        ...publicLinks.filter((link) => operatorPortalDetails(link?.link)),
      ]),
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
        links: uniqueByUrl(panelLinks),
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

function mediaBooleanHint(value) {
  if (value === true || value === 1) return true;
  const text = cleanText(value).toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on', 'dubbed', 'subtitle', 'persian', 'farsi', 'fa', 'fas', 'per'].includes(text);
}

function normalizedMediaAmount(value) {
  if (value === undefined || value === null || value === '' || value === false) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = normalizeNumericText(value)
    .replace(/[٬,،]/g, '')
    .replace(/[^\d.+-]+/g, ' ')
    .trim();
  if (!normalized) return null;
  const match = normalized.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function mediaPriceTier(link) {
  if (!link || typeof link !== 'object') return 'unknown';

  const freeFlag = [
    link.free, link.is_free, link.isFree, link.free_download, link.freeDownload,
  ].some((value) =>
    value === true ||
    value === 1 ||
    String(value ?? '').trim().toLowerCase() === 'true' ||
    String(value ?? '').trim() === '1',
  );
  if (freeFlag) return 'free';

  const paidFlag = [
    link.paid, link.is_paid, link.isPaid, link.purchase_required, link.purchaseRequired,
  ].some((value) =>
    value === true ||
    value === 1 ||
    String(value ?? '').trim().toLowerCase() === 'true' ||
    String(value ?? '').trim() === '1',
  );
  if (paidFlag) return 'paid';

  const amountCandidates = [
    link.amount, link.price, link.cost, link.fee, link.pay_amount, link.payAmount,
  ];
  for (const candidate of amountCandidates) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    const amount = normalizedMediaAmount(candidate);
    if (amount !== null) return amount > 0 ? 'paid' : 'free';
  }

  const text = mediaLinkDescriptor(link).toLowerCase();
  if (/رایگان|مجانی|بدون\s*هزینه|\bfree\b/i.test(text)) return 'free';
  if (/خرید|پرداخت|اشتراک|\bpaid\b|\bpurchase\b|\bbuy\b/i.test(text)) return 'paid';

  // Historically the affiliate endpoint omitted `amount` for free direct
  // media. Keeping an otherwise valid media record is safer than silently
  // dropping it, which is what caused many dubbed/original links to vanish.
  return isDirectMediaUrl(link.link) ? 'free' : 'unknown';
}

function mediaLinkDescriptor(link) {
  if (!link || typeof link !== 'object') return cleanText(link || '');
  const booleanHints = [
    mediaBooleanHint(link.dubbed) || mediaBooleanHint(link.is_dubbed) || mediaBooleanHint(link.isDubbed) || mediaBooleanHint(link.dub) ? 'dubbed' : '',
    mediaBooleanHint(link.subtitle) || mediaBooleanHint(link.has_subtitle) || mediaBooleanHint(link.hasSubtitle) || mediaBooleanHint(link.subtitled) ? 'subtitle' : '',
  ];
  return [
    link._group_hint,
    link.title, link.name, link.label, link.language, link.lang,
    link.audio, link.audio_language, link.audioLanguage, link.audio_lang, link.audioLang,
    link.subtitle_language, link.subtitleLanguage, link.subtitle_lang, link.subtitleLang,
    link.voice, link.voice_language, link.voiceLanguage,
    link.type, link.kind, link.format, link.mime, link.mime_type, link.description,
    link.amount, link.price, link.cost, link.fee,
    ...booleanHints,
  ].map((value) => cleanText(value || '')).filter(Boolean).join(' ');
}

function isPersianLanguageValue(value) {
  const text = cleanText(value).toLowerCase().replace(/[_-]+/g, ' ');
  return /^(?:fa|fas|per|persian|farsi|فارسی|فارسي)$/.test(text);
}

function mediaLanguageTagForLink(link) {
  const descriptor = mediaLinkDescriptor(link);
  const detected = mediaLanguageTag(descriptor);
  if (detected) return detected;

  const subtitleValues = [
    link?.subtitle_language, link?.subtitleLanguage, link?.subtitle_lang, link?.subtitleLang,
    link?.sub_language, link?.subLanguage,
  ];
  if (subtitleValues.some(isPersianLanguageValue)) return 'subtitled';

  const audioValues = [
    link?.audio, link?.audio_language, link?.audioLanguage, link?.audio_lang, link?.audioLang,
    link?.voice, link?.voice_language, link?.voiceLanguage, link?.voice_lang, link?.voiceLang,
  ];
  if (audioValues.some(isPersianLanguageValue)) return 'dubbed';

  // Some affiliate payloads expose only a generic language field inside a
  // dubbed/audio group. Preserve that structured parent hint too.
  const genericLanguage = link?.language ?? link?.lang;
  const groupText = cleanText(link?._group_hint).toLowerCase();
  if (
    isPersianLanguageValue(genericLanguage) &&
    /dub|audio|voice|دوبله|صوت|صدا/i.test(groupText)
  ) {
    return 'dubbed';
  }

  return '';
}

function mediaLanguageLabel(tag) {
  if (tag === 'dubbed') return 'دوبله فارسی';
  if (tag === 'subtitled') return 'زیرنویس فارسی';
  return 'لینک‌های دریافت';
}

function reconcileUperaLanguageLinks(links) {
  const list = Array.isArray(links) ? links : [];
  const ordinary = list.filter((link) => !operatorPortalDetails(link?.link));
  const explicit = new Set(ordinary.map((link) => link?._media_language_tag).filter(Boolean));
  const unknown = ordinary.filter((link) => !link?._media_language_tag);

  if (!unknown.length) return list;
  if (explicit.has('dubbed') && explicit.has('subtitled')) {
    // Provider has both real variants; a third unlabeled row is stale/duplicate,
    // never a fictional "original" version.
    for (const link of unknown) link._drop_ambiguous_language = true;
    return list;
  }

  if (explicit.size === 1) {
    for (const link of unknown) link._drop_ambiguous_language = true;
  }
  return list;
}

function isLikelyDownloadableAffiliateLink(link) {
  return isDownloadableMediaUrl(link?.link);
}

function providerPrimaryMediaLanguage(source) {
  if (!source || typeof source !== 'object') return '';
  const dubbed = source.dubbed === true || Number(source.dubbed) === 1 || /^(?:1|true|yes)$/i.test(cleanText(source.dubbed));
  return dubbed ? 'dubbed' : '';
}

function isUperaPrimaryMediaVariant(value) {
  const text = cleanText(value);
  if (!/upera\.tv|upera\.link|seeko\.film/i.test(text)) return false;
  let pathname = text;
  try { pathname = new URL(text).pathname; } catch {}
  const filename = pathname.split('/').pop() || '';
  return /-0-(?:[^/?#]+)$/i.test(filename);
}

function parseMediaLinks(links, primaryLanguage = '') {
  const normalizedLinks = reconcileUperaLanguageLinks((Array.isArray(links) ? links : [])
    .filter((link) => isHttp(link?.link))
    .map((link) => {
      const next = { ...link, link: rewriteAffiliateRef(link.link) };
      next._media_descriptor = mediaLinkDescriptor(next);
      next._media_language_tag = mediaLanguageTagForLink(next) ||
        (primaryLanguage === 'dubbed' && isUperaPrimaryMediaVariant(next.link) ? 'dubbed' : '');
      next._media_language = mediaLanguageLabel(next._media_language_tag);
      next._media_price_tier = mediaPriceTier(next);
      return next;
    }));

  // Purchase/subscription links are not part of Aparatchi. Operator access is
  // accepted only when it is free and can be positively identified as mobile
  // operator playback/download; an ordinary Upera purchase page must never be
  // promoted into «ویژه اینترنت همراه».
  const portalLinks = uniqueByUrl(
    normalizedLinks.filter((link) =>
      link._media_price_tier !== 'paid' && isVerifiedPortalAccessLink(link),
    ),
  );
  const operatorLinks = uniqueByUrl(
    normalizedLinks.filter((link) =>
      link._media_price_tier !== 'paid' && isOperatorAccessLink(link),
    ),
  );
  const publicPortalLinks = portalLinks.filter((link) => !isOperatorAccessLink(link));

  const ordinaryLinks = normalizedLinks.filter((link) =>
    !operatorPortalDetails(link?.link) && link._media_price_tier !== 'paid' && !link._drop_ambiguous_language,
  );
  const byLanguage = new Map();
  for (const link of ordinaryLinks) {
    const language = link._media_language || 'لینک‌های دریافت';
    if (!byLanguage.has(language)) byLanguage.set(language, []);
    byLanguage.get(language).push(link);
  }

  const downloads = [];
  const freePlayableMp4 = [];
  const freeHls = [];
  let hasFreeAcquisition = false;
  let hasAnyAcquisition = false;

  for (const [language, bucket] of byLanguage.entries()) {
    const free = bucket.filter((link) => link._media_price_tier === 'free');
    const unknown = bucket.filter((link) => link._media_price_tier === 'unknown');
    // Prefer explicitly-free links, but keep extension-bearing direct media
    // when the provider omitted the amount field. Never fall back to paid.
    const preferred = free.length
      ? free
      : unknown.filter((link) => isDirectMediaUrl(link.link));
    if (!preferred.length) continue;

    const files = [];
    for (const link of uniqueByUrl(preferred)) {
      const languageTag = link._media_language_tag || mediaLanguageTagForLink(link);
      let file = null;

      if (isLikelyDownloadableAffiliateLink(link)) {
        file = toDownloadFile(link, 'download');
        hasFreeAcquisition = true;
        if (/\.mp4(?:$|[?#])/i.test(link.link)) freePlayableMp4.push(link);
      } else if (isPlayableMediaUrl(link.link) && /\.m3u8(?:$|[?#])/i.test(link.link)) {
        // HLS is a play source, not a download action.
        file = toDownloadFile(link, 'play');
        freeHls.push(link);
        hasFreeAcquisition = true;
      }

      if (!file) continue;
      if (languageTag) file.language = languageTag;
      files.push(file);
      hasAnyAcquisition = true;
    }

    if (!files.length) continue;
    const dedupedFiles = dedupeMediaFiles(files);
    const downloadableCount = dedupedFiles.filter((file) => file.mode === 'download').length;
    downloads.push({
      id: `download-${slugify(language)}`,
      title: language,
      subtitle: downloadableCount
        ? `${downloadableCount} کیفیت دانلود مستقیم`
        : 'فقط پخش آنلاین',
      badge: language === 'دوبله فارسی'
        ? 'دوبله'
        : language === 'زیرنویس فارسی'
          ? 'زیرنویس'
          : downloadableCount ? 'DL' : 'پخش',
      files: dedupedFiles,
    });
  }

  const operatorFiles = operatorLinks
    .map((link) => toOperatorFile(link))
    .filter(Boolean);

  const publicPortalFiles = publicPortalLinks
    .map((link) => toPortalPlayFile(link, false))
    .filter(Boolean);

  if (publicPortalFiles.length) {
    downloads.push({
      id: 'online-public-stream',
      title: 'پخش آنلاین رایگان',
      subtitle: 'قابل پخش با همه اینترنت‌ها',
      badge: 'پخش',
      files: publicPortalFiles,
    });
    hasFreeAcquisition = true;
    hasAnyAcquisition = true;
  }

  if (operatorFiles.length) {
    const hasOperatorPlay = operatorFiles.some((file) => file.mode === 'operator-play');
    const hasOperatorDownload = operatorFiles.some((file) => file.mode === 'operator-download');
    downloads.push({
      id: 'operator-mobile-access',
      title: 'ویژه اینترنت همراه',
      subtitle: hasOperatorPlay && hasOperatorDownload
        ? 'پخش و دانلود با اینترنت سیم‌کارت'
        : hasOperatorDownload
          ? 'دانلود با اینترنت سیم‌کارت'
          : 'فقط پخش با اینترنت سیم‌کارت',
      badge: 'همراه',
      files: operatorFiles,
    });
  }

  const sortedMp4 = uniqueByUrl(freePlayableMp4).sort(
    (a, b) => qualityRank(a.title) - qualityRank(b.title),
  );
  const hls = uniqueByUrl(freeHls);
  const streamUrl = hls[0]?.link || highestQuality(sortedMp4)?.link || null;
  const onlyOperator = operatorFiles.length > 0 && !hasAnyAcquisition && !streamUrl;

  return {
    downloads,
    streamUrl,
    hls: hls[0]?.link || null,
    mp4: sortedMp4,
    operatorFiles,
    publicPortalFiles,
    portalFiles: [...publicPortalFiles, ...operatorFiles],
    access: onlyOperator ? 'operator' : 'free',
    paidFallback: false,
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
  if (image && image.startsWith('/')) image = `https://image.tmdb.org/t/p/w185${image}`;
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
  return `https://image.tmdb.org/t/p/w185/${value.replace(/^\/+/, '')}`;
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

  const query = cleanText(item?.nameFa || item?.name);
  if (!query) return null;
  const searchQuery = {
    query,
    include_adult: 'false',
    ...(item?.year ? { [mediaType === 'tv' ? 'first_air_date_year' : 'year']: item.year } : {}),
  };
  // TMDB localizes `title`/`name` according to the requested language. The
  // operator panel commonly supplies only a Persian title, so an en-US-only
  // search could return the correct row but then reject it during exact-title
  // validation because only its English display title was present. Search the
  // Persian view first and merge the English view as a fallback. IMDb IDs, when
  // supplied by the provider, still take the exact `/find` route above.
  const [searchFa, searchEn] = await Promise.all([
    fetchTmdbJson(`search/${mediaType}`, { ...searchQuery, language: 'fa-IR' }),
    fetchTmdbJson(`search/${mediaType}`, { ...searchQuery, language: 'en-US' }),
  ]);
  const selected = selectTmdbSearchResult(item, [
    ...(Array.isArray(searchFa?.results) ? searchFa.results : []),
    ...(Array.isArray(searchEn?.results) ? searchEn.results : []),
  ]);
  return selected?.id ? { id: Number(selected.id), mediaType } : null;
}

async function enrichMissingOperatorOverviews() {
  if (!tmdbBearerToken || operatorOverviewTitlesPerRun <= 0) return;
  const now = Date.now();
  const retryMs = 7 * 24 * 60 * 60 * 1000;
  const candidates = (Array.isArray(catalog.items) ? catalog.items : [])
    .filter((item) => item && (item.operatorOnly === true || item.access === 'operator'))
    .filter((item) => !/[\u0600-\u06ff]/.test(cleanText(item.overview)))
    .filter((item) => {
      const checked = Date.parse(cleanText(item.operatorOverviewCheckedAt));
      return !Number.isFinite(checked) || now - checked >= retryMs;
    })
    .sort((a, b) => peopleCandidateTimestamp(b) - peopleCandidateTimestamp(a))
    .slice(0, operatorOverviewTitlesPerRun);

  for (const item of candidates) {
    if (runTimeBudgetReached('operator-overview-enrichment', 35000)) break;
    item.operatorOverviewCheckedAt = new Date().toISOString();
    try {
      const title = await resolveTmdbTitle(item);
      if (!title) continue;
      const details = await fetchTmdbJson(`${title.mediaType}/${title.id}`, { language: 'fa-IR' });
      const overview = cleanText(details?.overview);
      if (overview && /[\u0600-\u06ff]/.test(overview)) {
        item.overview = overview;
        item.operatorOverviewSource = 'tmdb-fa';
      }
    } catch (error) {
      rememberError(`operator-overview-${String(item.id || 'unknown')}`, error);
    }
  }
}

function operatorClassificationNeedsVerification(item) {
  if (!item || catalogVariant(item) !== 'operator') return false;
  const rules = classifyCatalogRules({ ...item, operatorClassificationPending: false });
  if (rules.contentKind && !['movie', 'series'].includes(rules.contentKind)) return false;
  if (item.operatorClassificationSource === 'tmdb' && Number(item.tmdbValidationVersion || 0) >= 7) return false;
  const informativeGenres = (Array.isArray(item.genres) ? item.genres : [])
    .map((value) => cleanText(value).toLowerCase())
    .filter((value) => value && !['سایر', 'other', 'unknown', 'نامشخص'].includes(value));
  const hasRegionTruth = Boolean(
    (Array.isArray(item.countryCodes) && item.countryCodes.length) ||
    cleanText(item.originalLanguage)
  );
  return !(informativeGenres.length > 0 && hasRegionTruth);
}

async function enrichOperatorClassificationMetadata() {
  if (!tmdbBearerToken || operatorClassificationTitlesPerRun <= 0) return;
  const now = Date.now();
  const retryMs = 24 * 60 * 60 * 1000;
  const candidates = items
    .filter((item) => operatorClassificationNeedsVerification(item))
    .filter((item) => {
      const checked = Date.parse(cleanText(item.operatorClassificationCheckedAt));
      return !Number.isFinite(checked) || now - checked >= retryMs;
    })
    .sort((a, b) => peopleCandidateTimestamp(b) - peopleCandidateTimestamp(a))
    .slice(0, operatorClassificationTitlesPerRun);

  for (const item of candidates) {
    if (runTimeBudgetReached('operator-classification', 35000)) break;
    item.operatorClassificationCheckedAt = new Date().toISOString();
    item.operatorClassificationStatus = 'pending';
    try {
      const title = await resolveTmdbTitle(item);
      if (!title) continue;
      const [detailsEn, detailsFa] = await Promise.all([
        fetchTmdbJson(`${title.mediaType}/${title.id}`, { language: 'en-US' }),
        fetchTmdbJson(`${title.mediaType}/${title.id}`, { language: 'fa-IR' }),
      ]);
      const genreObjects = Array.isArray(detailsEn?.genres) ? detailsEn.genres : [];
      const genres = genreObjects.map((genre) => cleanText(genre?.name)).filter(Boolean);
      if (genres.length) item.genres = genres;
      const countryCodes = title.mediaType === 'tv'
        ? (Array.isArray(detailsEn?.origin_country) ? detailsEn.origin_country : [])
        : (Array.isArray(detailsEn?.production_countries) ? detailsEn.production_countries.map((entry) => entry?.iso_3166_1) : []);
      if (countryCodes.filter(Boolean).length) item.countryCodes = uniqueStrings(countryCodes);
      const originalLanguage = cleanText(detailsEn?.original_language);
      if (originalLanguage) item.originalLanguage = originalLanguage;
      const overviewFa = cleanText(detailsFa?.overview);
      if (overviewFa && /[\u0600-\u06ff]/.test(overviewFa)) item.overview = overviewFa;
      const genreIds = new Set(genreObjects.map((genre) => Number(genre?.id || 0)));
      if (genreIds.has(99) || genres.some((genre) => /documentary/i.test(genre))) item.isDocumentary = true;
      if (genreIds.has(16) || genres.some((genre) => /animation/i.test(genre))) item.isAnimation = true;
      item.tmdbId = Number(title.id);
      item.tmdbValidationVersion = Math.max(8, Number(item.tmdbValidationVersion || 0));
      item.operatorClassificationSource = 'tmdb';
      item.operatorClassificationStatus = operatorClassificationNeedsVerification(item) ? 'pending' : 'verified';
    } catch (error) {
      rememberError(`operator-classification-${String(item.id || 'unknown')}`, error);
    }
  }
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
  const sourceId = baseCatalogId(item);
  let detail = null;
  if (item?.type === 'movie') {
    detail = await fetchMovieDetail(sourceId);
  } else if (item?.type === 'series') {
    const url = new URL(
      `${API_BASE}/ghost/get/series/${encodeURIComponent(sourceId)}`,
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


function episodeFrameSource(group) {
  const files = Array.isArray(group?.files) ? group.files : [];
  const direct = files
    .filter((file) =>
      file &&
      /^https?:\/\//i.test(cleanText(file.url)) &&
      (file.mode === 'play' || file.mode === 'download') &&
      /\.(?:mp4|m3u8)(?:$|[?#])/i.test(cleanText(file.url)),
    )
    .sort((a, b) => {
      const aMp4 = /\.mp4(?:$|[?#])/i.test(cleanText(a.url)) ? 0 : 1;
      const bMp4 = /\.mp4(?:$|[?#])/i.test(cleanText(b.url)) ? 0 : 1;
      return aMp4 - bMp4;
    });
  return cleanText(direct[0]?.url);
}

function normalizedEpisodeArtworkIdentity(value) {
  return cleanText(value)
    .replace(/^https?:\/\//i, '')
    .replace(/[?#].*$/, '')
    .toLowerCase();
}

function episodeArtworkUsage(item) {
  const counts = new Map();
  for (const group of Array.isArray(item?.downloads) ? item.downloads : []) {
    if (Number(group?.episodeNumber || 0) <= 0) continue;
    const key = normalizedEpisodeArtworkIdentity(group?.artwork);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function episodeGroupNeedsGeneratedFrame(item, group, usage = episodeArtworkUsage(item)) {
  if (!group || Number(group?.episodeNumber || 0) <= 0) return false;
  const artwork = cleanText(group.artwork);
  if (!artwork) return true;
  if (isTrustedGeneratedEpisodeArtwork(artwork)) return false;

  // Final rule: an episode card must use a frame captured from that exact
  // episode, never a remote poster/backdrop/still whose provenance can be
  // ambiguous. Remote artwork is only a temporary source hint; the PEOPLE
  // stage replaces it with a locally cached ffmpeg frame from the episode
  // video. This also removes the slow remote-image dependency in the app.
  void item;
  void usage;
  return true;
}

async function generateEpisodeFrameArtwork(item, group, options = {}) {
  const force = options.force === true;
  if (
    episodeFrameCapturesUsed >= episodeFrameCapturesPerRun ||
    (!force && cleanText(group?.artwork))
  ) {
    return false;
  }

  const source = episodeFrameSource(group);
  if (!source) return false;

  const fingerprint = createHash('sha1')
    .update(`${item?.id || 'series'}|${group?.sourceEpisodeId || group?.id || ''}|${source}`)
    .digest('hex')
    .slice(0, 24);
  const relative = relativeMediaPath('episodes', `${fingerprint}.jpg`);
  const absolute = path.join(root, ...relative.split('/'));

  try {
    episodeFrameCapturesUsed += 1;
    await fs.mkdir(path.dirname(absolute), { recursive: true });

    try {
      const existing = await fs.stat(absolute);
      if (existing.size > 512) {
        group.artwork = relative;
        return true;
      }
    } catch {
      // Create the frame below.
    }

    let seekSeconds = 120;
    try {
      const probe = await execFileAsync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', source],
        { timeout: Math.min(requestTimeoutMs, 12000), maxBuffer: 1024 * 1024 },
      );
      const duration = Number(String(probe?.stdout || '').trim());
      if (Number.isFinite(duration) && duration > 20) seekSeconds = Math.max(10, Math.round(duration * 0.5));
    } catch {
      seekSeconds = 90 + ((Number(group?.episodeNumber || 1) * 17) % 90);
    }

    await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', String(seekSeconds),
        '-i', source,
        '-frames:v', '1',
        '-vf', 'thumbnail=90,scale=640:-2',
        '-q:v', '5',
        '-y',
        absolute,
      ],
      {
        timeout: 18000,
        maxBuffer: 1024 * 1024,
      },
    );

    const info = await fs.stat(absolute);
    if (info.size <= 512) {
      await fs.rm(absolute, { force: true });
      return false;
    }

    group.artwork = relative;
    stats.episodeFramesGenerated += 1;
    return true;
  } catch (error) {
    stats.episodeFrameErrors += 1;
    try {
      await fs.rm(absolute, { force: true });
    } catch {
      // Ignore cleanup failures.
    }
    rememberError(
      `episode-frame-${item?.id || 'unknown'}-${group?.episodeNumber || 0}`,
      error,
    );
    return false;
  }
}

async function generateMissingEpisodeFrames(item) {
  if (!item || episodeFrameCapturesUsed >= episodeFrameCapturesPerRun) return;
  const usage = episodeArtworkUsage(item);
  const groups = (Array.isArray(item.downloads) ? item.downloads : [])
    .filter((group) => episodeGroupNeedsGeneratedFrame(item, group, usage))
    // Prioritize the episode users are about to watch next. Older missing
    // frames remain in the rotating queue after the newest episodes are ready.
    .sort((a, b) => compareEpisodeGroups(b, a));
  for (const group of groups) {
    if (episodeFrameCapturesUsed >= episodeFrameCapturesPerRun) break;
    await generateEpisodeFrameArtwork(item, group, { force: Boolean(cleanText(group?.artwork)) });
  }
}

async function syncEpisodeArtworkMetadata(options = {}) {
  const maxTitles = Math.max(1, Math.min(
    episodeArtworkSeriesPerRun,
    positiveInt(options.maxTitles, episodeArtworkSeriesPerRun),
  ));
  const candidates = items
    .filter((item) => item?.type === 'series')
    .filter((item) => catalogVariant(item) !== 'operator')
    .filter((item) => {
      const usage = episodeArtworkUsage(item);
      return (Array.isArray(item.downloads) ? item.downloads : []).some((group) =>
        Number(group?.episodeNumber || 0) > 0 &&
        episodeGroupNeedsGeneratedFrame(item, group, usage),
      );
    })
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
      const episodes = await fetchSeriesEpisodeArtworkMetadata(baseCatalogId(item));
      stats.episodeArtworkAdded += hydrateEpisodeGroupArtwork(item.downloads, episodes);
      await generateMissingEpisodeFrames(item);
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

  // Keep newly added titles with no people metadata from waiting behind a long
  // historical cursor, while still reserving half of every run for rotating
  // backlog repair. This is generic queue policy; no title is hard-coded.
  const priorityTake = options.preferRecent
    ? 0
    : Math.min(maxTitles, Math.max(1, Math.ceil(maxTitles / 2)));
  const priorityCandidates = options.preferRecent
    ? []
    : candidates
        .filter((item) =>
          (!Array.isArray(item.people) || item.people.length === 0) &&
          !cleanText(item.peopleEnrichmentCheckedAt),
        )
        .slice(0, priorityTake);
  const prioritySet = new Set(priorityCandidates);
  const rotatingCandidates = options.preferRecent
    ? candidates
    : candidates.filter((item) => !prioritySet.has(item));
  const start = options.preferRecent
    ? 0
    : rotatingCandidates.length
      ? state.peopleEnrichmentOffset % rotatingCandidates.length
      : 0;
  const selected = options.preferRecent
    ? candidates.slice(0, Math.min(maxTitles, candidates.length))
    : [...priorityCandidates];
  if (!options.preferRecent && rotatingCandidates.length > 0) {
    const remaining = Math.max(0, maxTitles - selected.length);
    for (let index = 0; index < Math.min(remaining, rotatingCandidates.length); index += 1) {
      selected.push(rotatingCandidates[(start + index) % rotatingCandidates.length]);
    }
  }

  let visited = 0;
  let rotatingVisited = 0;
  for (const item of selected) {
    if (runTimeBudgetReached('people-enrichment', 45000)) break;
    visited += 1;
    if (!options.preferRecent && !prioritySet.has(item)) rotatingVisited += 1;
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

  if (!options.preferRecent && rotatingCandidates.length > 0 && rotatingVisited > 0) {
    state.peopleEnrichmentOffset =
      (start + rotatingVisited) % rotatingCandidates.length;
  } else if (!options.preferRecent && rotatingCandidates.length === 0) {
    state.peopleEnrichmentOffset = 0;
  }
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
    availableLanguages: uniqueStrings([...(Array.isArray(current.availableLanguages) ? current.availableLanguages : []), ...(Array.isArray(incoming.availableLanguages) ? incoming.availableLanguages : [])]),
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
    publishedAt: [current.publishedAt, incoming.publishedAt].filter(Boolean).sort()[0],
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
      archiveCompletenessAuditVersion: Math.min(
        nonNegativeInt(current.archiveCompletenessAuditVersion, 0),
        nonNegativeInt(incoming.archiveCompletenessAuditVersion, 0),
      ),
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
      const candidates = indexesByName.get(`${catalogVariant(item)}:${item.type}:${name}`) || [];
      matchIndex = candidates.find((index) => yearsAreCompatible(result[index]?.year, item.year)) ?? -1;
      if (matchIndex >= 0) break;
    }

    if (matchIndex < 0) {
      const index = result.length;
      result.push(item);
      for (const name of names) {
        const key = `${catalogVariant(item)}:${item.type}:${name}`;
        indexesByName.set(key, [...(indexesByName.get(key) || []), index]);
      }
      continue;
    }

    result[matchIndex] = mergeDuplicateCatalogPair(result[matchIndex], item);
    merged += 1;
    for (const name of identityNames(result[matchIndex])) {
      const key = `${catalogVariant(result[matchIndex])}:${result[matchIndex].type}:${name}`;
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
    // Deliberately do not inspect generic `images/media/attachments` objects:
    // those payloads frequently contain a poster/cover rather than an episode
    // still. If no explicit still-like field exists, ffmpeg generates a frame
    // from this exact episode instead.
  ]) {
    const raw = nestedImageValue(value);
    if (raw) return imageUrl(raw, folder);
  }
  return '';
}


function meaningfulEpisodeTitle(series, episode, number) {
  // `overview` is intentionally not a title source. Upera often stores
  // boilerplate such as "قسمت سیزدهم سیاوش" in the episode name fields; keep
  // only an independent episode title.
  const raw = cleanText(episode?.name_fa || episode?.name || episode?.title || '');
  if (!raw) return '';

  const normalized = normalizeClassificationText(raw)
    .replace(/[ـ_:|•\-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';

  const episodeToken = `(?:${PERSIAN_EPISODE_ORDINAL}|${String(number || '').trim() || '\\d{1,4}'})`;
  const genericOnly = new RegExp(
    `^(?:(?:قسمت|اپیزود)\\s*${episodeToken}|(?:episode|ep|part)\\s*[-:#]*\\s*\\d{1,4}|(?:فصل|season)\\s*\\d+\\s*(?:قسمت|اپیزود|episode|ep)\\s*\\d+)$`,
    'i',
  ).test(normalized);
  if (genericOnly) return '';

  const seriesNames = uniqueStrings([
    normalizeClassificationText(series?.name_fa || series?.nameFa || ''),
    normalizeClassificationText(series?.name || ''),
  ])
    .map((value) => value.replace(/[ـ_:|•\-–—]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (const seriesName of seriesNames) {
    const escaped = seriesName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const seriesThenEpisode = new RegExp(
      `^${escaped}\\s*(?:(?:قسمت|اپیزود)\\s*${episodeToken}|(?:episode|ep|part)\\s*\\d{1,4})$`,
      'i',
    );
    const episodeThenSeries = new RegExp(
      `^(?:(?:قسمت|اپیزود)\\s*${episodeToken}|(?:episode|ep|part)\\s*\\d{1,4})\\s*${escaped}$`,
      'i',
    );
    if (seriesThenEpisode.test(normalized) || episodeThenSeries.test(normalized)) return '';

    const residual = normalized
      .replace(new RegExp(escaped, 'i'), ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      residual !== normalized &&
      new RegExp(
        `^(?:(?:قسمت|اپیزود)\\s*${episodeToken}|(?:episode|ep|part)\\s*[-:#]*\\s*\\d{1,4})$`,
        'i',
      ).test(residual)
    ) {
      return '';
    }
  }

  return raw;
}

function episodeGroup(episode, media, series) {
  const season = episodeSeasonNumber(episode);

  const number = episodeNumberValue(episode);

  const files = [];

  const playUrl =
    media.hls ||
    (!media.paidFallback ? highestQuality(media.mp4)?.link : null);

  const normalizedMediaFiles = (Array.isArray(media.downloads) ? media.downloads : [])
    .flatMap((section) => Array.isArray(section?.files) ? section.files : [])
    .filter((file) => !isValidStoredOperatorFile(file));
  const hasLanguageAwarePlay = normalizedMediaFiles.some((file) =>
    file?.mode === 'play' && Boolean(file?.language),
  );

  if (playUrl && !hasLanguageAwarePlay) {
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

  // Preserve normalized language and paid/free mode from parseMediaLinks(),
  // including language-aware HLS play rows.
  for (const file of normalizedMediaFiles) {
    files.push({
      ...file,
      id: `s${season}-e${number}-${file.id || simpleHash(file.url || '')}`,
    });
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
  const artwork = '';

  return {
    id:
      `season-${season}-episode-${number}-${episode.id}`,

    sourceEpisodeId:
      String(episode.id),

    seasonNumber: season,
    episodeNumber: number,

    title:
      `فصل ${toPersianDigits(season)} • قسمت ${toPersianDigits(number)}`,

    subtitle: meaningfulEpisodeTitle(series, episode, number),

    badge: `E${number}`,
    ...(artwork ? { artwork } : {}),
    sourceUpdatedAt,
    files: dedupeMediaFiles(files),
  };
}


function sourcePersianTitle(payload) {
  const candidates = [
    payload?.name_fa, payload?.nameFa, payload?.title_fa, payload?.titleFa,
    payload?.persian_name, payload?.persianName, payload?.fa_name, payload?.faName,
    payload?.persian_title, payload?.persianTitle, payload?.title, payload?.name,
  ].map(cleanText).filter(Boolean);
  return candidates.find((value) => /[\u0600-\u06ff]/.test(value)) || candidates[0] || '';
}

function sourceOverview(payload) {
  const candidates = [
    payload?.overview_fa, payload?.description_fa, payload?.story_fa, payload?.synopsis_fa,
    payload?.summary_fa, payload?.plot_fa, payload?.overview, payload?.description,
    payload?.story, payload?.synopsis, payload?.summary, payload?.plot, payload?.caption, payload?.about,
  ].map(cleanText).filter((value) => value && value !== 'توضیحی ثبت نشده است.');
  return candidates.find((value) => value.length >= 18) || candidates[0] || 'توضیحی ثبت نشده است.';
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
        nameFa: sourcePersianTitle(movie) || movie.name,
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
        file.mode === 'download' || file.mode === 'play' || file.mode === 'purchase' || !file.mode,
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
      sourcePersianTitle(movie) ||
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

    overview: sourceOverview(movie),

    genres,

    people: mergePeople(existing?.people, extractSourcePeople(movie)),

    ...(isFiniteNumber(movie.rate)
      ? { rate: Number(movie.rate) }
      : {}),

    access: operatorOnly ? 'operator' : (media.access === 'paid' ? 'paid' : 'free'),
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

    mediaLanguageAuditVersion: nonNegativeInt(existing?.mediaLanguageAuditVersion, 0),

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

  const usableGroups = groups.filter(episodeGroupHasUsableMedia);
  const latestEpisode = [...usableGroups]
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
        nameFa: sourcePersianTitle(series) || series.name,
        name: series.name || series.name_fa,
        existing,
      },
    );

  const operatorFiles = groups.flatMap((group) =>
    (Array.isArray(group?.files) ? group.files : []).filter(isMobileOperatorFile),
  );
  const directFiles = groups.flatMap((group) =>
    (Array.isArray(group?.files) ? group.files : []).filter((file) =>
      !isMobileOperatorFile(file),
    ),
  );
  const hasOperator = operatorFiles.length > 0;
  const hasPurchase = directFiles.some((file) => file?.mode === 'purchase');
  const hasFreeDirect = directFiles.some((file) => file?.mode !== 'purchase');
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
    usableGroups
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
      sourcePersianTitle(series) ||
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

    overview: sourceOverview(series),

    genres,

    people: mergePeople(existing?.people, extractSourcePeople(series)),

    ...(isFiniteNumber(series.rate)
      ? { rate: Number(series.rate) }
      : {}),

    access: operatorOnly ? 'operator' : (hasPurchase && !hasFreeDirect ? 'paid' : 'free'),
    operatorOnly,
    operatorAccess: hasOperator ? operatorAccess : undefined,
    supportedOperators: supportedOperators.length ? supportedOperators : undefined,
    downloads: groups,

    episodeCount: usableGroups.length,
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
    ...(archiveMeta.publishedAt
      ? { publishedAt: archiveMeta.publishedAt }
      : existing?.publishedAt
        ? { publishedAt: existing.publishedAt }
        : {}),
    visibilityLocked: Boolean(
      !ir && (
        existing?.visibilityLocked ||
        existing?.publicationStatus === 'published'
      )
    ),
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
    // Versioned full-source audit: every legacy series is revisited once after
    // completeness logic changes, even if an older run incorrectly marked it complete.
    archiveCompletenessAuditVersion: SERIES_COMPLETENESS_AUDIT_VERSION,
    mediaLanguageAuditVersion: archiveMeta.mediaLanguageAuditComplete === true
      ? MEDIA_LANGUAGE_AUDIT_VERSION
      : nonNegativeInt(existing?.mediaLanguageAuditVersion, 0),

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
    ...(archiveMeta.meaningfulUpdatedAt
      ? { meaningfulUpdatedAt: archiveMeta.meaningfulUpdatedAt }
      : existing?.meaningfulUpdatedAt
        ? { meaningfulUpdatedAt: existing.meaningfulUpdatedAt }
        : {}),

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
  const existing = metadata.existing || {};
  const rules = classifyCatalogRules({
    ...existing,
    type,
    ir,
    genres,
    nameFa: metadata.nameFa ?? existing.nameFa,
    name: metadata.name ?? existing.name,
    overview: metadata.overview ?? existing.overview,
  });
  return {
    categoryKeys: rules.categoryKeys,
    categoryLabels: rules.categoryLabels,
    contentKind: rules.contentKind,
    isAnimation: rules.isAnimation,
    isAnime: rules.isAnime,
    isTalkShow: rules.isTalkShow,
    isDocumentary: rules.isDocumentary,
    isWildlife: rules.isWildlife,
    isChildrenProgram: rules.isChildrenProgram,
    isRealityCompetition: rules.isRealityCompetition,
  };
}

function isManagedCategoryKey(value) {
  return managedCategoryKey(value);
}

function isManagedCategoryLabel(value) {
  return managedCategoryLabel(value);
}

function effectiveIranianIdentity(item) {
  const rules = classifyCatalogRules({ ...item, categoryKeys: [] });
  return Boolean(rules.ir);
}

function reclassifyCatalogItem(item) {
  if (!item || !['movie', 'series'].includes(item.type)) return item;
  const classicCollection = classicComedyCollectionFor(item);
  const classifiedItem = classicCollection
    ? {
        ...item,
        collectionId: classicCollection.id,
        collectionName: classicCollection.name,
        collectionNameFa: classicCollection.nameFa,
      }
    : item;
  const operatorClassificationPending = operatorClassificationNeedsVerification(classifiedItem);
  const classification = classifyCatalogRules({ ...classifiedItem, operatorClassificationPending });
  const preservedKeys = (Array.isArray(classifiedItem.categoryKeys) ? classifiedItem.categoryKeys : [])
    .filter((key) => !isManagedCategoryKey(key));
  const preservedLabels = (Array.isArray(classifiedItem.categoryLabels) ? classifiedItem.categoryLabels : [])
    .filter((label) => !isManagedCategoryLabel(label));
  const directLanguages = uniqueStrings((Array.isArray(classifiedItem.downloads) ? classifiedItem.downloads : [])
    .flatMap((section) => [
      section?.title,
      section?.badge,
      ...(Array.isArray(section?.files)
        ? section.files.map((file) => `${file?.label || ''} ${file?.language || ''}`)
        : []),
    ])
    .map((value) => {
      const text = cleanText(value || '');
      if (mediaLanguageTag(text) === 'dubbed') return 'dubbed';
      if (mediaLanguageTag(text) === 'subtitled') return 'subtitled';
      return '';
    }).filter(Boolean));

  return {
    ...classifiedItem,
    ir: classification.ir,
    contentKind: classification.contentKind,
    isAnimation: classification.isAnimation,
    isAnime: classification.isAnime,
    isDocumentary: classification.isDocumentary,
    isShortFilm: classification.isShortFilm,
    isWildlife: classification.isWildlife,
    ...(catalogVariant(classifiedItem) === 'operator' ? { operatorClassificationStatus: operatorClassificationPending ? 'pending' : (classifiedItem.operatorClassificationStatus || 'resolved') } : {}),
    isTalkShow: classification.isTalkShow,
    // Rebuild badges from currently validated media; never preserve stale dubbing/subtitle claims.
    availableLanguages: directLanguages,
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
      // Source candidates use the ordinary Upera identity. Operator editions
      // are updated through the split pass and must never steal this match.
      if (catalogVariant(item) !== 'standard') return false;
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

      const itemId = cleanText(item?.id);
      return Boolean(
        (!id || !itemId) &&
        item.type === type &&
        namesOverlap(candidate, item) &&
        yearsAreCompatible(year, item.year),
      );
    }) || null
  );
}

function normalizedPosterIdentity(value) {
  try {
    const url = new URL(cleanText(value));
    const source = url.searchParams.get('src');
    return path.basename(source || url.pathname).toLowerCase();
  } catch {
    return path.basename(cleanText(value)).toLowerCase();
  }
}

function findExistingPanelTitle(candidate, type) {
  const direct = findExistingItem(candidate, type);
  if (direct) return direct;
  const year = identityYear(candidate?.year);
  const posterIdentity = normalizedPosterIdentity(candidate?.poster);
  return items.find((item) => {
    if (catalogVariant(item) !== 'standard' || item?.type !== type) return false;
    if (!namesOverlap(candidate, item)) return false;
    if (yearsAreCompatible(year, item?.year)) return true;
    return Boolean(
      posterIdentity &&
      posterIdentity === normalizedPosterIdentity(item?.poster),
    );
  }) || null;
}

function replaceItem(next) {
  const nextVariant = catalogVariant(next);
  items = items.filter((item) => {
    if (catalogVariant(item) !== nextVariant) return true;
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

    const itemId = cleanText(item?.id);
    const nextId = cleanText(next?.id);
    return !(
      (!itemId || !nextId) &&
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

  if (!group || !episodeGroupHasUsableMedia(group)) return true;

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

function episodeGroupHasUsableMedia(group) {
  return Boolean((Array.isArray(group?.files) ? group.files : []).some((file) =>
    isDirectMediaUrl(file?.url) || isValidStoredOperatorFile(file) || isValidStoredPublicPortalFile(file),
  ));
}

function hydrateEpisodeGroupArtwork(_groups, _episodes) {
  // Upera stills can be cross-linked. Only a frame captured from the exact
  // episode media is accepted as episode-specific artwork.
  return 0;
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
    groups.filter(episodeGroupHasUsableMedia).map((group) => archiveEpisodeCoordinateKey(group)),
  );
  // `archiveUnavailableEpisodes` is diagnostic/retry metadata only. It must
  // never erase a real source episode from the completeness deficit; otherwise
  // a 404 can turn a visibly gapped archive into `archiveComplete: true`.
  const missing = episodeGapsForGroups(groups);
  const sourceEpisodeCount = nonNegativeInt(item.sourceEpisodeCount, 0);
  const pendingFromCount = Math.max(
    0,
    sourceEpisodeCount - availableCoordinates.size,
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
    ? item.archivePendingEpisodes.length
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
  const hasEpisodes = (Array.isArray(item.downloads) ? item.downloads : []).some(episodeGroupHasUsableMedia);
  const strictIranianArchive = Boolean(effectiveIranianIdentity(item) && !item.isDocumentary && item.contentKind !== 'documentary');
  const visibilityLocked = Boolean(
    !strictIranianArchive && (
      item.visibilityLocked ||
      (item.publicationStatus === 'published' && hasEpisodes)
    )
  );

  if (visibilityLocked && hasEpisodes) {
    return {
      ...item,
      visibilityLocked: true,
      archiveComplete:
        deficit.total === 0 &&
        item.archiveEpisodeDiscoveryComplete !== false &&
        hasEpisodes,
      archivePendingEpisodeCount: deficit.pending,
      publicationStatus: 'published',
      archiveAuditStatus: hasArchiveMetadata ? (item.archiveAuditStatus || 'checked') : 'pending',
    };
  }

  // Strict publication rule: a newly discovered series is hidden until its source
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
    hasEpisodes;
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
    if (!episodeGroupHasUsableMedia(group)) continue;
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
  const identity = normalizeIdentityName(`${item?.name_fa || item?.nameFa || ''} ${item?.name || ''}`);
  if (/(?:^| )the westies(?: |$)/i.test(identity) || /وستی(?: |‌)?ها/.test(identity)) return false;

  // Strong source identity beats stale legacy ir flag. Do not use generic audio
  // language here: a dubbed foreign title can legitimately have Persian audio.
  const originalLanguage = cleanText(
    item?.original_language || item?.originalLanguage || '',
  ).toLowerCase();
  if (['fa', 'fas', 'per', 'persian'].includes(originalLanguage)) return true;
  if (originalLanguage) return false;

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
  if (/ایران|iran|(?:^|[^a-z])ir(?:[^a-z]|$)/i.test(country)) return true;
  if (countryValue.some((value) => value !== undefined && value !== null && cleanText(value))) return false;

  const irFlag = item?.ir ?? item?.is_iranian ?? item?.isIranian;
  return Boolean(
    irFlag === true ||
    Number(irFlag || 0) === 1 ||
    String(irFlag || '').toLowerCase() === 'true'
  );
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


function isPlayableMediaUrl(value) {
  return /\.(?:mp4|m3u8)(?:$|[?#])/i.test(String(value || ''));
}

function isDownloadableMediaUrl(value) {
  return /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(String(value || ''));
}

function isDirectMediaUrl(value) {
  return isPlayableMediaUrl(value) || isDownloadableMediaUrl(value);
}

function operatorPortalDetails(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;

    const isUpera = /(^|\.)upera\.tv$/i.test(url.hostname);
    if (!isUpera) return null;

    const pathText = decodeURIComponent(url.pathname || '');
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

    return null;
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
  // The exact /stream route exists for both public playback and mobile-only
  // playback. Only the authenticated panel's traffic_oo flag can distinguish
  // them; the URL alone must never create a «ویژه همراه» badge.
  return Boolean(
    portal?.exactStream &&
    link?._panel_verified === true &&
    Number(link?._traffic_oo) === 1,
  );
}

function isVerifiedPortalAccessLink(link) {
  if (!link || !isHttp(link.link) || isDirectMediaUrl(link.link)) return false;
  return Boolean(
    operatorPortalDetails(link.link)?.exactStream &&
    link?._panel_verified === true,
  );
}

function operatorModeForLink(link) {
  const portal = operatorPortalDetails(link?.link);
  return portal?.exactStream && link?._panel_verified === true ? 'operator-play' : null;
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

function toPortalPlayFile(link, operatorOnly) {
  const mode = operatorModeForLink(link);
  if (!mode) return null;

  const portal = operatorPortalDetails(link.link);
  const label = cleanText(
    link.title ||
    link.label ||
    link.name ||
    (operatorOnly
      ? portal?.mediaType === 'episode'
        ? 'پخش قسمت با اینترنت همراه'
        : 'پخش فیلم با اینترنت همراه'
      : portal?.mediaType === 'episode'
        ? 'پخش آنلاین رایگان قسمت'
        : 'پخش آنلاین رایگان فیلم'),
  );
  const supportedOperators = supportedOperatorsForLink(link);

  return {
    id: `operator-${mode === 'operator-play' ? 'play' : 'download'}-${simpleHash(link.link)}`,
    quality: mode === 'operator-play' ? 'پخش آنلاین' : qualityLabel(label || 'دانلود'),
    label,
    ...(link.size && Number(link.size) !== 0 ? { size: String(link.size) } : {}),
    url: link.link,
    mode,
    operatorOnly: Boolean(operatorOnly),
    panelVerified: true,
    trafficOo: operatorOnly ? 1 : 0,
    ...(supportedOperators.length ? { supportedOperators } : {}),
  };
}

function toOperatorFile(link) {
  return toPortalPlayFile(link, true);
}

function isMobileOperatorFile(file) {
  return Boolean(
    file?.mode === 'operator-play' &&
    file?.operatorOnly === true &&
    file?.panelVerified === true &&
    Number(file?.trafficOo) === 1 &&
    operatorPortalDetails(file?.url),
  );
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
    (Array.isArray(group?.files) ? group.files : []).some(isMobileOperatorFile),
  );
}

function isValidStoredOperatorFile(file) {
  return isMobileOperatorFile(file);
}

function isValidStoredPublicPortalFile(file) {
  return Boolean(
    file?.mode === 'operator-play' &&
    file?.operatorOnly === false &&
    file?.panelVerified === true &&
    Number(file?.trafficOo) === 0 &&
    operatorPortalDetails(file?.url),
  );
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

function sanitizeCatalogUnsupportedPurchases(sourceItems) {
  let removed = 0;
  const items = (Array.isArray(sourceItems) ? sourceItems : []).map((item) => {
    const downloads = (Array.isArray(item?.downloads) ? item.downloads : []).flatMap((section) => {
      const files = (Array.isArray(section?.files) ? section.files : []).filter((file) => {
        const purchase = file?.mode === 'purchase' || file?.purchaseRequired === true;
        if (purchase) removed += 1;
        return !purchase;
      });
      return files.length ? [{ ...section, files }] : [];
    });
    const hasDirect = downloads.some((section) => (section.files || []).some((file) =>
      isDirectMediaUrl(file?.url) || isValidStoredOperatorFile(file),
    ));
    return {
      ...item,
      downloads,
      ...(item?.access === 'paid' ? { access: hasDirect ? 'free' : 'free' } : {}),
    };
  });
  return { items, removed };
}

function sanitizeCatalogOperatorAccess(sourceItems) {
  let removed = 0;
  const sanitized = (Array.isArray(sourceItems) ? sourceItems : []).map((item) => {
    let invalidOperatorRemoved = false;
    const downloads = (Array.isArray(item?.downloads) ? item.downloads : []).flatMap((section) => {
      const nextFiles = [];
      for (const file of Array.isArray(section?.files) ? section.files : []) {
        if (file?.mode === 'operator-play' || file?.mode === 'operator-download') {
          if (isValidStoredOperatorFile(file)) {
            nextFiles.push(file);
          } else if (isValidStoredPublicPortalFile(file)) {
            nextFiles.push(file);
          } else {
            removed += 1;
            invalidOperatorRemoved = true;
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
      (section.files || []).filter((file) => !isMobileOperatorFile(file)),
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
      ...(invalidOperatorRemoved ? { operatorClassificationInvalidated: true } : {}),
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

function collapseInvalidatedOperatorDuplicates(sourceItems) {
  const result = [];
  for (const item of Array.isArray(sourceItems) ? sourceItems : []) {
    if (!item?.operatorClassificationInvalidated) {
      result.push(item);
      continue;
    }
    const duplicate = result.find((entry) =>
      entry?.type === item?.type &&
      catalogVariant(entry) === 'standard' &&
      namesOverlap(entry, item) &&
      yearsAreCompatible(entry?.year, item?.year),
    );
    if (duplicate) {
      const merged = mergeDuplicateCatalogPair(duplicate, item);
      delete merged.operatorClassificationInvalidated;
      result[result.indexOf(duplicate)] = merged;
      continue;
    }
    const next = { ...item };
    delete next.operatorClassificationInvalidated;
    // An old row whose only media was an unverified /stream URL has no usable
    // content after correction. Keep it server-side only if other real media
    // remains; otherwise remove the stale duplicate entirely.
    if (!movieHasUsableMedia(next) && next?.type === 'movie') continue;
    if (
      next?.type === 'series' &&
      !(Array.isArray(next.downloads) && next.downloads.some(episodeGroupHasUsableMedia))
    ) continue;
    result.push(next);
  }
  return result;
}

function catalogVariant(item) {
  return item?.contentVariant === 'operator' ? 'operator' : 'standard';
}

function baseCatalogId(item) {
  return cleanText(item?.sourceContentId || item?.id || '').replace(/--operator$/, '');
}

function filesByVariant(item, operator) {
  return (Array.isArray(item?.downloads) ? item.downloads : []).flatMap((section) => {
    const files = (Array.isArray(section?.files) ? section.files : []).filter((file) => {
      const isOperator = isMobileOperatorFile(file);
      return operator ? isOperator : !isOperator;
    });
    return files.length ? [{ ...section, files }] : [];
  });
}

function splitOperatorCatalogVariants(sourceItems) {
  const preparedItems = applyVerifiedOperatorStreamOverrides(sourceItems);
  const variants = [];

  for (const item of preparedItems) {
    if (!item || !['movie', 'series'].includes(item.type)) {
      variants.push(item);
      continue;
    }

    const baseId = baseCatalogId(item);
    if (!baseId) {
      variants.push(item);
      continue;
    }

    const directDownloads = filesByVariant(item, false);
    const operatorDownloads = filesByVariant(item, true);
    const hasDirect = directDownloads.length > 0 || isDirectMediaUrl(item?.streamUrl);
    const hasOperator = operatorDownloads.length > 0;
    const baseKeys = (item.categoryKeys || []).filter((key) => key !== 'mobile-operator');
    const baseLabels = (item.categoryLabels || []).filter((label) => label !== 'ویژه اینترنت همراه');

    if (hasDirect || !hasOperator) {
      const standard = {
        ...item,
        id: baseId,
        slug: `${item.type}-${baseId}`,
        sourceContentId: baseId,
        contentVariant: 'standard',
        downloads: directDownloads,
        operatorOnly: false,
        access: item.access === 'paid' ? 'paid' : 'free',
        categoryKeys: uniqueStrings(baseKeys),
        categoryLabels: uniqueStrings(baseLabels),
      };
      delete standard.operatorAccess;
      delete standard.supportedOperators;
      if (item.type === 'series') {
        standard.episodeCount = directDownloads.length;
      }
      variants.push(standard);
    }

    if (hasOperator) {
      const operatorId = `${baseId}--operator`;
      const operatorFiles = operatorDownloads.flatMap((group) => group.files || []);
      const operator = {
        ...item,
        id: operatorId,
        slug: `${item.type}-${operatorId}`,
        sourceContentId: baseId,
        contentVariant: 'operator',
        downloads: operatorDownloads,
        streamUrl: undefined,
        streamMode: undefined,
        access: 'operator',
        operatorOnly: true,
        operatorAccess: operatorAccessFromFiles(operatorFiles),
        supportedOperators: uniqueStrings(operatorFiles.flatMap((file) => file.supportedOperators || [])),
        categoryKeys: uniqueStrings([...baseKeys, 'mobile-operator']),
        categoryLabels: uniqueStrings([...baseLabels, 'ویژه اینترنت همراه']),
      };
      if (!operator.supportedOperators.length) delete operator.supportedOperators;
      if (item.type === 'series') {
        operator.episodeCount = operatorDownloads.length;
        operator.sourceEpisodeCount = operatorDownloads.length;
        operator.archivePendingEpisodeCount = 0;
        operator.archivePendingEpisodes = [];
        operator.archiveUnavailableEpisodes = [];
        operator.archiveComplete = true;
        operator.publicationStatus = 'published';
        operator.visibilityLocked = true;
      }
      variants.push(operator);
    }
  }

  // A normal pass and an operator probe can both touch the same title in one
  // run. Consolidate only rows with the exact same variant id.
  const byId = new Map();
  for (const item of variants) {
    const key = cleanText(item?.id);
    if (!key || !byId.has(key)) {
      if (key) byId.set(key, item);
      else byId.set(Symbol(), item);
      continue;
    }
    byId.set(key, mergeDuplicateCatalogPair(byId.get(key), item));
  }
  return [...byId.values()];
}

function applyVerifiedOperatorStreamOverrides(sourceItems) {
  const overridesByTitle = new Map();
  for (const override of verifiedOperatorStreamOverrides) {
    const key = `${override.type}:${override.sourceContentId}`;
    overridesByTitle.set(key, [...(overridesByTitle.get(key) || []), override]);
  }

  return (Array.isArray(sourceItems) ? sourceItems : []).map((item) => {
    if (!item || catalogVariant(item) === 'operator') return item;
    const titleOverrides = overridesByTitle.get(`${item.type}:${baseCatalogId(item)}`) || [];
    if (!titleOverrides.length) return item;

    let changed = false;
    const downloads = (Array.isArray(item.downloads) ? item.downloads : []).map((group) => {
      const override = titleOverrides.find((entry) =>
        nonNegativeInt(group?.seasonNumber, 0) === nonNegativeInt(entry.seasonNumber, 0) &&
        nonNegativeInt(group?.episodeNumber, 0) === nonNegativeInt(entry.episodeNumber, 0),
      );
      if (!override) return group;

      const url = cleanText(override.url);
      const existingFiles = Array.isArray(group.files) ? group.files : [];
      if (existingFiles.some((file) => file?.mode === 'operator-play' && file?.url === url)) return group;
      changed = true;
      return {
        ...group,
        files: dedupeMediaFiles([
          ...existingFiles,
          {
            id: `verified-operator-play-${simpleHash(url)}`,
            quality: 'پخش آنلاین',
            label: 'پخش ویژه اینترنت همراه',
            url,
            mode: 'operator-play',
            operatorOnly: true,
            panelVerified: true,
            trafficOo: 1,
          },
        ]),
      };
    });

    return changed ? { ...item, downloads } : item;
  });
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

function mediaLanguageTag(title = '') {
  const text = cleanText(title);
  if (/دوبله|دو\s*زبانه|دوزبانه|صوت\s*فارسی|صدای\s*فارسی|فارسی\s*(?:دوبله|صدا)|persian\s*(?:dub|audio|voice)|farsi\s*(?:dub|audio|voice)|fa[-_ ]?(?:dub|audio)|\bdub(?:bed|bing)?\b|dual\s*audio/i.test(text)) {
    return 'dubbed';
  }
  if (/زیر\s*نویس|زير\s*نويس|هارد\s*ساب|سافت\s*ساب|چسبیده|persian\s*sub|farsi\s*sub|fa[-_ ]?sub|\bsub(?:bed|title|titles)?\b/i.test(text)) {
    return 'subtitled';
  }
  return '';
}

function linkLanguage(title = '') {
  const tag = mediaLanguageTag(title);
  if (tag === 'dubbed') return 'دوبله فارسی';
  if (tag === 'subtitled') return 'زیرنویس فارسی';
  return 'لینک‌های دریافت';
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
  const checkpointItems = collapseInvalidatedOperatorDuplicates(splitOperatorCatalogVariants(items))
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
  applyVerifiedPersianTitleOverrides(value);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const clientArtifacts = await writeClientCatalogArtifacts(root, value);
  const manifest = {
    schemaVersion: 2,
    revision: createHash('sha256').update(serialized).digest('hex'),
    clientRevision: clientArtifacts.clientRevision,
    clientItemCount: clientArtifacts.clientItemCount,
    catalogVersion: cleanText(value?.version || CATALOG_VERSION),
    catalogUpdatedAt: cleanText(value?.updatedAt || ''),
    sizeBytes: Buffer.byteLength(serialized),
    clientSizeBytes: clientArtifacts.clientSizeBytes,
    clientIndex: 'catalog-index.json',
    bootstrapRevision: clientArtifacts.bootstrapRevision,
    bootstrapItemCount: clientArtifacts.bootstrapItemCount,
    bootstrapSizeBytes: clientArtifacts.bootstrapSizeBytes,
    bootstrapIndex: 'catalog-bootstrap.json',
    detailBase: 'catalog-items/',
  };
  await fs.writeFile(catalogPath, serialized, 'utf8');
  await writeJson(catalogManifestPath, manifest);
}

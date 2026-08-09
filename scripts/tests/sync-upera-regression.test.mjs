import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const syncScript = path.resolve(testDirectory, '..', 'sync-upera.mjs');
const fetchMock = path.join(testDirectory, 'mock-sync-fetch.mjs');

const initialCatalog = () => ({
  version: 'test',
  updatedAt: new Date(0).toISOString(),
  items: [
    {
      id: 'series-1',
      slug: 'series-series-1',
      type: 'series',
      name: 'Regression Series',
      nameFa: 'سریال آزمون',
      year: 2025,
      poster: 'https://example.test/poster.jpg',
      backdrop: 'https://example.test/backdrop.jpg',
      overview: 'Regression fixture',
      genres: ['درام'],
      people: [
        {
          id: 'legacy-director-1',
          name: 'Legacy Director',
          nameFa: 'کارگردان قدیمی',
          role: 'director',
          source: 'upera',
        },
      ],
      downloads: [
        {
          id: 'episode-1',
          sourceEpisodeId: 'episode-1',
          seasonNumber: 1,
          episodeNumber: 1,
          title: 'قسمت ۱',
          files: [
            {
              id: 'episode-1-720',
              quality: '720p',
              label: '720p',
              url: 'https://cdn.example.test/episode-1.mp4',
              mode: 'download',
            },
          ],
        },
      ],
      episodeCount: 1,
      seasonCount: 1,
      sourceEpisodeCount: 2,
      archivePendingEpisodeCount: 1,
      archivePendingEpisodes: [{ seasonNumber: 1, episodeNumber: 2 }],
      archiveUnavailableEpisodes: [],
      archiveComplete: false,
      archiveAuditStatus: 'checked',
      archiveEpisodeDiscoveryComplete: true,
      archiveEpisodePaginationErrors: 0,
      archiveDiscoveryCheckedAt: new Date().toISOString(),
      publicationStatus: 'building-archive',
      isAiring: false,
    },
  ],
  iranianSchedule: [],
  weeklySchedule: [],
});

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function runSync(cwd, options = {}) {
  await execFileAsync(
    process.execPath,
    ['--import', fetchMock, syncScript],
    {
      cwd,
      env: {
        ...process.env,
        UPERA_REF_ID: 'regression-ref',
        MOCK_SYNC_SCENARIO: options.scenario || 'missing-episode',
        UPERA_SYNC_MODE: options.mode || 'BACKFILL',
        UPERA_REQUEST_DELAY_MS: '1',
        UPERA_MAX_REQUESTS_PER_RUN: '20',
        UPERA_BACKFILL_EPISODES_PER_RUN: '20',
        UPERA_BACKFILL_SERIES_PER_RUN: String(options.backfillSeriesPerRun || 1),
        UPERA_BACKFILL_EPISODES_PER_SERIES: '10',
        MOVIE_PAGES_PER_RUN: '1',
        SERIES_PAGES_PER_RUN: '1',
        UPERA_RECENT_MOVIE_PAGES_PER_RUN: '1',
        UPERA_RECENT_SERIES_PAGES_PER_RUN: '1',
        UPERA_RECENT_MOVIE_TITLES_PER_RUN: '1',
        UPERA_RECENT_SERIES_TITLES_PER_RUN: '1',
        UPERA_RECENT_MOVIE_REQUEST_QUOTA: '1',
        UPERA_RECENT_SERIES_REQUEST_QUOTA: '1',
        UPERA_INCREMENTAL_REQUEST_QUOTA: '1',
        UPERA_AIRING_REQUEST_QUOTA: '1',
        UPERA_ARCHIVE_MOVIE_REQUEST_QUOTA: '1',
        UPERA_ARCHIVE_SERIES_REQUEST_QUOTA: '1',
        UPERA_IRANIAN_SERIES_REQUEST_QUOTA: '1',
        UPERA_OPERATOR_MOVIE_REQUEST_QUOTA: '2',
        UPERA_OPERATOR_SERIES_REQUEST_QUOTA: '1',
        UPERA_IRANIAN_SERIES_PAGES_PER_RUN: '1',
        UPERA_IRANIAN_SERIES_TITLES_PER_RUN: '1',
        UPERA_OPERATOR_SERIES_PAGES_PER_RUN: '1',
        UPERA_OPERATOR_SERIES_TITLES_PER_RUN: '1',
        UPERA_OPERATOR_MOVIE_PAGES_PER_RUN: '1',
        UPERA_OPERATOR_MOVIE_TITLES_PER_RUN: '1',
        UPERA_EPISODE_UNAVAILABLE_AFTER_ATTEMPTS: '3',
        UPERA_UNAVAILABLE_EPISODE_RETRY_HOURS: '168',
        UPERA_RETRY_BLOCKED: 'false',
        APARATCHI_RUN_TIME_LIMIT_MINUTES: '2',
        APARATCHI_CHECKPOINT_RESERVE_MS: '1000',
        APARATCHI_REQUEST_TIMEOUT_MS: '2000',
        APARATCHI_REQUEST_MAX_ATTEMPTS: '2',
        APARATCHI_SYNC_MAX_MIRRORED_IMAGES: '0',
      },
    },
  );
  return {
    catalog: JSON.parse(await fs.readFile(path.join(cwd, 'catalog.json'), 'utf8')),
    manifest: JSON.parse(await fs.readFile(path.join(cwd, 'catalog-manifest.json'), 'utf8')),
    state: JSON.parse(await fs.readFile(path.join(cwd, 'sync-state.json'), 'utf8')),
    report: JSON.parse(await fs.readFile(path.join(cwd, 'sync-report.json'), 'utf8')),
    clientIndex: JSON.parse(await fs.readFile(path.join(cwd, 'catalog-index.json'), 'utf8')),
  };
}

test('a permanent affiliate 404 never falsely completes a gapped archive', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-sync-regression-'));
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), initialCatalog());
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });

  try {
    for (let run = 1; run <= 3; run += 1) {
      const result = await runSync(fixtureDirectory);
      assert.equal(result.report.affiliateRequests, 1);
      assert.equal(result.report.apiRequests, 2, 'detail + one non-retried affiliate 404');
      assert.equal(result.report.affiliateNotFound, 1);
      assert.equal(result.report.errors.length, 0);

      const item = result.catalog.items[0];
      assert.ok(item.people.some((person) => person.id === 'legacy-director-1'), 'previous cast and crew is preserved');
      assert.equal(item.publicationStatus, 'building-archive');
      assert.equal(item.archiveComplete, false);
      assert.equal(item.archivePendingEpisodeCount, 1);
      if (run < 3) assert.equal(item.archiveUnavailableEpisodes.length, 0);
      else assert.equal(item.archiveUnavailableEpisodes.length, 1, 'failure marker is diagnostic only, not completeness');
      assert.equal(result.state.archiveBackfillSeriesId, 'series-1', 'same archive stays active while it is retryable');
    }

    const coolingDown = await runSync(fixtureDirectory);
    assert.equal(Number(coolingDown.report.apiRequests || 0), 0, 'fresh unavailable marker observes retry cooldown');
    assert.equal(coolingDown.catalog.items[0].publicationStatus, 'building-archive');
    assert.equal(coolingDown.catalog.items[0].archiveComplete, false);
    assert.equal(coolingDown.catalog.items[0].archivePendingEpisodeCount, 1);
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test('legacy visible series never disappear while archive backfill is incomplete', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-visible-series-'));
  const fixture = initialCatalog();
  // Simulate an old catalog created before publication-state metadata existed.
  delete fixture.items[0].publicationStatus;
  delete fixture.items[0].archiveAuditStatus;
  delete fixture.items[0].archiveComplete;
  delete fixture.items[0].archivePendingEpisodes;
  delete fixture.items[0].archivePendingEpisodeCount;
  delete fixture.items[0].sourceEpisodeCount;
  delete fixture.items[0].archiveEpisodeDiscoveryComplete;
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), fixture);
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), {});

  try {
    const result = await runSync(fixtureDirectory, { scenario: 'missing-episode' });
    const item = result.catalog.items.find((entry) => entry.id === 'series-1');
    assert.ok(item, 'pre-existing series remains in catalog');
    assert.equal(item.visibilityLocked, true);
    assert.equal(item.publicationStatus, 'published');
    assert.ok(item.downloads.length >= 1);
    assert.equal(result.state.legacySeriesVisibilityMigrationCompleted, true);
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test('a new episode on a published airing series becomes the newest meaningful update', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-airing-update-'));
  const fixture = initialCatalog();
  const item = fixture.items[0];
  item.sourceEpisodeCount = 1;
  item.archivePendingEpisodeCount = 0;
  item.archivePendingEpisodes = [];
  item.archiveComplete = true;
  item.publicationStatus = 'published';
  item.isAiring = true;
  delete item.meaningfulUpdatedAt;
  item.updateLabel = '';
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), fixture);
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });

  try {
    const before = Date.now();
    const result = await runSync(fixtureDirectory, { scenario: 'airing-update', mode: 'NORMAL' });
    const updated = result.catalog.items.find((entry) => entry.id === 'series-1');

    assert.equal(updated?.publicationStatus, 'published');
    assert.equal(updated?.downloads.length, 2);
    assert.equal(updated?.updateLabel, 'قسمت ۲ اضافه شد');
    assert.ok(Date.parse(updated?.meaningfulUpdatedAt || '') >= before);
    assert.equal(result.report.airingSeriesUpdated, 1);
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test('archive backfill never starts a second incomplete series in the same run', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-sequential-series-'));
  const fixture = initialCatalog();
  fixture.items.push({
    ...structuredClone(fixture.items[0]),
    id: 'series-2',
    slug: 'series-series-2',
    name: 'Regression Series Two',
    nameFa: 'سریال آزمون دو',
    downloads: [
      {
        id: 'series2-episode-1',
        sourceEpisodeId: 'series2-episode-1',
        seasonNumber: 1,
        episodeNumber: 1,
        title: 'قسمت ۱',
        files: [
          {
            id: 'series2-episode-1-720',
            quality: '720p',
            label: '720p',
            url: 'https://cdn.example.test/series2-episode-1.mp4',
            mode: 'download',
          },
        ],
      },
    ],
    archivePendingEpisodes: [{ seasonNumber: 1, episodeNumber: 2 }],
  });
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), fixture);
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), {
    legacySeriesVisibilityMigrationCompleted: true,
    archiveBackfillSeriesId: 'series-1',
    archiveBackfillSeriesTitle: 'سریال آزمون',
  });

  try {
    const result = await runSync(fixtureDirectory, {
      scenario: 'sequential-series',
      backfillSeriesPerRun: 6,
    });
    const first = result.catalog.items.find((item) => item.id === 'series-1');
    const second = result.catalog.items.find((item) => item.id === 'series-2');

    assert.equal(first?.publicationStatus, 'published');
    assert.equal(first?.downloads.length, 2);
    assert.equal(second?.publicationStatus, 'building-archive');
    assert.equal(second?.downloads.length, 1, 'second series must remain untouched until the next run');
    assert.equal(result.report.backfillSeriesVisited, 1);
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});


test('one hourly backfill spends its budget on the same series until every discovered episode is complete', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-multi-episode-series-'));
  const fixture = initialCatalog();
  fixture.items[0].sourceEpisodeCount = 7;
  fixture.items[0].archivePendingEpisodeCount = 6;
  fixture.items[0].archivePendingEpisodes = Array.from({ length: 6 }, (_, index) => ({
    seasonNumber: 1,
    episodeNumber: index + 2,
  }));
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), fixture);
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), {
    legacySeriesVisibilityMigrationCompleted: true,
    archiveBackfillSeriesId: 'series-1',
    archiveBackfillSeriesTitle: 'سریال آزمون',
  });

  try {
    const result = await runSync(fixtureDirectory, { scenario: 'multi-episode-series' });
    const item = result.catalog.items.find((entry) => entry.id === 'series-1');
    assert.equal(item?.downloads.length, 7);
    assert.equal(item?.publicationStatus, 'published');
    assert.equal(item?.archiveComplete, true);
    assert.equal(item?.archivePendingEpisodeCount, 0);
    assert.equal(result.report.backfillSeriesVisited, 1);
    assert.equal(result.report.backfillEpisodesAdded, 6);
    assert.equal(result.state.archiveBackfillSeriesId, '');
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test('episode artwork is stored with a newly discovered playable episode', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-episode-artwork-'));
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), initialCatalog());
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });

  try {
    const result = await runSync(fixtureDirectory, { scenario: 'episode-artwork' });
    const secondEpisode = result.catalog.items[0].downloads.find(
      (group) => group.sourceEpisodeId === 'episode-2',
    );
    assert.equal(secondEpisode?.artwork, 'https://example.test/episode-2.jpg');
    assert.ok(secondEpisode?.files.some((file) => file.url === 'https://cdn.example.test/episode-2.mp4'));
    assert.equal(result.manifest.catalogVersion, result.catalog.version);
    assert.equal(result.manifest.catalogUpdatedAt, result.catalog.updatedAt);
    assert.match(result.manifest.revision, /^[a-f0-9]{64}$/);
    assert.ok(result.manifest.sizeBytes > 0);
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test('an explicit redl operator link is preserved as operator-only content', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-operator-regression-'));
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), {
    version: 'test',
    updatedAt: new Date(0).toISOString(),
    items: [],
    iranianSchedule: [],
    weeklySchedule: [],
  });
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });

  try {
    const result = await runSync(fixtureDirectory, {
      mode: 'NORMAL',
      scenario: 'operator-movie',
    });
    const item = result.catalog.items.find((entry) => entry.id === 'operator-movie-1');
    assert.ok(item, 'operator movie was added');
    assert.equal(item.operatorOnly, true);
    assert.equal(item.access, 'operator');
    assert.equal(item.operatorAccess, 'download');
    assert.ok(item.categoryKeys.includes('mobile-operator'));
    const operatorFile = item.downloads.flatMap((section) => section.files).find(
      (file) => file.mode === 'operator-download',
    );
    assert.equal(operatorFile?.url, 'https://redl.ink/aparatchi-mobile-1');
    assert.equal(result.report.operatorMoviesAddedOrUpdated, 1);
    assert.equal(result.report.affiliateRequests, 1, 'the repeated title reuses one affiliate response');
    assert.ok(result.report.affiliateCacheHits >= 1);
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test('a blocked series observes its cooldown and then re-enters the queue', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-blocked-regression-'));
  const fixture = initialCatalog();
  fixture.items[0].archiveAuditStatus = 'blocked';
  fixture.items[0].archiveBlockedAt = new Date().toISOString();
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), fixture);
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });

  try {
    const coolingDown = await runSync(fixtureDirectory);
    assert.equal(Number(coolingDown.report.apiRequests || 0), 0);
    assert.equal(coolingDown.catalog.items[0].archiveAuditStatus, 'blocked');

    coolingDown.catalog.items[0].archiveBlockedAt = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    await writeJson(path.join(fixtureDirectory, 'catalog.json'), coolingDown.catalog);

    const retried = await runSync(fixtureDirectory);
    assert.equal(retried.report.apiRequests, 2);
    assert.equal(retried.catalog.items[0].archiveAuditStatus, 'checked');
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test('people enrichment uses cast and director data from the source API', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-people-regression-'));
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), {
    version: 'test',
    updatedAt: new Date(0).toISOString(),
    items: [
      {
        id: 'people-movie-1',
        type: 'movie',
        name: 'People Movie',
        nameFa: 'فیلم عوامل',
        year: 2026,
        poster: 'https://example.test/people-poster.jpg',
        backdrop: 'https://example.test/people-backdrop.jpg',
        downloads: [],
        people: [],
      },
    ],
    iranianSchedule: [],
    weeklySchedule: [],
  });
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });

  try {
    const result = await runSync(fixtureDirectory, {
      mode: 'PEOPLE',
      scenario: 'people-source',
    });
    const item = result.catalog.items[0];
    assert.equal(item.people.length, 3);
    assert.ok(item.people.some((person) => person.role === 'director'));
    assert.equal(item.peopleEnrichmentStatus, 'complete');
    assert.equal(result.report.peopleEnrichmentSucceeded, 1);
    assert.equal(result.report.peopleEnrichmentFromSource, 1);
    assert.equal(result.report.peopleEnrichmentFailed, 0);
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});


test('paid-only movie media is preserved as a purchase option instead of disappearing', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-paid-movie-'));
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), {
    version: 'test', updatedAt: new Date(0).toISOString(), items: [], iranianSchedule: [], weeklySchedule: [],
  });
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });

  try {
    const result = await runSync(fixtureDirectory, { mode: 'NORMAL', scenario: 'paid-movie' });
    const item = result.catalog.items.find((entry) => entry.id === 'paid-movie-1');
    assert.ok(item, 'paid-only movie stays in the catalog');
    assert.equal(item.access, 'paid');
    assert.equal(item.streamUrl, undefined, 'purchase portal is never treated as a video stream');
    const files = item.downloads.flatMap((section) => section.files || []);
    assert.ok(files.some((file) => file.mode === 'purchase' && file.url.startsWith('https://upera.tv/buy/paid-movie-1')));
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test('dubbed language metadata is detected even when the link title only contains quality', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-dubbed-movie-'));
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), {
    version: 'test', updatedAt: new Date(0).toISOString(), items: [], iranianSchedule: [], weeklySchedule: [],
  });
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });

  try {
    const result = await runSync(fixtureDirectory, { mode: 'NORMAL', scenario: 'dubbed-movie' });
    const item = result.catalog.items.find((entry) => entry.id === 'dubbed-movie-1');
    assert.ok(item);
    const dubbedFile = item.downloads.flatMap((section) => section.files || []).find((file) => file.language === 'dubbed');
    assert.ok(dubbedFile, 'audio_language/dubbed metadata marks the file as dubbed');
    const summary = result.clientIndex.items.find((entry) => entry.id === 'dubbed-movie-1');
    assert.ok(summary?.availableLanguages?.includes('dubbed'), 'lightweight Home index keeps the dubbed badge');
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test('a stale complete series is re-audited once and boilerplate episode names are suppressed', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-series-reaudit-'));
  const fixture = initialCatalog();
  const item = fixture.items[0];
  item.sourceEpisodeCount = 1;
  item.archivePendingEpisodeCount = 0;
  item.archivePendingEpisodes = [];
  item.archiveComplete = true;
  item.archiveAuditStatus = 'checked';
  item.archiveEpisodeDiscoveryComplete = true;
  item.publicationStatus = 'published';
  item.visibilityLocked = true;
  item.archiveCompletenessAuditVersion = 0;
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), fixture);
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });

  try {
    const result = await runSync(fixtureDirectory, { scenario: 'boilerplate-title-audit' });
    const updated = result.catalog.items.find((entry) => entry.id === 'series-1');
    assert.equal(updated?.downloads.length, 2, 'the versioned audit discovers an episode hidden by stale completeness metadata');
    assert.equal(updated?.archiveCompletenessAuditVersion, 2);
    assert.equal(updated?.archiveComplete, true);
    const second = updated?.downloads.find((group) => Number(group.episodeNumber) === 2);
    assert.equal(second?.subtitle, '', 'series-name + episode-number boilerplate is not shown as an episode title');
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});



test('grouped affiliate payloads preserve dubbed and subtitled media buckets', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-grouped-dub-'));
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), {
    version: 'test', updatedAt: new Date(0).toISOString(), items: [], iranianSchedule: [], weeklySchedule: [],
  });
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });

  try {
    const result = await runSync(fixtureDirectory, { mode: 'NORMAL', scenario: 'grouped-dubbed-movie' });
    const item = result.catalog.items.find((entry) => entry.id === 'grouped-dubbed-movie-1');
    assert.ok(item, 'movie from grouped affiliate payload is retained');
    const files = item.downloads.flatMap((section) => section.files || []);
    assert.ok(files.some((file) => file.language === 'dubbed'));
    assert.ok(files.some((file) => file.language === 'subtitled'));
    const summary = result.clientIndex.items.find((entry) => entry.id === 'grouped-dubbed-movie-1');
    assert.ok(summary?.availableLanguages?.includes('dubbed'));
    assert.ok(summary?.availableLanguages?.includes('subtitled'));
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test('oldest production year owns the archive queue before newer titles', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-year-order-'));
  const media = (id) => [{ id: `download-${id}`, files: [{ id: `${id}-720`, mode: 'download', url: `https://cdn.example.test/${id}-old.mp4` }] }];
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), {
    version: 'test', updatedAt: new Date(0).toISOString(),
    items: [
      { id: 'new-movie', type: 'movie', name: 'New Movie', nameFa: 'فیلم جدید', year: 2024, genres: ['درام'], poster: 'https://example.test/new.jpg', backdrop: 'https://example.test/new-bg.jpg', overview: 'fixture', downloads: media('new-movie'), mediaLanguageAuditVersion: 0 },
      { id: 'old-movie', type: 'movie', name: 'Old Movie', nameFa: 'فیلم قدیمی', year: 2015, genres: ['درام'], poster: 'https://example.test/old.jpg', backdrop: 'https://example.test/old-bg.jpg', overview: 'fixture', downloads: media('old-movie'), mediaLanguageAuditVersion: 0 },
    ],
    iranianSchedule: [], weeklySchedule: [],
  });
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });

  try {
    const result = await runSync(fixtureDirectory, { mode: 'BACKFILL', scenario: 'year-order' });
    assert.equal(result.report.affiliateRequests, 1, 'newer title is not touched while the oldest active title still needs retry');
    assert.equal(result.state.archiveBackfillItemId, 'old-movie');
    assert.equal(Number(result.catalog.items.find((entry) => entry.id === 'new-movie')?.mediaLanguageAuditVersion || 0), 0);
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});


test('a zero-media movie cannot freeze an old production year while the repair lane keeps it recoverable', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-zero-media-year-'));
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), {
    version: 'test', updatedAt: new Date(0).toISOString(),
    items: [
      { id: 'old-movie', type: 'movie', name: 'Old Missing Movie', nameFa: 'فیلم قدیمی بدون لینک', year: 2015, genres: ['درام'], poster: 'https://example.test/old.jpg', backdrop: 'https://example.test/old-bg.jpg', overview: 'fixture', downloads: [], mediaLanguageAuditVersion: 0 },
      { id: 'new-movie', type: 'movie', name: 'New Movie', nameFa: 'فیلم جدید', year: 2016, genres: ['درام'], poster: 'https://example.test/new.jpg', backdrop: 'https://example.test/new-bg.jpg', overview: 'fixture', downloads: [], mediaLanguageAuditVersion: 0 },
    ],
    iranianSchedule: [], weeklySchedule: [],
  });
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });

  try {
    const result = await runSync(fixtureDirectory, { mode: 'BACKFILL', scenario: 'year-order-zero-media' });
    const oldMovie = result.catalog.items.find((entry) => entry.id === 'old-movie');
    const newMovie = result.catalog.items.find((entry) => entry.id === 'new-movie');
    assert.equal(oldMovie?.mediaAuditStatus, 'confirmed-unavailable', 'missing old title is hidden instead of pinning the year queue');
    assert.equal(oldMovie?.mediaLanguageAuditVersion, 2);
    assert.ok(newMovie?.downloads?.flatMap((section) => section.files || []).some((file) => /new-movie\.mp4/.test(file.url)), 'the queue advances to the next year in the same run');
    assert.equal(newMovie?.mediaAuditStatus, 'ok');
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test('regional reclassification fixes stale foreign-series metadata and wildlife documentaries without network work', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-reclassify-regression-'));
  const playableEpisode = {
    id: 'westies-e1',
    sourceEpisodeId: 'westies-e1',
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'قسمت ۱',
    files: [{ id: 'westies-e1-720', quality: '720p', label: '720p', url: 'https://cdn.example.test/westies-e1.mp4', mode: 'download' }],
  };
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), {
    version: 'test',
    updatedAt: new Date(0).toISOString(),
    items: [
      {
        id: 'westies', type: 'series', name: 'The Westies', nameFa: 'وستی ها', year: 2026,
        ir: true, originalLanguage: 'en', countryCodes: ['US'], genres: ['درام', 'جنایی'],
        categoryKeys: ['series', 'iranian-series'], categoryLabels: ['مجموعه‌ها', 'سریال ایرانی'],
        downloads: [playableEpisode], sourceEpisodeCount: 1, archivePendingEpisodes: [], archivePendingEpisodeCount: 0,
        archiveComplete: true, archiveAuditStatus: 'checked', archiveEpisodeDiscoveryComplete: true,
        archiveCompletenessAuditVersion: 1, archiveDiscoveryCheckedAt: new Date().toISOString(),
        publicationStatus: 'published', visibilityLocked: true, isAiring: false,
      },
      {
        id: 'leopards', type: 'movie', name: 'Living with Leopards', nameFa: 'زندگی با پلنگ ها', year: 2024,
        ir: false, originalLanguage: 'en', countryCodes: ['GB'], genres: ['مستند'],
        overview: 'A wildlife documentary following leopards in their natural habitat.',
        isDocumentary: true, tmdbValidationVersion: 6,
        categoryKeys: ['movies', 'documentaries'], categoryLabels: ['فیلم‌ها', 'مستند'],
        downloads: [{ id: 'download-original', files: [{ id: 'leo-720', quality: '720p', label: '720p', url: 'https://cdn.example.test/leopards.mp4', mode: 'download' }] }],
      },
    ],
    iranianSchedule: [], weeklySchedule: [],
  });
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });

  try {
    const result = await runSync(fixtureDirectory, { mode: 'BACKFILL', scenario: 'no-network-needed' });
    const westies = result.catalog.items.find((entry) => entry.id === 'westies');
    assert.equal(westies?.ir, false);
    assert.ok(westies?.categoryKeys.includes('foreign-series'));
    assert.ok(!westies?.categoryKeys.includes('iranian-series'));

    const leopards = result.catalog.items.find((entry) => entry.id === 'leopards');
    assert.ok(leopards?.categoryKeys.includes('documentaries'));
    assert.ok(leopards?.categoryKeys.includes('wildlife'));
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

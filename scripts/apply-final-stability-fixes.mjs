import fs from 'node:fs/promises';

const replaceOnce = (text, search, replacement, label) => {
  const index = typeof search === 'string' ? text.indexOf(search) : text.search(search);
  if (index < 0) throw new Error(`Patch target not found: ${label}`);
  if (typeof search === 'string') {
    if (text.indexOf(search, index + search.length) >= 0) throw new Error(`Patch target is not unique: ${label}`);
    return text.slice(0, index) + replacement + text.slice(index + search.length);
  }
  const flags = search.flags.includes('g') ? search.flags : `${search.flags}g`;
  const matches = [...text.matchAll(new RegExp(search.source, flags))];
  if (matches.length !== 1) throw new Error(`Patch target count for ${label}: ${matches.length}`);
  return text.replace(search, replacement);
};

const patchFunction = (source, functionName, nextFunctionName, transform) => {
  const startNeedle = `async function ${functionName}(`;
  const start = source.indexOf(startNeedle);
  if (start < 0) throw new Error(`Function not found: ${functionName}`);
  const next = source.indexOf(`\nasync function ${nextFunctionName}(`, start + startNeedle.length);
  if (next < 0) throw new Error(`Next function not found after ${functionName}: ${nextFunctionName}`);
  const before = source.slice(start, next);
  const after = transform(before);
  if (before === after) throw new Error(`Function patch produced no change: ${functionName}`);
  return source.slice(0, start) + after + source.slice(next);
};

let sync = await fs.readFile('scripts/sync-upera.mjs', 'utf8');

sync = replaceOnce(sync, 'const MEDIA_LANGUAGE_AUDIT_VERSION = 3;', 'const MEDIA_LANGUAGE_AUDIT_VERSION = 4;', 'media language audit version');
sync = replaceOnce(sync, "const CATALOG_VERSION = '0.21.1-media-recovery';", "const CATALOG_VERSION = '0.22.0-final-stability';", 'catalog version');

// Fresh/current series are an independent lane. They are processed first, then
// the oldest-year archive cursor resumes exactly where it stopped.
sync = patchFunction(sync, 'syncRecentSeriesDiscovery', 'syncIranianSeriesPriority', (body) => {
  let next = body.replace(
    /\n\s*\/\/ Never start a second archive[\s\S]*?\n\s*const archiveQueue = buildSequentialBackfillQueue\(\);\n\s*if \(archiveQueue\.length > 0\) \{\n\s*stats\.recentSeriesDeferredByArchiveQueue = candidates\.length;\n\s*return;\n\s*\}\n/,
    '\n  // Fresh/current discovery is independent from archive backfill.\n  stats.recentSeriesDeferredByArchiveQueue = 0;\n',
  );
  if (next === body) throw new Error('Could not remove recent-series archive deferral');

  next = replaceOnce(next, 'for (const { candidate } of selected) {', 'for (const { candidate, existing } of selected) {', 'recent series loop existing state');
  next = replaceOnce(
    next,
    "      const result = await processSeries(candidate, 'recent-discovery', {\n        episodeStrategy: 'latest',\n        episodeLimit: recentSeriesEpisodeLimit,\n        onlyMissing: true,\n      });\n      stats.recentSeriesProcessed += 1;",
    "      const result = await processSeries(candidate, 'recent-discovery', {\n        episodeStrategy: 'latest',\n        episodeLimit: recentSeriesEpisodeLimit,\n        onlyMissing: true,\n      });\n      if (!existing && result?.added) {\n        const added = findExistingItem(candidate, 'series');\n        if (added) {\n          added.meaningfulUpdatedAt = added.meaningfulUpdatedAt || new Date().toISOString();\n          added.updateLabel = 'سریال جدید';\n        }\n      }\n      stats.recentSeriesProcessed += 1;",
    'new series meaningful update',
  );
  next = replaceOnce(
    next,
    "      if (result?.added) {\n        state.recentSeriesCursor = { fingerprint, offset: index + 1 };\n        return;\n      }",
    "      if (result?.added) {\n        state.recentSeriesCursor = { fingerprint, offset: index + 1 };\n      }",
    'recent series early return',
  );
  return next;
});

// Any genuinely added episode is a meaningful update. Metadata-only refreshes
// still do not bump this timestamp.
sync = replaceOnce(
  sync,
  "  const isPublishedAiringEpisodeUpdate = Boolean(\n    addedEpisodes > 0 &&\n    latestAddedEpisode &&\n    existing?.publicationStatus === 'published' &&\n    isAiring &&\n    (source === 'airing-refresh' || source === 'incremental'),\n  );",
  "  const isMeaningfulEpisodeUpdate = Boolean(addedEpisodes > 0 && latestAddedEpisode && existing);\n  const isPublishedAiringEpisodeUpdate = Boolean(\n    isMeaningfulEpisodeUpdate &&\n    existing?.publicationStatus === 'published' &&\n    isAiring &&\n    (source === 'airing-refresh' || source === 'incremental'),\n  );",
  'meaningful episode update definition',
);
sync = replaceOnce(sync, '  if (isPublishedAiringEpisodeUpdate && latestAddedEpisode) {', '  if (isMeaningfulEpisodeUpdate && latestAddedEpisode) {', 'episode update label condition');
sync = replaceOnce(
  sync,
  '      meaningfulUpdatedAt: isPublishedAiringEpisodeUpdate\n        ? new Date().toISOString()\n        : existing?.meaningfulUpdatedAt,',
  '      meaningfulUpdatedAt: isMeaningfulEpisodeUpdate\n        ? new Date().toISOString()\n        : existing?.meaningfulUpdatedAt,',
  'episode meaningful timestamp',
);

// Every episode with usable media is eligible for an exact frame capture even
// when the provider omitted its sourceEpisodeId.
sync = replaceOnce(
  sync,
  '        Number(group?.episodeNumber || 0) > 0 &&\n        cleanText(group?.sourceEpisodeId) &&\n        episodeGroupNeedsGeneratedFrame(item, group, usage),',
  '        Number(group?.episodeNumber || 0) > 0 &&\n        episodeGroupNeedsGeneratedFrame(item, group, usage),',
  'episode frame candidate source id gate',
);

// Re-audit more old movie media per hourly run. Bumping the audit version above
// forces already-seen dubbed titles through the improved language parser again.
sync = replaceOnce(sync, '  const limit = Math.min(72, candidates.length);', '  const limit = Math.min(120, candidates.length);', 'media repair candidate limit');

await fs.writeFile('scripts/sync-upera.mjs', sync, 'utf8');

let client = await fs.readFile('scripts/client-catalog.mjs', 'utf8');
const peopleHelpers = `
const normalizePersonWorkKey = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[^a-z0-9\\u0600-\\u06ff]+/g, ' ')
    .trim();

const peopleWorkKeysForPerson = (person) => {
  const keys = [];
  const tmdbId = Number(person?.tmdbId || 0);
  if (tmdbId > 0) keys.push('tmdb:' + tmdbId);
  for (const value of [person?.name, person?.nameFa]) {
    const normalized = normalizePersonWorkKey(value);
    if (normalized) keys.push('name:' + normalized);
  }
  return [...new Set(keys)];
};
`;
client = replaceOnce(client, '\nexport function clientSummaryForItem(item) {', `${peopleHelpers}\nexport function clientSummaryForItem(item) {`, 'people reverse-index helpers');
client = replaceOnce(client, '  const detailFiles = [];\n  const items = [];', '  const detailFiles = [];\n  const items = [];\n  const peopleWorks = Object.create(null);', 'people works accumulator');
client = replaceOnce(
  client,
  '    items.push(summary);\n    detailFiles.push({ path: summary.detailPath, serialized: detailSerialized });',
  "    items.push(summary);\n    for (const person of Array.isArray(summary.people) ? summary.people : []) {\n      for (const key of peopleWorkKeysForPerson(person)) {\n        if (!peopleWorks[key]) peopleWorks[key] = [];\n        if (!peopleWorks[key].includes(summary.id)) peopleWorks[key].push(summary.id);\n      }\n    }\n    detailFiles.push({ path: summary.detailPath, serialized: detailSerialized });",
  'people works collection',
);
client = replaceOnce(
  client,
  '    featuredPeople: Array.isArray(catalog?.featuredPeople) ? catalog.featuredPeople : [],\n    ...(catalog?.imdbTop100 ? { imdbTop100: catalog.imdbTop100 } : {}),',
  '    featuredPeople: Array.isArray(catalog?.featuredPeople) ? catalog.featuredPeople : [],\n    peopleWorks,\n    ...(catalog?.imdbTop100 ? { imdbTop100: catalog.imdbTop100 } : {}),',
  'people works index payload',
);
await fs.writeFile('scripts/client-catalog.mjs', client, 'utf8');

let workflow = await fs.readFile('.github/workflows/sync-upera.yml', 'utf8');
workflow = replaceOnce(workflow, "          UPERA_MAX_REQUESTS_PER_RUN: '220'", "          UPERA_MAX_REQUESTS_PER_RUN: '300'", 'normal max requests');
workflow = replaceOnce(workflow, "          UPERA_RECENT_SERIES_TITLES_PER_RUN: '80'", "          UPERA_RECENT_SERIES_TITLES_PER_RUN: '4'", 'recent series bounded titles');
workflow = replaceOnce(workflow, "          UPERA_RECENT_SERIES_REQUEST_QUOTA: '72'", "          UPERA_RECENT_SERIES_REQUEST_QUOTA: '96'", 'recent series request quota');
workflow = replaceOnce(workflow, "          UPERA_RECENT_SERIES_EPISODES_PER_TITLE: '48'", "          UPERA_RECENT_SERIES_EPISODES_PER_TITLE: '36'", 'recent series episode limit');
workflow = replaceOnce(workflow, "          UPERA_INCREMENTAL_REQUEST_QUOTA: '32'", "          UPERA_INCREMENTAL_REQUEST_QUOTA: '40'\n          UPERA_MEDIA_REPAIR_REQUEST_QUOTA: '100'", 'media repair quota');
workflow = replaceOnce(workflow, "          APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '18'", "          APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '24'", 'episode artwork series throughput');
workflow = replaceOnce(workflow, "          APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN: '24'", "          APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN: '36'", 'episode frame throughput');
workflow = replaceOnce(workflow, "          UPERA_BLOCKED_RETRY_HOURS: '1'", "          UPERA_BLOCKED_RETRY_HOURS: '6'", 'blocked backfill cooldown');
workflow = replaceOnce(workflow, "          UPERA_RETRY_BLOCKED: 'true'", "          UPERA_RETRY_BLOCKED: 'false'", 'blocked backfill immediate retry');
await fs.writeFile('.github/workflows/sync-upera.yml', workflow, 'utf8');

const test = `import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

test('client index exposes a compact reverse people-to-works map', () => {
  const media = [{ id: 'd', files: [{ id: 'f', mode: 'download', url: 'https://cdn.test/a.mp4' }] }];
  const person = { id: 'actor-1', tmdbId: 123, name: 'Test Actor', nameFa: 'بازیگر تست', role: 'actor' };
  const catalog = {
    version: 'test', updatedAt: 'now', featuredPeople: [],
    items: [
      { id: 'm1', type: 'movie', nameFa: 'یک', name: 'One', people: [person], downloads: media },
      { id: 'm2', type: 'movie', nameFa: 'دو', name: 'Two', people: [person], downloads: media },
    ],
  };
  const { index } = buildClientCatalogArtifacts(catalog);
  assert.deepEqual(index.peopleWorks['tmdb:123'], ['m1', 'm2']);
  assert.deepEqual(index.peopleWorks['name:test actor'], ['m1', 'm2']);
  assert.deepEqual(index.peopleWorks['name:بازیگر تست'], ['m1', 'm2']);
});
`;
await fs.writeFile('scripts/tests/final-stability.test.mjs', test, 'utf8');

console.log('Final Content stability patches applied.');

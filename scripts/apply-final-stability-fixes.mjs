import fs from 'node:fs/promises';

const replaceRequired = (text, pattern, replacement, label) => {
  const next = text.replace(pattern, replacement);
  if (next === text) throw new Error(`Patch target not found: ${label}`);
  return next;
};

const replaceOptional = (text, pattern, replacement, label) => {
  const next = text.replace(pattern, replacement);
  if (next === text) console.log(`Already applied or not needed: ${label}`);
  return next;
};

const patchAsyncFunction = (source, functionName, nextFunctionName, transform) => {
  const startNeedle = `async function ${functionName}(`;
  const start = source.indexOf(startNeedle);
  if (start < 0) throw new Error(`Function not found: ${functionName}`);
  const end = source.indexOf(`\nasync function ${nextFunctionName}(`, start + startNeedle.length);
  if (end < 0) throw new Error(`Next function not found after ${functionName}: ${nextFunctionName}`);
  const before = source.slice(start, end);
  const after = transform(before);
  if (after === before) throw new Error(`Function patch produced no change: ${functionName}`);
  return source.slice(0, start) + after + source.slice(end);
};

let sync = await fs.readFile('scripts/sync-upera.mjs', 'utf8');

sync = replaceOptional(
  sync,
  /const MEDIA_LANGUAGE_AUDIT_VERSION = \d+;/,
  'const MEDIA_LANGUAGE_AUDIT_VERSION = 4;',
  'media language audit version',
);
sync = replaceOptional(
  sync,
  /const CATALOG_VERSION = '[^']+';/,
  "const CATALOG_VERSION = '0.22.0-final-stability';",
  'catalog version',
);

// New/current series must be independent from the old archive lane. Process a
// small bounded batch every NORMAL run, then continue the year-by-year backfill.
sync = patchAsyncFunction(sync, 'syncRecentSeriesDiscovery', 'syncIranianSeriesPriority', (body) => {
  let next = body;
  next = replaceRequired(
    next,
    /\n\s*\/\/ Never start a second archive[\s\S]*?\n\s*const archiveQueue = buildSequentialBackfillQueue\(\);\n\s*if \(archiveQueue\.length > 0\) \{\n\s*stats\.recentSeriesDeferredByArchiveQueue = candidates\.length;\n\s*return;\n\s*\}\n/,
    '\n  // Fresh/current discovery is independent from archive backfill.\n  stats.recentSeriesDeferredByArchiveQueue = 0;\n',
    'recent-series archive deferral',
  );

  next = replaceOptional(
    next,
    /\.slice\(0,\s*1\);/,
    '.slice(0, recentSeriesTitlesPerRun);',
    'recent-series per-run limit',
  );

  next = replaceRequired(
    next,
    /for \(const \{ candidate \} of selected\) \{/,
    'for (const { candidate, existing } of selected) {',
    'recent-series existing state',
  );

  next = replaceRequired(
    next,
    /(\s+const result = await processSeries\(candidate, 'recent-discovery', \{[\s\S]*?\n\s+\}\);)(\n\s+stats\.recentSeriesProcessed \+= 1;)/,
    `$1\n      if (!existing && result?.added) {\n        const added = findExistingItem(candidate, 'series');\n        if (added) {\n          added.meaningfulUpdatedAt = added.meaningfulUpdatedAt || new Date().toISOString();\n          added.updateLabel = 'سریال جدید';\n        }\n      }$2`,
    'new-series meaningful update',
  );

  // Older code stopped after the first successful fresh title. Keep the cursor
  // update, but continue the bounded batch so Iranian/foreign/animation lanes
  // can all make progress in the same hourly run.
  next = replaceOptional(
    next,
    /(if \(result\?\.added\) \{\s*state\.recentSeriesCursor = \{ fingerprint, offset: index \+ 1 \};)\s*return;(\s*\})/,
    '$1$2',
    'recent-series early return',
  );
  return next;
});

// A real episode addition is the only thing that bumps the updated feed. Pure
// metadata/cast/link audits do not reorder the list.
sync = replaceRequired(
  sync,
  /  const isPublishedAiringEpisodeUpdate = Boolean\(\n    addedEpisodes > 0 &&\n    latestAddedEpisode &&\n    existing\?\.publicationStatus === 'published' &&\n    isAiring &&\n    \(source === 'airing-refresh' \|\| source === 'incremental'\),\n  \);/,
  "  const isMeaningfulEpisodeUpdate = Boolean(addedEpisodes > 0 && latestAddedEpisode && existing);\n  const isPublishedAiringEpisodeUpdate = Boolean(\n    isMeaningfulEpisodeUpdate &&\n    existing?.publicationStatus === 'published' &&\n    isAiring &&\n    (source === 'airing-refresh' || source === 'incremental'),\n  );",
  'meaningful episode update definition',
);
sync = replaceRequired(
  sync,
  /  if \(isPublishedAiringEpisodeUpdate && latestAddedEpisode\) \{/,
  '  if (isMeaningfulEpisodeUpdate && latestAddedEpisode) {',
  'episode update label condition',
);
sync = replaceRequired(
  sync,
  /meaningfulUpdatedAt: isPublishedAiringEpisodeUpdate\n\s*\? new Date\(\)\.toISOString\(\)\n\s*: existing\?\.meaningfulUpdatedAt,/,
  'meaningfulUpdatedAt: isMeaningfulEpisodeUpdate\n        ? new Date().toISOString()\n        : existing?.meaningfulUpdatedAt,',
  'episode meaningful timestamp',
);

// If a series episode has playable media it is eligible for its own captured
// frame even when Upera omitted sourceEpisodeId. Never fall back to the series
// poster as an episode image.
sync = replaceOptional(
  sync,
  /Number\(group\?\.episodeNumber \|\| 0\) > 0 &&\n\s*cleanText\(group\?\.sourceEpisodeId\) &&\n\s*episodeGroupNeedsGeneratedFrame\(item, group, usage\),/,
  'Number(group?.episodeNumber || 0) > 0 &&\n        episodeGroupNeedsGeneratedFrame(item, group, usage),',
  'episode-frame source-id gate',
);

// Force old dubbed titles through the current media parser again and increase
// the rotating repair batch without making the phone do any extra work.
sync = replaceOptional(
  sync,
  /const limit = Math\.min\(72, candidates\.length\);/,
  'const limit = Math.min(120, candidates.length);',
  'movie media repair batch',
);

await fs.writeFile('scripts/sync-upera.mjs', sync, 'utf8');

let client = await fs.readFile('scripts/client-catalog.mjs', 'utf8');

if (!client.includes('const peopleWorkKeysForPerson =')) {
  const helpers = `\nconst normalizePersonWorkKey = (value) =>\n  String(value || '')\n    .toLowerCase()\n    .normalize('NFKC')\n    .replace(/[يى]/g, 'ی')\n    .replace(/ك/g, 'ک')\n    .replace(/[^a-z0-9\\u0600-\\u06ff]+/g, ' ')\n    .trim();\n\nconst peopleWorkKeysForPerson = (person) => {\n  const keys = [];\n  const tmdbId = Number(person?.tmdbId || 0);\n  if (tmdbId > 0) keys.push('tmdb:' + tmdbId);\n  for (const value of [person?.name, person?.nameFa]) {\n    const normalized = normalizePersonWorkKey(value);\n    if (normalized) keys.push('name:' + normalized);\n  }\n  return [...new Set(keys)];\n};\n`;
  client = replaceRequired(
    client,
    /\nexport function clientSummaryForItem\(item\) \{/,
    `${helpers}\nexport function clientSummaryForItem(item) {`,
    'people reverse-index helpers',
  );
}

if (!client.includes('const peopleWorks = Object.create(null);')) {
  client = replaceRequired(
    client,
    /  const detailFiles = \[\];\n  const items = \[\];/,
    '  const detailFiles = [];\n  const items = [];\n  const peopleWorks = Object.create(null);',
    'people works accumulator',
  );
}

if (!client.includes('for (const key of peopleWorkKeysForPerson(person))')) {
  client = replaceRequired(
    client,
    /    items\.push\(summary\);\n    detailFiles\.push\(\{ path: summary\.detailPath, serialized: detailSerialized \}\);/,
    "    items.push(summary);\n    for (const person of Array.isArray(summary.people) ? summary.people : []) {\n      for (const key of peopleWorkKeysForPerson(person)) {\n        if (!peopleWorks[key]) peopleWorks[key] = [];\n        if (!peopleWorks[key].includes(summary.id)) peopleWorks[key].push(summary.id);\n      }\n    }\n    detailFiles.push({ path: summary.detailPath, serialized: detailSerialized });",
    'people works collection',
  );
}

if (!/\n\s*peopleWorks,\n/.test(client)) {
  client = replaceRequired(
    client,
    /    featuredPeople: Array\.isArray\(catalog\?\.featuredPeople\) \? catalog\.featuredPeople : \[\],\n/,
    '    featuredPeople: Array.isArray(catalog?.featuredPeople) ? catalog.featuredPeople : [],\n    peopleWorks,\n',
    'people works index payload',
  );
}
await fs.writeFile('scripts/client-catalog.mjs', client, 'utf8');

let workflow = await fs.readFile('.github/workflows/sync-upera.yml', 'utf8');
const envReplace = (name, value) => {
  const pattern = new RegExp(`(\\n\\s+${name}: )'[^']*'`);
  const next = workflow.replace(pattern, `$1'${value}'`);
  if (next === workflow) throw new Error(`Workflow env not found: ${name}`);
  workflow = next;
};
envReplace('UPERA_MAX_REQUESTS_PER_RUN', '300');
envReplace('UPERA_RECENT_SERIES_TITLES_PER_RUN', '4');
envReplace('UPERA_RECENT_SERIES_REQUEST_QUOTA', '96');
envReplace('UPERA_RECENT_SERIES_EPISODES_PER_TITLE', '36');
envReplace('UPERA_INCREMENTAL_REQUEST_QUOTA', '40');
if (!workflow.includes('UPERA_MEDIA_REPAIR_REQUEST_QUOTA:')) {
  workflow = replaceRequired(
    workflow,
    /(\n\s+UPERA_INCREMENTAL_REQUEST_QUOTA: '40')/,
    "$1\n          UPERA_MEDIA_REPAIR_REQUEST_QUOTA: '100'",
    'media repair quota',
  );
}
envReplace('APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN', '24');
envReplace('APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN', '36');
envReplace('UPERA_BLOCKED_RETRY_HOURS', '6');
envReplace('UPERA_RETRY_BLOCKED', 'false');
await fs.writeFile('.github/workflows/sync-upera.yml', workflow, 'utf8');

const test = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { buildClientCatalogArtifacts } from '../client-catalog.mjs';\n\ntest('client index exposes a compact reverse people-to-works map', () => {\n  const media = [{ id: 'd', files: [{ id: 'f', mode: 'download', url: 'https://cdn.test/a.mp4' }] }];\n  const person = { id: 'actor-1', tmdbId: 123, name: 'Test Actor', nameFa: 'بازیگر تست', role: 'actor' };\n  const catalog = {\n    version: 'test', updatedAt: 'now', featuredPeople: [],\n    items: [\n      { id: 'm1', type: 'movie', nameFa: 'یک', name: 'One', people: [person], downloads: media },\n      { id: 'm2', type: 'movie', nameFa: 'دو', name: 'Two', people: [person], downloads: media },\n    ],\n  };\n  const { index } = buildClientCatalogArtifacts(catalog);\n  assert.deepEqual(index.peopleWorks['tmdb:123'], ['m1', 'm2']);\n  assert.deepEqual(index.peopleWorks['name:test actor'], ['m1', 'm2']);\n  assert.deepEqual(index.peopleWorks['name:بازیگر تست'], ['m1', 'm2']);\n});\n`;
await fs.writeFile('scripts/tests/final-stability.test.mjs', test, 'utf8');

console.log('Final Content stability patches applied.');

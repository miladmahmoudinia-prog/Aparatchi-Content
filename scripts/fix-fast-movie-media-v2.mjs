import fs from 'node:fs/promises';

const read = (path) => fs.readFile(path, 'utf8');
const write = (path, content) => fs.writeFile(path, content, 'utf8');
const replaceOnce = (source, before, after, label) => {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(before, after);
};

let client = await read('scripts/client-catalog.mjs');

const oldConflictBlock = `  const conflicts = new Set([...languagesByUrl.entries()]\n    .filter(([, set]) => set.has('dubbed') && set.has('subtitled'))\n    .map(([url]) => url));\n\n  const downloads = prepared.flatMap((section) => {\n    const files = (section.files || []).filter((file) => !conflicts.has(String(file.url || '').trim()));\n    if (!files.length) return [];\n    const languages = [...new Set(files.map((file) => file.language).filter((value) => value === 'dubbed' || value === 'subtitled'))];\n    if (languages.length === 1 && !Number(section?.episodeNumber || 0)) {\n      const language = languages[0];\n      return [{\n        ...section,\n        title: language === 'dubbed' ? 'دوبله فارسی' : 'زیرنویس فارسی',\n        badge: language === 'dubbed' ? 'دوبله' : 'زیرنویس',\n        language,\n        files,\n      }];\n    }\n    return [{ ...section, files }];\n  });`;

const newConflictBlock = `  const conflicts = new Set([...languagesByUrl.entries()]\n    .filter(([, set]) => set.has('dubbed') && set.has('subtitled'))\n    .map(([url]) => url));\n\n  // A contradictory language label must not make a real Upera media URL vanish.\n  // Keep one neutral representative for each conflicted URL instead of deleting\n  // the playable/downloadable media altogether. The neutral row is deliberately\n  // separated from dubbed/subtitled sections so the mobile client cannot infer a\n  // false language from the old section title.\n  const conflictRepresentativeByUrl = new Map();\n  const conflictScore = (file) => {\n    const mode = String(file?.mode || 'download');\n    if (mode === 'download') return 3;\n    if (mode === 'play') return 2;\n    return 1;\n  };\n  for (const section of prepared) {\n    for (const file of section.files || []) {\n      const url = String(file?.url || '').trim();\n      if (!conflicts.has(url)) continue;\n      const current = conflictRepresentativeByUrl.get(url);\n      if (!current || conflictScore(file) > conflictScore(current)) conflictRepresentativeByUrl.set(url, file);\n    }\n  }\n  const emittedConflictUrls = new Set();\n\n  const downloads = prepared.flatMap((section) => {\n    const files = (section.files || []).filter((file) => !conflicts.has(String(file.url || '').trim()));\n    const neutralFiles = [];\n    for (const file of section.files || []) {\n      const url = String(file?.url || '').trim();\n      if (!conflicts.has(url) || emittedConflictUrls.has(url)) continue;\n      if (conflictRepresentativeByUrl.get(url) !== file) continue;\n      emittedConflictUrls.add(url);\n      neutralFiles.push({ ...file, language: undefined });\n    }\n\n    const result = [];\n    if (files.length) {\n      const languages = [...new Set(files.map((file) => file.language).filter((value) => value === 'dubbed' || value === 'subtitled'))];\n      if (languages.length === 1 && !Number(section?.episodeNumber || 0)) {\n        const language = languages[0];\n        result.push({\n          ...section,\n          title: language === 'dubbed' ? 'دوبله فارسی' : 'زیرنویس فارسی',\n          badge: language === 'dubbed' ? 'دوبله' : 'زیرنویس',\n          language,\n          files,\n        });\n      } else {\n        result.push({ ...section, files });\n      }\n    }\n\n    if (neutralFiles.length) {\n      result.push({\n        ...section,\n        id: \`${'${String(section?.id || "media")}'}-neutral\`,\n        title: Number(section?.episodeNumber || 0) ? \`قسمت ${'${Number(section.episodeNumber)}'}\` : 'نسخه قابل پخش',\n        badge: undefined,\n        language: undefined,\n        files: neutralFiles,\n      });\n    }\n    return result;\n  });`;

client = replaceOnce(client, oldConflictBlock, newConflictBlock, 'neutralize contradictory language media');

const summaryMarker = `export function clientSummaryForItem(item) {\n  const summary = {};`;
const summaryHelper = `const compactMovieDownloadsForSummary = (downloads) => (Array.isArray(downloads) ? downloads : []).flatMap((section) => {\n  const files = (Array.isArray(section?.files) ? section.files : [])\n    .filter(clientSeriesFileIsUsable)\n    .map((file) => {\n      const compact = {};\n      for (const key of ['id', 'label', 'quality', 'size', 'url', 'mode', 'language', 'operatorOnly', 'panelVerified', 'trafficOo']) {\n        if (file?.[key] !== undefined && file?.[key] !== null && file?.[key] !== '') compact[key] = file[key];\n      }\n      return compact;\n    });\n  if (!files.length) return [];\n  const compactSection = { files };\n  for (const key of ['id', 'title', 'badge', 'language']) {\n    if (section?.[key] !== undefined && section?.[key] !== null && section?.[key] !== '') compactSection[key] = section[key];\n  }\n  return [compactSection];\n});\n\n${summaryMarker}`;
client = replaceOnce(client, summaryMarker, summaryHelper, 'insert compact movie media helper');

client = replaceOnce(
  client,
  `  if (summary.overview) summary.overview = truncateOverview(summary.overview);\n  summary.availableLanguages = deriveClientLanguages(item);`,
  `  if (summary.overview) summary.overview = truncateOverview(summary.overview);\n  summary.availableLanguages = deriveClientLanguages(item);\n\n  // Movie detail actions should be usable from the lightweight index itself.\n  // Carry only the small, actionable media rows for movies; series episode\n  // archives remain detail-sharded so the client index stays bounded.\n  if (item?.type === 'movie') {\n    const compactDownloads = compactMovieDownloadsForSummary(item.downloads);\n    if (compactDownloads.length) summary.downloads = compactDownloads;\n    if (item.ir === true && /^https?:\\/\\//i.test(String(item.streamUrl || '').trim())) {\n      summary.streamUrl = item.streamUrl;\n      if (item.streamMode) summary.streamMode = item.streamMode;\n    }\n  }`,
  'add compact movie media to summary',
);

await write('scripts/client-catalog.mjs', client);

let tests = await read('scripts/tests/client-catalog.test.mjs');
tests = replaceOnce(
  tests,
  `test('client summary carries lightweight dubbing and subtitle badges without media payloads', () => {`,
  `test('client movie summary carries lightweight actionable media with language badges', () => {`,
  'rename movie summary test',
);
tests = replaceOnce(
  tests,
  `  assert.deepEqual(summary.availableLanguages, ['dubbed', 'subtitled']);\n  assert.equal('downloads' in summary, false);\n});\n\ntest('client summary recognizes language from lightweight file metadata and carries collection identity'`,
  `  assert.deepEqual(summary.availableLanguages, ['dubbed', 'subtitled']);\n  assert.ok(Array.isArray(summary.downloads) && summary.downloads.length === 2);\n  assert.equal(summary.downloads.flatMap((section) => section.files || []).length, 2);\n});\n\ntest('client summary recognizes language from lightweight file metadata and carries collection identity'`,
  'movie summary now includes compact media',
);
await write('scripts/tests/client-catalog.test.mjs', tests);

console.log(JSON.stringify({
  contradictoryLanguageUrlsStayPlayableAsNeutral: true,
  movieSummariesCarryActionableMedia: true,
  seriesSummariesRemainMediaSharded: true,
  noApkBuild: true,
}, null, 2));

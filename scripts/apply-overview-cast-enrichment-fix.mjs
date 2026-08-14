import fs from 'node:fs/promises';
import path from 'node:path';

const target = 'scripts/enrich-tmdb.mjs';
let source = await fs.readFile(target, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Missing patch target: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`      append_to_response: 'aggregate_credits,keywords,images',`,
`      append_to_response: 'aggregate_credits,keywords,images,translations',`,
  'TV translations response',
);
replaceOnce(
`    append_to_response: 'credits,keywords,images',`,
`    append_to_response: 'credits,keywords,images,translations',`,
  'movie translations response',
);

replaceOnce(
`  const originalLanguage = cleanText(details?.original_language || item?.originalLanguage).toLowerCase();
  const posterPath = cleanText(details?.poster_path) || bestTmdbImagePath(details?.images?.posters, 'poster');`,
`  const originalLanguage = cleanText(details?.original_language || item?.originalLanguage).toLowerCase();
  const translations = Array.isArray(details?.translations?.translations)
    ? details.translations.translations
    : [];
  const persianTranslation = translations.find((entry) =>
    cleanText(entry?.iso_639_1).toLowerCase() === 'fa' ||
    cleanText(entry?.iso_3166_1).toUpperCase() === 'IR'
  );
  const translatedOverview = cleanText(persianTranslation?.data?.overview);
  const overview = translatedOverview || cleanText(details?.overview);
  const posterPath = cleanText(details?.poster_path) || bestTmdbImagePath(details?.images?.posters, 'poster');`,
  'derive translated overview',
);

replaceOnce(
`    originalLanguage,
    ...(posterFallback ? { posterFallback } : {}),`,
`    originalLanguage,
    ...(overview ? { overview } : {}),
    ...(posterFallback ? { posterFallback } : {}),`,
  'overview metadata field',
);

replaceOnce(
`    originalLanguage: item.originalLanguage,
    poster: item.poster,`,
`    originalLanguage: item.originalLanguage,
    overview: item.overview,
    poster: item.poster,`,
  'before snapshot overview',
);

replaceOnce(
`  if (originalLanguage) item.originalLanguage = originalLanguage;
  if (metadata.collectionId) item.collectionId = cleanText(metadata.collectionId);`,
`  if (originalLanguage) item.originalLanguage = originalLanguage;
  const metadataOverview = cleanText(metadata.overview);
  if (!cleanText(item.overview) && metadataOverview) item.overview = metadataOverview;
  if (metadata.collectionId) item.collectionId = cleanText(metadata.collectionId);`,
  'apply missing overview',
);

const firstOverviewSnapshot = source.indexOf('overview: item.overview,');
const secondSnapshotAnchor = source.indexOf('  const after = JSON.stringify({');
if (secondSnapshotAnchor < 0) throw new Error('Missing after snapshot');
const secondOverviewSnapshot = source.indexOf('overview: item.overview,', secondSnapshotAnchor);
if (secondOverviewSnapshot < 0) {
  const anchor = `    originalLanguage: item.originalLanguage,\n    poster: item.poster,`;
  const pos = source.indexOf(anchor, secondSnapshotAnchor);
  if (pos < 0) throw new Error('Missing after snapshot overview anchor');
  source = source.slice(0, pos) + `    originalLanguage: item.originalLanguage,\n    overview: item.overview,\n    poster: item.poster,` + source.slice(pos + anchor.length);
}
if (firstOverviewSnapshot < 0) throw new Error('Missing before overview snapshot');

await fs.writeFile(target, source, 'utf8');

const regressionPath = path.join('scripts', 'tests', 'overview-cast-enrichment.test.mjs');
const regression = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../enrich-tmdb.mjs', import.meta.url), 'utf8');

test('TMDB details include translations together with cast and crew', () => {
  assert.ok(source.includes("append_to_response: 'aggregate_credits,keywords,images,translations'"));
  assert.ok(source.includes("append_to_response: 'credits,keywords,images,translations'"));
  assert.ok(source.includes('function buildTmdbPeople(details, mediaType)'));
});

test('missing overview prefers Persian TMDB translation and falls back to TMDB overview', () => {
  assert.ok(source.includes("cleanText(entry?.iso_639_1).toLowerCase() === 'fa'"));
  assert.ok(source.includes('const overview = translatedOverview || cleanText(details?.overview);'));
  assert.ok(source.includes('...(overview ? { overview } : {})'));
});

test('enrichment never overwrites an existing catalog overview', () => {
  assert.ok(source.includes('if (!cleanText(item.overview) && metadataOverview) item.overview = metadataOverview;'));
  assert.ok(!source.includes('item.overview = metadataOverview;\n  if (metadataOverview)'));
});
`;
await fs.writeFile(regressionPath, regression, 'utf8');

console.log('Applied overview + cast/crew enrichment regression fix.');

import fs from 'node:fs/promises';

const replaceOnce = (source, before, after, label) => {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(before, after);
};

let classification = await fs.readFile('scripts/classification.mjs', 'utf8');

classification = replaceOnce(
  classification,
  `  'squirrel', 'squirrels', 'otter', 'otters', 'rodent', 'rodents',\n  'پلنگ', 'یوزپلنگ', 'شیرها', 'ببرها', 'گرگ ها', 'گرگ‌ها', 'خرس ها', 'خرس‌ها',`,
  `  'squirrel', 'squirrels', 'otter', 'otters', 'rodent', 'rodents',\n  'snake', 'snakes', 'crocodile', 'crocodiles', 'alligator', 'alligators',\n  'پلنگ', 'یوزپلنگ', 'شیرها', 'ببرها', 'گرگ ها', 'گرگ‌ها', 'خرس ها', 'خرس‌ها',\n  'مار', 'مارها', 'تمساح', 'تمساح‌ها', 'کروکودیل', 'کروکودیل‌ها',`,
  'wildlife snake/crocodile subjects',
);

classification = replaceOnce(
  classification,
  `  // Documentary identity is a content type, not the absence of dramatic genres.\n  // Episodic documentaries can legitimately carry Drama/War/etc. and must not\n  // fall into Iranian/foreign series merely because another genre is present.\n  const isDocumentary = knownNarrativeMovie\n    ? false\n    : Boolean(knownDocumentary || explicitDocumentary || documentaryGenre);`,
  `  // Once TMDB has positively validated a narrative/animation identity, stale\n  // legacy documentary flags must not keep the title trapped in Documentaries.\n  // Genuine documentaries still stay documentary when TMDB itself says so.\n  const trustedNonDocumentary = Boolean(\n    trustedTmdb &&\n    !documentaryGenre &&\n    (narrativeGenre || isAnimation)\n  );\n  const isDocumentary = knownNarrativeMovie || trustedNonDocumentary\n    ? false\n    : Boolean(knownDocumentary || explicitDocumentary || documentaryGenre);`,
  'trusted non-documentary beats stale documentary flags',
);

classification = replaceOnce(
  classification,
  `  const originalLanguage = normalize(input.originalLanguage);\n  const countryCodes = (Array.isArray(input.countryCodes) ? input.countryCodes : [])\n    .map((code) => clean(code).toUpperCase()).filter(Boolean);\n  const primaryCountry = countryCodes[0] || '';\n  const iranianIdentity = originalLanguage === 'fa' || primaryCountry === 'IR' ||\n    (!originalLanguage && !primaryCountry && input.ir === true);\n  const koreanIdentity = originalLanguage === 'ko' || primaryCountry === 'KR';\n  const indianIdentity = indianLanguages.has(originalLanguage) || primaryCountry === 'IN';`,
  `  const originalLanguage = normalize(input.originalLanguage);\n  const countryCodes = (Array.isArray(input.countryCodes) ? input.countryCodes : [])\n    .map((code) => clean(code).toUpperCase()).filter(Boolean);\n  // Explicit country metadata is authoritative. Original language is only a\n  // fallback when the provider/TMDB did not supply any country at all; otherwise\n  // a stale language or legacy ir=true flag can wrongly turn foreign films Iranian.\n  const hasCountryIdentity = countryCodes.length > 0;\n  const iranianIdentity = hasCountryIdentity\n    ? countryCodes.includes('IR')\n    : (originalLanguage === 'fa' || input.ir === true);\n  const koreanIdentity = hasCountryIdentity\n    ? countryCodes.includes('KR')\n    : originalLanguage === 'ko';\n  const indianIdentity = hasCountryIdentity\n    ? countryCodes.includes('IN')\n    : indianLanguages.has(originalLanguage);`,
  'country metadata beats stale language/ir identity',
);

await fs.writeFile('scripts/classification.mjs', classification, 'utf8');

let client = await fs.readFile('scripts/client-catalog.mjs', 'utf8');
client = replaceOnce(
  client,
  `  const candidates = item?.type === 'series'\n    ? [\n        item?.meaningfulUpdatedAt,\n        item?.firstSeenAt,\n        item?.sourceUpdatedAt,\n        item?.sourceCreatedAt,\n        item?.updatedAt,\n        item?.createdAt,\n      ]\n    : [\n        item?.firstSeenAt,\n        item?.sourceCreatedAt,\n        item?.createdAt,\n        item?.sourceUpdatedAt,\n        item?.updatedAt,\n      ];`,
  `  const candidates = item?.type === 'series'\n    ? [\n        item?.meaningfulUpdatedAt,\n        item?.firstSeenAt,\n        item?.sourceCreatedAt,\n        item?.createdAt,\n      ]\n    : [\n        item?.firstSeenAt,\n        item?.sourceCreatedAt,\n        item?.createdAt,\n      ];`,
  'real content freshness ordering',
);

client = replaceOnce(
  client,
  `  'poster', 'posterFallback', 'rate', 'access', 'operatorOnly', 'availableLanguages',`,
  `  'poster', 'posterFallback', 'backdrop', 'backdropFallback', 'rate', 'access', 'operatorOnly', 'availableLanguages',`,
  'bootstrap backdrop metadata',
);
await fs.writeFile('scripts/client-catalog.mjs', client, 'utf8');

let workflow = await fs.readFile('.github/workflows/sync-upera.yml', 'utf8');
workflow = replaceOnce(workflow, `          APARATCHI_RUN_TIME_LIMIT_MINUTES: '6'`, `          APARATCHI_RUN_TIME_LIMIT_MINUTES: '10'`, 'people/artwork time budget');
workflow = replaceOnce(workflow, `          APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '24'`, `          APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '48'`, 'episode artwork series budget');
workflow = replaceOnce(workflow, `          APARATCHI_EPISODE_ARTWORK_MIRROR_PER_RUN: '36'`, `          APARATCHI_EPISODE_ARTWORK_MIRROR_PER_RUN: '72'`, 'episode artwork mirror budget');
workflow = replaceOnce(workflow, `          APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN: '36'`, `          APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN: '96'`, 'episode frame capture budget');
workflow = replaceOnce(workflow, `          APARATCHI_SYNC_MAX_MIRRORED_IMAGES: '72'`, `          APARATCHI_SYNC_MAX_MIRRORED_IMAGES: '144'`, 'episode artwork image budget');
await fs.writeFile('.github/workflows/sync-upera.yml', workflow, 'utf8');

const regression = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { classifyCatalogItem } from '../classification.mjs';\nimport { buildClientCatalogArtifacts } from '../client-catalog.mjs';\n\nconst classify = (overrides = {}) => classifyCatalogItem({\n  type: 'movie', name: 'Sample', nameFa: 'نمونه', genres: ['Drama'],\n  originalLanguage: 'en', countryCodes: ['US'], tmdbValidationVersion: 7,\n  ...overrides,\n});\n\nconst playableMovie = (id, freshness, extra = {}) => ({\n  id, slug: id, type: 'movie', name: id, nameFa: id, ir: false,\n  categoryKeys: ['movies', 'foreign-movies'], categoryLabels: ['فیلم‌ها', 'فیلم خارجی'],\n  firstSeenAt: freshness.firstSeenAt, sourceCreatedAt: freshness.sourceCreatedAt,\n  createdAt: freshness.createdAt, updatedAt: freshness.updatedAt, sourceUpdatedAt: freshness.sourceUpdatedAt,\n  poster: 'https://example.test/' + id + '.jpg', backdrop: 'https://example.test/' + id + '-backdrop.jpg',\n  downloads: [{ id: id + '-media', files: [{ id: id + '-file', mode: 'download', url: 'https://cdn.test/' + id + '.mp4' }] }],\n  ...extra,\n});\n\ntest('trusted narrative and animation titles escape stale documentary flags', () => {\n  for (const sample of [\n    { name: 'The Bikeriders', genres: ['Crime', 'Drama'] },\n    { name: 'Miracles from Heaven', genres: ['Drama', 'Family'] },\n  ]) {\n    const result = classify({ ...sample, isDocumentary: true, contentKind: 'documentary', categoryKeys: ['documentaries'] });\n    assert.equal(result.isDocumentary, false);\n    assert.ok(result.categoryKeys.includes('foreign-movies'));\n    assert.ok(!result.categoryKeys.includes('documentaries'));\n  }\n  const minions = classify({\n    name: 'Minions: The Rise of Gru', genres: ['Animation', 'Comedy', 'Family'],\n    isAnimation: true, isDocumentary: true, contentKind: 'documentary', categoryKeys: ['documentaries'],\n  });\n  assert.equal(minions.isDocumentary, false);\n  assert.ok(minions.categoryKeys.includes('animation-movies'));\n  assert.ok(!minions.categoryKeys.includes('documentaries'));\n});\n\ntest('snake, crocodile and alligator documentaries route to Wildlife', () => {\n  for (const name of ['The Ultimate Guide: Snakes', 'Safari: The Alligator & American Crocodile']) {\n    const result = classify({ name, genres: ['Documentary'], isDocumentary: true });\n    assert.equal(result.isWildlife, true);\n    assert.ok(result.categoryKeys.includes('wildlife'));\n    assert.ok(!result.categoryKeys.includes('documentaries'));\n  }\n});\n\ntest('explicit country beats stale language and legacy Iranian flags', () => {\n  const son = classify({ name: 'The Son', originalLanguage: 'fa', countryCodes: ['US', 'GB'], ir: true });\n  assert.equal(son.ir, false);\n  assert.ok(son.categoryKeys.includes('foreign-movies'));\n  const moon = classify({ name: 'The Moon', originalLanguage: 'ko', countryCodes: ['KR'], ir: true });\n  assert.equal(moon.ir, false);\n  assert.ok(moon.categoryKeys.includes('korean-movies'));\n});\n\ntest('catalog ordering uses discovery and meaningful episode freshness, not metadata touch timestamps', () => {\n  const oldTouched = playableMovie('old-touched', {\n    firstSeenAt: '2026-07-01T00:00:00.000Z', sourceCreatedAt: '2026-07-01T00:00:00.000Z',\n    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-08-17T23:00:00.000Z', sourceUpdatedAt: '2026-08-17T23:00:00.000Z',\n  });\n  const newlyAdded = playableMovie('newly-added', {\n    firstSeenAt: '2026-08-17T22:00:00.000Z', sourceCreatedAt: '2026-01-01T00:00:00.000Z',\n    createdAt: '2026-08-17T22:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', sourceUpdatedAt: '2026-01-01T00:00:00.000Z',\n  });\n  const catalog = { version: 'ordering-v11', updatedAt: '2026-08-17T23:30:00.000Z', items: [oldTouched, newlyAdded], imdbTop100: { movies: [], series: [] } };\n  const artifacts = buildClientCatalogArtifacts(catalog);\n  assert.equal(artifacts.index.items[0].id, 'newly-added');\n  assert.equal(artifacts.bootstrap.items[0].id, 'newly-added');\n  assert.equal(artifacts.bootstrap.items[0].backdrop, newlyAdded.backdrop);\n});\n`;
await fs.writeFile('scripts/tests/user-report-v11.test.mjs', regression, 'utf8');

console.log(JSON.stringify({
  classificationRootFixes: true,
  wildlifeSnakesAndCrocodiles: true,
  countryAuthority: true,
  realFreshnessOrdering: true,
  bootstrapBackdrop: true,
  episodeArtworkBackfillAccelerated: true,
}, null, 2));

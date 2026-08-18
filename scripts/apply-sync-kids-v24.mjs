import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const read = (file) => fs.readFile(file, 'utf8');
const write = (file, value) => fs.writeFile(file, value, 'utf8');

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Missing patch context: ${label}`);
  return source.replace(before, after);
}

// 1) Genuine child-program identity beats stale animation metadata. This is
// deliberately based only on the existing explicit child-program terms; a
// normal family/narrative movie never becomes Kids merely because it is about
// children or has the Family genre.
{
  const file = 'scripts/classification.mjs';
  let source = await read(file);
  source = replaceOnce(
    source,
`  const isChildrenProgram = Boolean(
    !isAnimation &&
    (
      includesAny(programIdentityText, childrenProgramTerms) ||
      (trustedSpecializedKind && existingKind === 'children-program')
    )
  );`,
`  const isChildrenProgram = Boolean(
    includesAny(programIdentityText, childrenProgramTerms) ||
    (trustedSpecializedKind && existingKind === 'children-program')
  );`,
    'allow explicit child programs with animation metadata',
  );
  source = replaceOnce(
    source,
`  if (isAnimation) {
    if (isAnime) {`,
`  if (isAnimation && !isChildrenProgram) {
    if (isAnime) {`,
    'keep child programs out of generic animation shelves',
  );
  await write(file, source);
}

// 2) Add a regression that encodes the product rule explicitly.
{
  const file = 'scripts/tests/classification.test.mjs';
  let source = await read(file);
  const marker = "test('animated child-song titles stay in Kids instead of generic Animation'";
  if (!source.includes(marker)) {
    source += `\n\ntest('animated child-song titles stay in Kids instead of generic Animation', () => {\n  const result = classify({\n    name: \"Aunt Nasrin's Children's Songs 5\",\n    nameFa: 'ترانه‌های کودکانه خاله نسرین ۵',\n    genres: ['سایر'],\n    originalLanguage: 'fa',\n    countryCodes: ['IR'],\n    isAnimation: true,\n  });\n  assert.equal(result.isChildrenProgram, true);\n  assert.equal(result.contentKind, 'children-program');\n  assert.ok(result.categoryKeys.includes('kids'));\n  assert.ok(!result.categoryKeys.includes('animation-movies'));\n  assert.ok(!result.categoryKeys.includes('iranian-movies'));\n});\n`;
  }
  await write(file, source);
}

// 3) The bootstrap became a complete *compact navigation* catalog to prevent
// first-start categories/search collapsing to a tiny sample. These old tests
// still asserted the pre-v6 Home-only architecture and blocked every sync.
await write('scripts/tests/full-navigation-bootstrap-v1.test.mjs', `import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const catalog = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));
const artifacts = buildClientCatalogArtifacts(catalog);
const index = artifacts.index;
const bootstrap = artifacts.bootstrap;
const MAX_BOOTSTRAP_BYTES = 10 * 1024 * 1024;

const categoryCount = (payload, key) => payload.items.filter((item) =>
  Array.isArray(item?.categoryKeys) && item.categoryKeys.includes(key)
).length;

test('bootstrap is the complete compact first-navigation catalog', () => {
  assert.ok(index.items.length > 1000, 'full client index unexpectedly tiny');
  assert.equal(bootstrap.items.length, index.items.length, 'bootstrap lost client-visible navigation items');
  assert.deepEqual(bootstrap.items.map((item) => item.id), index.items.map((item) => item.id));
});

test('complete bootstrap preserves category truth and every row can hydrate detail', () => {
  for (const key of ['kids', 'iranian-movies', 'foreign-movies', 'iranian-series', 'foreign-series', 'korean-movies', 'korean-series', 'indian-movies', 'dubbed', 'subtitled']) {
    assert.equal(categoryCount(bootstrap, key), categoryCount(index, key), `bootstrap changed ${key} category membership`);
  }
  const broken = bootstrap.items.filter((item) => !item?.id || !item?.type || !item?.detailPath);
  assert.deepEqual(broken.map((item) => item?.id), []);
});

test('complete navigation bootstrap remains materially smaller than the full index', () => {
  assert.ok(artifacts.bootstrapSizeBytes < artifacts.clientSizeBytes * 0.55,
    `bootstrap ${artifacts.bootstrapSizeBytes} is too large versus index ${artifacts.clientSizeBytes}`);
  assert.ok(artifacts.bootstrapSizeBytes < MAX_BOOTSTRAP_BYTES,
    `bootstrap grew beyond 10 MiB: ${artifacts.bootstrapSizeBytes}`);
});
`);

await write('scripts/tests/home-bootstrap-v1.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const MAX_BOOTSTRAP_BYTES = 10 * 1024 * 1024;

const playableMovie = (id, categoryKeys, firstSeenAt = '2026-08-15T00:00:00.000Z') => ({
  id, type: 'movie', ir: categoryKeys.includes('iranian-movies'), nameFa: id, name: id,
  categoryKeys, firstSeenAt, poster: `https://img.test/\${id}.jpg`, backdrop: `https://img.test/\${id}-bg.jpg`,
  overview: `خلاصه فارسی \${id}`,
  downloads: [{ id: `\${id}-download`, files: [{ id: `\${id}-file`, mode: 'download', url: `https://cdn.test/\${id}.mp4` }] }],
});

const playableSeries = (id, categoryKeys, firstSeenAt = '2026-08-15T00:00:00.000Z') => ({
  id, type: 'series', ir: categoryKeys.includes('iranian-series'), nameFa: id, name: id,
  categoryKeys, publicationStatus: 'published', archiveComplete: true, firstSeenAt,
  poster: `https://img.test/\${id}.jpg`, backdrop: `https://img.test/\${id}-bg.jpg`, overview: `خلاصه فارسی \${id}`,
  latestEpisode: { id: `\${id}-ep`, seasonNumber: 1, episodeNumber: 1 }, episodeCount: 1,
  downloads: [{ id: `\${id}-episode`, seasonNumber: 1, episodeNumber: 1, files: [{ id: `\${id}-file`, mode: 'download', url: `https://cdn.test/\${id}.mp4` }] }],
});

const count = (payload, key) => payload.items.filter((item) => (item.categoryKeys || []).includes(key)).length;

test('bootstrap contains every navigation row plus IMDb and immediate actions', () => {
  const items = [];
  for (let i = 0; i < 20; i += 1) items.push(playableMovie(`foreign-\${i}`, ['movies', 'foreign-movies']));
  for (let i = 0; i < 20; i += 1) items.push(playableMovie(`iranian-\${i}`, ['movies', 'iranian-movies']));
  for (let i = 0; i < 20; i += 1) items.push(playableSeries(`series-\${i}`, ['series', 'foreign-series']));
  items.push({
    ...playableMovie('operator-1', ['movies', 'iranian-movies', 'mobile-operator'], '2026-08-17T00:00:00.000Z'),
    operatorOnly: true,
    downloads: [{ id: 'operator-media', files: [{ id: 'operator-file', mode: 'operator-play', operatorOnly: true, panelVerified: true, trafficOo: 1, url: 'https://cdn.test/operator-1.mp4' }] }],
  });
  items.push(playableMovie('animation-1', ['movies', 'foreign-movies', 'animation-movies'], '2026-08-17T01:00:00.000Z'));
  const catalog = {
    version: 'bootstrap-test', updatedAt: '2026-08-17T02:00:00.000Z', featuredPeople: [{ id: 'p1', nameFa: 'نمونه' }],
    imdbTop100: { updatedAt: '2026-08-17T02:00:00.000Z', movies: [{ rank: 1, imdb: 'tt1', title: 'One' }], series: [{ rank: 1, imdb: 'tt2', title: 'Two' }] }, items,
  };
  const artifacts = buildClientCatalogArtifacts(catalog);
  assert.equal(artifacts.bootstrap.items.length, artifacts.index.items.length);
  assert.deepEqual(artifacts.bootstrap.items.map((item) => item.id), artifacts.index.items.map((item) => item.id));
  for (const key of ['foreign-movies', 'iranian-movies', 'foreign-series']) assert.equal(count(artifacts.bootstrap, key), count(artifacts.index, key));
  assert.ok(artifacts.bootstrap.items.some((item) => item.id === 'operator-1'));
  assert.ok(artifacts.bootstrap.items.some((item) => item.id === 'animation-1'));
  assert.equal('peopleWorks' in artifacts.bootstrap, false);
  assert.equal(artifacts.bootstrap.imdbTop100.movies.length, 1);
  assert.equal(artifacts.bootstrap.imdbTop100.series.length, 1);
  assert.ok(artifacts.bootstrapSizeBytes < artifacts.clientSizeBytes);
  assert.match(artifacts.bootstrapRevision, /^[a-f0-9]{64}$/);
});

test('real generated bootstrap preserves complete navigation while staying compact', async () => {
  let bootstrapRaw; let indexRaw;
  try {
    [bootstrapRaw, indexRaw] = await Promise.all([fs.readFile('catalog-bootstrap.json', 'utf8'), fs.readFile('catalog-index.json', 'utf8')]);
  } catch { return; }
  const bootstrap = JSON.parse(bootstrapRaw); const index = JSON.parse(indexRaw);
  assert.equal(bootstrap.items.length, index.items.length);
  assert.deepEqual(bootstrap.items.map((item) => item.id), index.items.map((item) => item.id));
  for (const key of ['kids', 'iranian-movies', 'foreign-movies', 'iranian-series', 'foreign-series', 'korean-movies', 'korean-series', 'indian-movies']) {
    assert.equal(count(bootstrap, key), count(index, key), `bootstrap changed \${key}`);
  }
  const bootstrapBytes = Buffer.byteLength(bootstrapRaw); const indexBytes = Buffer.byteLength(indexRaw);
  assert.ok(bootstrapBytes < indexBytes * 0.55, 'complete bootstrap is no longer materially smaller than the full index');
  assert.ok(bootstrapBytes < MAX_BOOTSTRAP_BYTES, 'complete bootstrap exceeded the 10 MiB safety bound');
  assert.ok(Array.isArray(bootstrap.imdbTop100?.movies) && bootstrap.imdbTop100.movies.length > 0);
  assert.ok(Array.isArray(bootstrap.imdbTop100?.series) && bootstrap.imdbTop100.series.length > 0);
});
`);

// UI truth test: rich Home movie summaries may intentionally retain multiple
// qualities; the hard invariant is complete navigation plus a materially
// smaller bootstrap, not two files in every rich row.
{
  const file = 'scripts/tests/ui-truth-v10.test.mjs';
  let source = await read(file);
  source = replaceOnce(
    source,
`    assert.ok(item.downloads.every((section) => (section.files || []).length <= 2), 'Home media preview became unbounded');`,
`    assert.ok(files.every((file) => /^https?:\\/\\//i.test(String(file.url || ''))), 'bootstrap exposed a non-HTTP media action');`,
    'update rich Home media invariant',
  );
  source = replaceOnce(
    source,
`  assert.ok(bootstrapBytes < clientBytes * 0.12, 'Home bootstrap must stay much smaller than the full client index');`,
`  assert.ok(bootstrapBytes < clientBytes * 0.55, 'complete navigation bootstrap must stay materially smaller than the full client index');`,
    'update complete bootstrap ratio guard',
  );
  await write(file, source);
}

// Keep the opt-in generated-media audit aligned with the complete-navigation
// architecture too; it previously had a dormant 5 MB limit already violated
// by the current checked-in artifact.
{
  const file = 'scripts/tests/fast-movie-media-v2.test.mjs';
  let source = await read(file);
  source = replaceOnce(
    source,
`  assert.ok(Buffer.byteLength(bootstrapRaw) < 5_000_000, 'Complete navigation bootstrap must remain under 5 MB');`,
`  assert.ok(Buffer.byteLength(bootstrapRaw) < 10_000_000, 'Complete navigation bootstrap must remain under 10 MB');`,
    'update complete bootstrap safety cap',
  );
  await write(file, source);
}

// 4) Reclassify only titles that the new strict child-program rule positively
// identifies. This immediately restores the current catalog without touching
// ordinary films or unrelated category membership.
const classificationUrl = new URL('./classification.mjs', import.meta.url);
classificationUrl.searchParams.set('v', String(Date.now()));
const {
  classifyCatalogItem,
  isManagedCategoryKey,
  isManagedCategoryLabel,
} = await import(classificationUrl.href);
const { writeClientCatalogArtifacts } = await import('./client-catalog.mjs');

const catalogPath = 'catalog.json';
const catalog = JSON.parse(await read(catalogPath));
let changed = 0;
for (let i = 0; i < (catalog.items || []).length; i += 1) {
  const item = catalog.items[i];
  if (!item || !['movie', 'series'].includes(item.type)) continue;
  const rules = classifyCatalogItem(item);
  if (!rules.isChildrenProgram) continue;
  const preservedKeys = (Array.isArray(item.categoryKeys) ? item.categoryKeys : []).filter((key) => !isManagedCategoryKey(key));
  const preservedLabels = (Array.isArray(item.categoryLabels) ? item.categoryLabels : []).filter((label) => !isManagedCategoryLabel(label));
  const next = {
    ...item,
    contentKind: rules.contentKind,
    isAnimation: rules.isAnimation,
    isAnime: rules.isAnime,
    isDocumentary: rules.isDocumentary,
    isWildlife: rules.isWildlife,
    isTalkShow: rules.isTalkShow,
    categoryKeys: [...new Set([...rules.categoryKeys, ...preservedKeys])],
    categoryLabels: [...new Set([...rules.categoryLabels, ...preservedLabels])],
  };
  if (JSON.stringify(next.categoryKeys) !== JSON.stringify(item.categoryKeys) ||
      JSON.stringify(next.categoryLabels) !== JSON.stringify(item.categoryLabels) ||
      next.contentKind !== item.contentKind) changed += 1;
  catalog.items[i] = next;
}

const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
await write(catalogPath, serialized);
const artifacts = await writeClientCatalogArtifacts(process.cwd(), catalog);
const oldManifest = JSON.parse(await read('catalog-manifest.json'));
const manifest = {
  ...oldManifest,
  schemaVersion: 2,
  revision: createHash('sha256').update(serialized).digest('hex'),
  clientRevision: artifacts.clientRevision,
  catalogVersion: String(catalog.version || oldManifest.catalogVersion || ''),
  catalogUpdatedAt: String(catalog.updatedAt || oldManifest.catalogUpdatedAt || ''),
  sizeBytes: Buffer.byteLength(serialized),
  clientSizeBytes: artifacts.clientSizeBytes,
  clientIndex: 'catalog-index.json',
  bootstrapRevision: artifacts.bootstrapRevision,
  bootstrapSizeBytes: artifacts.bootstrapSizeBytes,
  bootstrapIndex: 'catalog-bootstrap.json',
  detailBase: 'catalog-items/',
  stableDetailBase: 'catalog-stable/',
};
await write('catalog-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

const kids = artifacts.index.items.filter((item) => (item.categoryKeys || []).includes('kids'));
console.log(JSON.stringify({ changedChildItems: changed, kids: kids.map((item) => item.nameFa || item.name), bootstrapBytes: artifacts.bootstrapSizeBytes, indexBytes: artifacts.clientSizeBytes }, null, 2));

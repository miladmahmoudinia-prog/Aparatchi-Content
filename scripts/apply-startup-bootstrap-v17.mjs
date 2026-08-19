import fs from 'node:fs/promises';

const clientCatalogFile = 'scripts/client-catalog.mjs';
let source = await fs.readFile(clientCatalogFile, 'utf8');

const startMarker = '  // Fresh installs should paint a truthful Home immediately instead of exposing\n';
const endMarker = '  const bootstrapSerialized = `${JSON.stringify(bootstrap)}\\n`;\n';
const start = source.indexOf(startMarker);
if (start < 0) throw new Error('startup bootstrap start marker not found');
const endStart = source.indexOf(endMarker, start);
if (endStart < 0) throw new Error('startup bootstrap end marker not found');
const end = endStart + endMarker.length;

const replacement = [
  '  // Cold start only needs the current Home truth. The full navigation index',
  '  // continues in catalog-index.json and replaces/enriches this snapshot in the',
  '  // background. Keeping the entire archive here made startup multi-megabyte',
  '  // and allowed an old Home to remain visible while the real index downloaded.',
  "  const clientRevision = createHash('sha256').update(indexSerialized).digest('hex');",
  '  const bootstrapItems = bootstrapItemsForHome(items).map(compactBootstrapNavigationItem);',
  '  const bootstrap = {',
  '    version: index.version,',
  '    updatedAt: index.updatedAt,',
  '    clientRevision,',
  '    items: bootstrapItems,',
  '    iranianSchedule: index.iranianSchedule,',
  '    weeklySchedule: index.weeklySchedule,',
  '    featuredPeople: index.featuredPeople,',
  '    ...(index.imdbTop100 ? { imdbTop100: index.imdbTop100 } : {}),',
  '  };',
  '  const bootstrapSerialized = `${JSON.stringify(bootstrap)}\\n`;',
  '',
].join('\n');

source = source.slice(0, start) + replacement + source.slice(end);
const oldRevisionReturn = "    clientRevision: createHash('sha256').update(indexSerialized).digest('hex'),";
if (!source.includes(oldRevisionReturn)) throw new Error('clientRevision return marker not found');
source = source.replace(oldRevisionReturn, '    clientRevision,');
await fs.writeFile(clientCatalogFile, source, 'utf8');

const imdbFile = 'scripts/update-imdb-top.mjs';
let imdbSource = await fs.readFile(imdbFile, 'utf8');
const manifestNeedle = [
  '    clientSizeBytes: clientArtifacts.clientSizeBytes,',
  "    clientIndex: 'catalog-index.json',",
  "    detailBase: 'catalog-items/',",
].join('\n');
const manifestReplacement = [
  '    clientSizeBytes: clientArtifacts.clientSizeBytes,',
  "    clientIndex: 'catalog-index.json',",
  '    bootstrapRevision: clientArtifacts.bootstrapRevision,',
  '    bootstrapSizeBytes: clientArtifacts.bootstrapSizeBytes,',
  "    bootstrapIndex: 'catalog-bootstrap.json',",
  "    detailBase: 'catalog-items/',",
].join('\n');
if (!imdbSource.includes(manifestNeedle)) throw new Error('IMDb manifest writer marker not found');
imdbSource = imdbSource.replace(manifestNeedle, manifestReplacement);
await fs.writeFile(imdbFile, imdbSource, 'utf8');

const regressionFile = 'scripts/tests/full-navigation-bootstrap-v1.test.mjs';
const regression = `import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const catalog = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));
const artifacts = buildClientCatalogArtifacts(catalog);
const index = artifacts.index;
const bootstrap = artifacts.bootstrap;
const MAX_BOOTSTRAP_BYTES = 1500 * 1024;

const categoryCount = (payload, key) => payload.items.filter((item) =>
  Array.isArray(item?.categoryKeys) && item.categoryKeys.includes(key)
).length;

test('bootstrap is a bounded current Home snapshot, not the whole navigation archive', () => {
  assert.ok(index.items.length > 1000, 'full client index unexpectedly tiny');
  assert.ok(bootstrap.items.length >= 50, 'Home bootstrap unexpectedly tiny');
  assert.ok(bootstrap.items.length < 400, 'Home bootstrap contains too many titles');
  assert.ok(bootstrap.items.length < index.items.length, 'bootstrap regressed to the whole archive');
  assert.equal(bootstrap.clientRevision, artifacts.clientRevision, 'bootstrap is not bound to the exact client index revision');
  assert.ok(artifacts.bootstrapSizeBytes < MAX_BOOTSTRAP_BYTES,
    \`startup bootstrap grew beyond 1.5 MiB: \${artifacts.bootstrapSizeBytes}\`);

  const clientIds = new Set(index.items.map((item) => String(item.id)));
  for (const item of bootstrap.items) {
    assert.ok(item?.id && item?.type && item?.detailPath, 'Home bootstrap row cannot hydrate detail');
    assert.ok(clientIds.has(String(item.id)), \`bootstrap contains non-client item \${item.id}\`);
    assert.ok(!Array.isArray(item.people) || item.people.length <= 4, \`people preview is unbounded for \${item.id}\`);
  }
});

test('Home bootstrap keeps a first-screen sample for every populated Home shelf', () => {
  for (const key of ['kids', 'iranian-movies', 'foreign-movies', 'iranian-series', 'foreign-series', 'korean-movies', 'korean-series', 'indian-movies', 'dubbed', 'subtitled', 'documentaries', 'wildlife', 'programs']) {
    if (categoryCount(index, key) > 0) {
      assert.ok(categoryCount(bootstrap, key) > 0, \`bootstrap lost Home shelf \${key}\`);
    }
  }
});

test('Home movie action previews are immediate but strictly bounded', () => {
  for (const item of bootstrap.items.filter((candidate) => candidate?.type === 'movie')) {
    const files = (Array.isArray(item.downloads) ? item.downloads : [])
      .flatMap((section) => Array.isArray(section?.files) ? section.files : []);
    assert.ok(files.length <= 2, \`Home action preview became unbounded for \${item.id}: \${files.length}\`);
    assert.ok(files.every((file) => /^https?:\\/\\//i.test(String(file?.url || ''))),
      \`Home action preview exposed a non-HTTP URL for \${item.id}\`);
  }
});
`;
await fs.writeFile(regressionFile, regression, 'utf8');

console.log('Prepared bounded, revision-bound Home bootstrap and permanent manifest writer fix.');

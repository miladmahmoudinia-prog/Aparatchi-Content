import fs from 'node:fs/promises';

const replaceOnce = (source, from, to, label) => {
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`Missing patch marker: ${label}`);
  if (source.indexOf(from, index + from.length) >= 0) throw new Error(`Non-unique patch marker: ${label}`);
  return source.slice(0, index) + to + source.slice(index + from.length);
};

const replaceFirst = (source, from, to, label) => {
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`Missing patch marker: ${label}`);
  return source.slice(0, index) + to + source.slice(index + from.length);
};

let client = await fs.readFile('scripts/client-catalog.mjs', 'utf8');

client = replaceOnce(
  client,
  "  summary.detailPath = `catalog-items/${identityHash}-${contentHash}.json`;\n  return { summary, detailSerialized };",
  "  summary.detailPath = `catalog-items/${identityHash}-${contentHash}.json`;\n  const stableDetailPath = `catalog-stable/${identityHash}.json`;\n  return { summary, detailSerialized, stableDetailPath };",
  'stable detail path',
);

client = replaceOnce(
  client,
  "export function buildClientCatalogArtifacts(catalog) {\n  const detailFiles = [];\n  const items = [];",
  "export function buildClientCatalogArtifacts(catalog) {\n  const detailFiles = [];\n  const stableDetailFiles = [];\n  const items = [];",
  'stable detail collection',
);

client = replaceOnce(
  client,
  "    const { summary, detailSerialized } = clientSummaryForItem(item);",
  "    const { summary, detailSerialized, stableDetailPath } = clientSummaryForItem(item);",
  'stable detail destructure',
);

client = replaceOnce(
  client,
  "    detailFiles.push({ path: summary.detailPath, serialized: detailSerialized });",
  "    detailFiles.push({ path: summary.detailPath, serialized: detailSerialized });\n    stableDetailFiles.push({ path: stableDetailPath, serialized: detailSerialized });",
  'stable detail push',
);

client = replaceOnce(
  client,
  "    detailFiles,\n    clientRevision:",
  "    detailFiles,\n    stableDetailFiles,\n    clientRevision:",
  'stable detail artifact return',
);

client = replaceOnce(
  client,
  "  const detailsRoot = path.join(root, 'catalog-items');\n  await fs.mkdir(detailsRoot, { recursive: true });\n\n  let changedDetailFiles = 0;",
  "  const detailsRoot = path.join(root, 'catalog-items');\n  const stableDetailsRoot = path.join(root, 'catalog-stable');\n  await fs.mkdir(detailsRoot, { recursive: true });\n  await fs.mkdir(stableDetailsRoot, { recursive: true });\n\n  let changedDetailFiles = 0;\n  let changedStableDetailFiles = 0;",
  'stable detail output root',
);

client = replaceOnce(
  client,
  "  // Old content-addressed detail files are safe to remove once the new index is\n  // written in the same commit. This keeps the repository bounded as links and\n  // episode metadata evolve over time.",
  "  const stableReferenced = new Set();\n  for (const detail of artifacts.stableDetailFiles) {\n    stableReferenced.add(path.basename(detail.path));\n    if (await writeIfChanged(path.join(root, detail.path), detail.serialized)) changedStableDetailFiles += 1;\n  }\n\n  // Old content-addressed detail files are safe to remove once the stable per-title\n  // alias exists. A stale CDN index may still reference an old hash, but the mobile\n  // client can always recover through catalog-stable/<identity>.json.\n  // This keeps the hash directory bounded without breaking old CDN revisions.",
  'write stable detail files',
);

client = replaceOnce(
  client,
  "  const indexChanged = await writeIfChanged(indexPath, artifacts.indexSerialized);\n  return { ...artifacts, indexChanged, changedDetailFiles };",
  "  try {\n    const existingStable = await fs.readdir(stableDetailsRoot);\n    await Promise.all(existingStable\n      .filter((name) => name.endsWith('.json') && !stableReferenced.has(name))\n      .map((name) => fs.rm(path.join(stableDetailsRoot, name), { force: true })));\n  } catch {\n    // Stable alias cleanup is bounded housekeeping only.\n  }\n\n  const indexChanged = await writeIfChanged(indexPath, artifacts.indexSerialized);\n  return { ...artifacts, indexChanged, changedDetailFiles, changedStableDetailFiles };",
  'stable cleanup and return',
);

await fs.writeFile('scripts/client-catalog.mjs', client);

let test = await fs.readFile('scripts/tests/client-catalog.test.mjs', 'utf8');
test = replaceFirst(
  test,
  "  const { summary } = clientSummaryForItem(item);",
  "  const { summary, stableDetailPath } = clientSummaryForItem(item);",
  'first test stable path destructure',
);
test = replaceOnce(
  test,
  "  assert.ok(summary.detailPath.startsWith('catalog-items/'));",
  "  assert.ok(summary.detailPath.startsWith('catalog-items/'));\n  assert.ok(stableDetailPath.startsWith('catalog-stable/'));\n  assert.match(stableDetailPath, /^catalog-stable\\/[a-f0-9]{12}\\.json$/);",
  'test stable path shape',
);
test = replaceOnce(
  test,
  "  assert.ok(Object.values(artifacts.index.peopleWorks).every((indexes) => indexes.every(Number.isInteger)));",
  "  assert.ok(Object.values(artifacts.index.peopleWorks).every((indexes) => indexes.every(Number.isInteger)));\n  assert.equal(artifacts.stableDetailFiles.length, 1);\n  assert.match(artifacts.stableDetailFiles[0].path, /^catalog-stable\\/[a-f0-9]{12}\\.json$/);\n  assert.equal(artifacts.stableDetailFiles[0].serialized, artifacts.detailFiles[0].serialized);",
  'test stable artifact',
);
await fs.writeFile('scripts/tests/client-catalog.test.mjs', test);

let sync = await fs.readFile('.github/workflows/sync-upera.yml', 'utf8');
const oldToken = 'catalog-index.json catalog-items catalog-manifest.json';
const replacements = sync.split(oldToken).length - 1;
if (replacements < 4) throw new Error(`Expected >=4 sync staging markers, found ${replacements}`);
sync = sync.split(oldToken).join('catalog-index.json catalog-items catalog-stable catalog-manifest.json');
await fs.writeFile('.github/workflows/sync-upera.yml', sync);

let compact = await fs.readFile('.github/workflows/compact-client-index-v2.yml', 'utf8');
if (!compact.includes('catalog-index.json catalog-manifest.json catalog-items')) throw new Error('Compact workflow staging marker missing.');
compact = compact.replace('catalog-index.json catalog-manifest.json catalog-items', 'catalog-index.json catalog-manifest.json catalog-items catalog-stable');
await fs.writeFile('.github/workflows/compact-client-index-v2.yml', compact);

console.log(JSON.stringify({
  stableAliasPerVisibleTitle: true,
  stableAliasUsesIdentityHashOnly: true,
  hourlySyncStagesStableAliases: replacements,
  compactWorkflowStagesStableAliases: true,
}, null, 2));

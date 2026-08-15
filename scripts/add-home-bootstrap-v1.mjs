import fs from 'node:fs/promises';

const replaceOnce = (source, from, to, label) => {
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`Missing patch marker: ${label}`);
  if (source.indexOf(from, index + from.length) >= 0) throw new Error(`Non-unique patch marker: ${label}`);
  return source.slice(0, index) + to + source.slice(index + from.length);
};

let client = await fs.readFile('scripts/client-catalog.mjs', 'utf8');

const buildMarker = `export function buildClientCatalogArtifacts(catalog) {`;
const bootstrapHelper = `const BOOTSTRAP_CATEGORY_KEYS = [\n  'mobile-operator', 'iranian-movies', 'foreign-movies', 'iranian-series', 'foreign-series',\n  'korean-movies', 'korean-series', 'indian-movies', 'indian-series', 'anime-movies', 'anime-series',\n  'animation-movies', 'animation-series', 'kids', 'programs', 'dubbed', 'subtitled', 'documentaries', 'wildlife', 'collections',\n];\n\nconst bootstrapItemsForHome = (items) => {\n  const source = Array.isArray(items) ? items : [];\n  const picked = [];\n  const seen = new Set();\n  const add = (item) => {\n    const id = String(item?.id || '');\n    if (!id || seen.has(id)) return false;\n    seen.add(id);\n    picked.push(item);\n    return true;\n  };\n\n  // Preserve the newest front of the client index for Hero/latest rails.\n  source.slice(0, 36).forEach(add);\n\n  // Preserve freshly updated titles even if they are not near the catalog head.\n  [...source]\n    .sort((a, b) => {\n      const timestamp = (item) => Math.max(\n        Date.parse(String(item?.meaningfulUpdatedAt || '')) || 0,\n        Date.parse(String(item?.sourceUpdatedAt || '')) || 0,\n        Date.parse(String(item?.updatedAt || '')) || 0,\n      );\n      return timestamp(b) - timestamp(a);\n    })\n    .slice(0, 24)\n    .forEach(add);\n\n  // Home must never wait for the multi-megabyte full index just to populate\n  // a common rail. Keep up to twelve real summaries for every Home category.\n  for (const key of BOOTSTRAP_CATEGORY_KEYS) {\n    let count = 0;\n    for (const item of source) {\n      if (!(Array.isArray(item?.categoryKeys) && item.categoryKeys.includes(key))) continue;\n      if (add(item)) count += 1;\n      else if (seen.has(String(item?.id || ''))) count += 1;\n      if (count >= 12) break;\n    }\n  }\n\n  return picked;\n};\n\n${buildMarker}`;
client = replaceOnce(client, buildMarker, bootstrapHelper, 'Home bootstrap helper');

const indexBlock = `  // Compact transport: this is downloaded by every app launch after a catalog\n  // revision, so whitespace is pure network/parse overhead. Detail shards stay\n  // human-readable because only one is fetched when a title opens.\n  const indexSerialized = \`${'${JSON.stringify(index)}'}\\n\`;\n  return {\n    index,\n    indexSerialized,\n    detailFiles,\n    stableDetailFiles,\n    clientRevision: createHash('sha256').update(indexSerialized).digest('hex'),\n    clientSizeBytes: Buffer.byteLength(indexSerialized),\n  };`;
const bootstrapBlock = `  // Compact transport: this is downloaded by every app launch after a catalog\n  // revision, so whitespace is pure network/parse overhead. Detail shards stay\n  // human-readable because only one is fetched when a title opens.\n  const indexSerialized = \`${'${JSON.stringify(index)}'}\\n\`;\n\n  // Fresh installs should paint a truthful Home immediately instead of exposing\n  // the tiny bundled emergency catalog while the full client index is downloading.\n  // The bootstrap is intentionally Home-only; detailPath still points at the\n  // immutable detail shards and the full index replaces it in the background.\n  const bootstrap = {\n    version: index.version,\n    updatedAt: index.updatedAt,\n    items: bootstrapItemsForHome(items),\n    iranianSchedule: index.iranianSchedule,\n    weeklySchedule: index.weeklySchedule,\n    featuredPeople: index.featuredPeople,\n    ...(index.imdbTop100 ? { imdbTop100: index.imdbTop100 } : {}),\n  };\n  const bootstrapSerialized = \`${'${JSON.stringify(bootstrap)}'}\\n\`;\n\n  return {\n    index,\n    indexSerialized,\n    bootstrap,\n    bootstrapSerialized,\n    detailFiles,\n    stableDetailFiles,\n    clientRevision: createHash('sha256').update(indexSerialized).digest('hex'),\n    clientSizeBytes: Buffer.byteLength(indexSerialized),\n    bootstrapRevision: createHash('sha256').update(bootstrapSerialized).digest('hex'),\n    bootstrapSizeBytes: Buffer.byteLength(bootstrapSerialized),\n  };`;
client = replaceOnce(client, indexBlock, bootstrapBlock, 'bootstrap artifact payload');

client = replaceOnce(
  client,
  `  const indexPath = path.join(root, 'catalog-index.json');\n  const detailsRoot = path.join(root, 'catalog-items');`,
  `  const indexPath = path.join(root, 'catalog-index.json');\n  const bootstrapPath = path.join(root, 'catalog-bootstrap.json');\n  const detailsRoot = path.join(root, 'catalog-items');`,
  'bootstrap output path',
);
client = replaceOnce(
  client,
  `  const indexChanged = await writeIfChanged(indexPath, artifacts.indexSerialized);\n  return { ...artifacts, indexChanged, changedDetailFiles, changedStableDetailFiles };`,
  `  const indexChanged = await writeIfChanged(indexPath, artifacts.indexSerialized);\n  const bootstrapChanged = await writeIfChanged(bootstrapPath, artifacts.bootstrapSerialized);\n  return { ...artifacts, indexChanged, bootstrapChanged, changedDetailFiles, changedStableDetailFiles };`,
  'bootstrap output write',
);
await fs.writeFile('scripts/client-catalog.mjs', client, 'utf8');

let sync = await fs.readFile('scripts/sync-upera.mjs', 'utf8');
sync = replaceOnce(
  sync,
  `    clientSizeBytes: clientArtifacts.clientSizeBytes,\n    clientIndex: 'catalog-index.json',\n    detailBase: 'catalog-items/',`,
  `    clientSizeBytes: clientArtifacts.clientSizeBytes,\n    clientIndex: 'catalog-index.json',\n    bootstrapRevision: clientArtifacts.bootstrapRevision,\n    bootstrapSizeBytes: clientArtifacts.bootstrapSizeBytes,\n    bootstrapIndex: 'catalog-bootstrap.json',\n    detailBase: 'catalog-items/',`,
  'sync manifest bootstrap metadata',
);
await fs.writeFile('scripts/sync-upera.mjs', sync, 'utf8');

let rebuild = await fs.readFile('scripts/rebuild-client-index.mjs', 'utf8');
rebuild = replaceOnce(
  rebuild,
  `manifest.clientSizeBytes = artifacts.clientSizeBytes;\nmanifest.clientIndex = 'catalog-index.json';\nmanifest.detailBase = 'catalog-items/';`,
  `manifest.clientSizeBytes = artifacts.clientSizeBytes;\nmanifest.clientIndex = 'catalog-index.json';\nmanifest.bootstrapRevision = artifacts.bootstrapRevision;\nmanifest.bootstrapSizeBytes = artifacts.bootstrapSizeBytes;\nmanifest.bootstrapIndex = 'catalog-bootstrap.json';\nmanifest.detailBase = 'catalog-items/';`,
  'rebuild manifest bootstrap metadata',
);
rebuild = replaceOnce(
  rebuild,
  `  clientRevision: artifacts.clientRevision,\n  indexChanged: artifacts.indexChanged,`,
  `  clientRevision: artifacts.clientRevision,\n  bootstrapSizeBytes: artifacts.bootstrapSizeBytes,\n  bootstrapRevision: artifacts.bootstrapRevision,\n  indexChanged: artifacts.indexChanged,\n  bootstrapChanged: artifacts.bootstrapChanged,`,
  'rebuild bootstrap diagnostics',
);
await fs.writeFile('scripts/rebuild-client-index.mjs', rebuild, 'utf8');

console.log(JSON.stringify({
  homeBootstrapGenerated: true,
  bootstrapUpdatesOnEverySync: true,
  manifestAdvertisesBootstrap: true,
}, null, 2));

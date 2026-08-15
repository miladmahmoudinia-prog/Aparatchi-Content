import fs from 'node:fs/promises';

const file = 'scripts/client-catalog.mjs';
let source = await fs.readFile(file, 'utf8');

const marker = `const bootstrapItemsForHome = (items) => {`;
if (!source.includes(marker)) throw new Error('bootstrapItemsForHome marker not found');

if (!source.includes('const BOOTSTRAP_NAVIGATION_FIELDS = [')) {
  const insertion = `const BOOTSTRAP_NAVIGATION_FIELDS = [
  'id', 'slug', 'type', 'ir', 'year', 'nameFa', 'name', 'imdb',
  'countryCodes', 'originalLanguage', 'collectionId', 'collectionOrder',
  'poster', 'posterFallback', 'rate', 'access', 'operatorOnly', 'availableLanguages',
  'episodeCount', 'seasonCount', 'latestEpisode', 'isAiring', 'publicationStatus',
  'updateLabel', 'meaningfulUpdatedAt', 'categoryKeys', 'categoryLabels',
  'contentKind', 'isAnimation', 'isAnime', 'isTalkShow', 'isDocumentary', 'isWildlife',
  'createdAt', 'updatedAt', 'sourceCreatedAt', 'sourceUpdatedAt', 'detailPath',
];

const compactBootstrapNavigationItem = (item) => {
  const compact = {};
  for (const field of BOOTSTRAP_NAVIGATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(item || {}, field)) compact[field] = item[field];
  }
  return compact;
};

`;
  source = source.replace(marker, insertion + marker);
}

const oldBlock = `  const bootstrap = {
    version: index.version,
    updatedAt: index.updatedAt,
    items: bootstrapItemsForHome(items),
    iranianSchedule: index.iranianSchedule,
    weeklySchedule: index.weeklySchedule,
    featuredPeople: index.featuredPeople,
    ...(index.imdbTop100 ? { imdbTop100: index.imdbTop100 } : {}),
  };`;

const newBlock = `  const richHomeItems = bootstrapItemsForHome(items);
  const richHomeIds = new Set(richHomeItems.map((item) => String(item?.id || '')).filter(Boolean));
  // Bootstrap is also the first navigation catalog. Every visible title must be
  // present so categories/search can never collapse to the old 8–12 item Home
  // sample. Only Home-critical rows keep their heavier media/overview payload;
  // the rest retain enough metadata to browse and hydrate their detail shard.
  const bootstrapItems = items.map((item) =>
    richHomeIds.has(String(item?.id || '')) ? item : compactBootstrapNavigationItem(item)
  );
  const bootstrap = {
    version: index.version,
    updatedAt: index.updatedAt,
    items: bootstrapItems,
    iranianSchedule: index.iranianSchedule,
    weeklySchedule: index.weeklySchedule,
    featuredPeople: index.featuredPeople,
    ...(index.imdbTop100 ? { imdbTop100: index.imdbTop100 } : {}),
  };`;

if (source.includes(oldBlock)) {
  source = source.replace(oldBlock, newBlock);
} else if (!source.includes('const richHomeItems = bootstrapItemsForHome(items);')) {
  throw new Error('bootstrap construction block not found');
}

await fs.writeFile(file, source, 'utf8');
console.log('Full navigation bootstrap patch applied.');

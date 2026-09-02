import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const statePath = path.join(root, 'sync-state.json');

const WESTIES_ID = '6f4a5550-90cb-11f1-b74a-f34817502b6d';

const normalize = (value) => String(value ?? '')
  .normalize('NFKC')
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/[\s‌ـ_\-–—:|()[\]{}]+/g, '')
  .toLowerCase();

const itemTitles = (item) => [item?.nameFa, item?.name_fa, item?.name].map(normalize);

const isAhlIran = (item) => {
  if (!item || item.type !== 'series') return false;
  return itemTitles(item).some((title) => title === 'اهلایران' || title.startsWith('اهلایرانفصل'));
};

const isWesties = (item) => {
  if (!item || item.type !== 'series') return false;
  if (String(item.id || '') === WESTIES_ID || String(item.sourceId || '') === WESTIES_ID || String(item.baseId || '') === WESTIES_ID) return true;
  return itemTitles(item).some((title) => title === 'وستیها' || title === 'thewesties' || title === 'westies');
};

const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const originalItems = Array.isArray(catalog.items) ? catalog.items : [];
// Ahl Iran now has verified per-episode HLS playback and must never be purged.
const removedAhlIran = [];
const ahlIranIds = new Set();

let westiesFixed = 0;
const nextItems = originalItems
  .map((item) => {
    if (!isWesties(item)) return item;
    westiesFixed += 1;
    const categoryKeys = Array.from(new Set([
      ...(Array.isArray(item.categoryKeys) ? item.categoryKeys : []).filter((key) => key !== 'iranian-series'),
      'foreign-series',
    ]));
    const categoryLabels = (Array.isArray(item.categoryLabels) ? item.categoryLabels : [])
      .filter((label) => !/سریال\s*های?\s*ایرانی|سریال\s*ایرانی/i.test(String(label || '')));
    return {
      ...item,
      ir: false,
      categoryKeys,
      categoryLabels,
      iranianSeriesForcedForeign: true,
    };
  });

if (removedAhlIran.length || westiesFixed) {
  catalog.items = nextItems;
  catalog.updatedAt = new Date().toISOString();
  await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}

let state = {};
try {
  state = JSON.parse(await fs.readFile(statePath, 'utf8'));
} catch {
  state = {};
}

// «وستی‌ها» stays in the catalog as a foreign series, and only its stale
// Iranian retry/cursor residue is removed. «اهل ایران» is preserved.
const iranianStateIds = new Set([WESTIES_ID]);
const iranianOnlyMaps = [
  'iranianSeriesNoProgress',
  'iranianVisibleRepairNoProgress',
  'iranianVisibleRepairDeferredAt',
  'iranianRecentSeriesCheckedAt',
];
for (const key of iranianOnlyMaps) {
  if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) continue;
  for (const id of iranianStateIds) delete state[key][id];
}

// Kept for compatibility; no Ahl Iran ids are purged anymore.
const ahlOnlyMaps = [
  'seriesEpisodeCursor',
  'seriesLanguageAuditCursor',
  'archiveBackfillNoProgress',
  'archiveBackfillCompleted',
  'archiveEpisodeFailures',
  'mediaRepairFailures',
];
for (const key of ahlOnlyMaps) {
  if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) continue;
  for (const id of ahlIranIds) delete state[key][id];
}

for (const key of ['iranianSeriesActiveId', 'iranianSeriesCurrentId', 'iranianVisibleRepairActiveId']) {
  if (iranianStateIds.has(String(state[key] || ''))) state[key] = '';
}
for (const key of ['archiveBackfillSeriesId', 'archiveBackfillItemId']) {
  if (ahlIranIds.has(String(state[key] || ''))) state[key] = '';
}
if (!state.archiveBackfillSeriesId) state.archiveBackfillSeriesTitle = '';
if (!state.archiveBackfillItemId) {
  state.archiveBackfillItemTitle = '';
  state.archiveBackfillItemType = '';
}

await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  suppressedAhlIran: removedAhlIran.length,
  ahlIranIds: [...ahlIranIds],
  westiesKeptAsForeign: westiesFixed,
  westiesIranianStatePurged: true,
  westiesId: WESTIES_ID,
}, null, 2));

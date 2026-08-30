import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const statePath = path.join(root, 'sync-state.json');

const normalize = (value) => String(value ?? '')
  .normalize('NFKC')
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/[\s‌ـ_\-–—:|()[\]{}]+/g, '')
  .toLowerCase();

const isAhlIran = (item) => {
  if (!item || item.type !== 'series') return false;
  return [item.nameFa, item.name_fa, item.name]
    .map(normalize)
    .some((title) => title === 'اهلایران' || title.startsWith('اهلایرانفصل'));
};

const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const originalItems = Array.isArray(catalog.items) ? catalog.items : [];
const removedItems = originalItems.filter(isAhlIran);
const removedIds = new Set(removedItems.flatMap((item) => [
  String(item.id || ''),
  String(item.sourceId || ''),
  String(item.baseId || ''),
]).filter(Boolean));

if (!removedItems.length) {
  console.log('Ahl Iran suppression: no matching catalog item is currently present.');
  process.exit(0);
}

catalog.items = originalItems.filter((item) => !isAhlIran(item));
catalog.updatedAt = new Date().toISOString();
await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

let state = {};
try {
  state = JSON.parse(await fs.readFile(statePath, 'utf8'));
} catch {
  state = {};
}

const keyedMaps = [
  'seriesEpisodeCursor',
  'seriesLanguageAuditCursor',
  'iranianSeriesNoProgress',
  'archiveBackfillNoProgress',
  'archiveBackfillCompleted',
  'archiveEpisodeFailures',
  'mediaRepairFailures',
  'iranianVisibleRepairNoProgress',
  'iranianVisibleRepairDeferredAt',
];
for (const key of keyedMaps) {
  if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) continue;
  for (const id of removedIds) delete state[key][id];
}

const scalarCursorKeys = [
  'iranianSeriesActiveId',
  'iranianSeriesCurrentId',
  'iranianVisibleRepairActiveId',
  'archiveBackfillSeriesId',
  'archiveBackfillItemId',
];
for (const key of scalarCursorKeys) {
  if (removedIds.has(String(state[key] || ''))) state[key] = '';
}
if (!state.archiveBackfillSeriesId) state.archiveBackfillSeriesTitle = '';
if (!state.archiveBackfillItemId) {
  state.archiveBackfillItemTitle = '';
  state.archiveBackfillItemType = '';
}

await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  suppressedTitle: 'اهل ایران',
  removedCount: removedItems.length,
  removedIds: [...removedIds],
}, null, 2));

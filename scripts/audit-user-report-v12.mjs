import fs from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await fs.readFile(path, 'utf8'));
const catalog = await readJson('catalog.json');
const index = await readJson('catalog-index.json');
const bootstrap = await readJson('catalog-bootstrap.json');
const manifest = await readJson('catalog-manifest.json');

const norm = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
  .trim();
const stamp = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const freshness = (item) => {
  const values = item?.type === 'series'
    ? [item?.meaningfulUpdatedAt, item?.firstSeenAt, item?.sourceCreatedAt, item?.createdAt]
    : [item?.firstSeenAt, item?.sourceCreatedAt, item?.createdAt];
  return Math.max(0, ...values.map(stamp));
};
const episodeSourceTimes = (item) => (Array.isArray(item?.downloads) ? item.downloads : [])
  .filter((group) => Number(group?.episodeNumber || 0) > 0)
  .map((group) => ({
    season: Number(group?.seasonNumber || 1),
    episode: Number(group?.episodeNumber || 0),
    sourceUpdatedAt: group?.sourceUpdatedAt || '',
    sourceEpisodeId: group?.sourceEpisodeId || '',
  }))
  .sort((a, b) => b.season - a.season || b.episode - a.episode)
  .slice(0, 5);
const summary = (item) => item ? ({
  id: item.id,
  type: item.type,
  nameFa: item.nameFa,
  name: item.name,
  categoryKeys: item.categoryKeys,
  firstSeenAt: item.firstSeenAt,
  createdAt: item.createdAt,
  sourceCreatedAt: item.sourceCreatedAt,
  updatedAt: item.updatedAt,
  sourceUpdatedAt: item.sourceUpdatedAt,
  meaningfulUpdatedAt: item.meaningfulUpdatedAt,
  updateLabel: item.updateLabel,
  lastSyncedAt: item.lastSyncedAt,
  latestEpisode: item.latestEpisode,
  episodeCount: item.episodeCount,
  backdrop: item.backdrop,
  overview: item.overview,
  peopleCount: Array.isArray(item.people) ? item.people.length : 0,
  peoplePreview: Array.isArray(item.people) ? item.people.slice(0, 4).map((p) => ({ nameFa: p.nameFa, name: p.name, role: p.role, image: p.image })) : [],
  freshness: freshness(item),
  recentEpisodes: episodeSourceTimes(item),
}) : null;

const targets = ['spider noir', 'عنکبوت نوار', 'مصادره', 'آپاندیس', 'روغن مار', 'پرده آخر', 'دندان مار'];
const findTargets = (items) => items.filter((item) => {
  const text = norm(`${item?.nameFa || ''} ${item?.name || ''}`);
  return targets.some((target) => text.includes(norm(target)));
});

const first = (items, count = 16) => items.slice(0, count).map((item) => ({
  id: item.id,
  type: item.type,
  nameFa: item.nameFa,
  name: item.name,
  firstSeenAt: item.firstSeenAt,
  meaningfulUpdatedAt: item.meaningfulUpdatedAt,
  sourceCreatedAt: item.sourceCreatedAt,
  updatedAt: item.updatedAt,
  updateLabel: item.updateLabel,
  categoryKeys: item.categoryKeys,
}));

const foreignSeries = (items) => items.filter((item) => Array.isArray(item?.categoryKeys) && item.categoryKeys.includes('foreign-series'));
const updatedSeries = (items) => items.filter((item) => item?.type === 'series' && item?.updateLabel)
  .sort((a, b) => Math.max(stamp(b.meaningfulUpdatedAt), stamp(b.updatedAt)) - Math.max(stamp(a.meaningfulUpdatedAt), stamp(a.updatedAt)));

const sourceById = new Map((catalog.items || []).map((item) => [String(item.id), item]));
const indexById = new Map((index.items || []).map((item) => [String(item.id), item]));
const bootstrapById = new Map((bootstrap.items || []).map((item) => [String(item.id), item]));
const targetIds = [...new Set(findTargets(catalog.items || []).map((item) => String(item.id)))];

console.log(JSON.stringify({
  manifest,
  counts: { catalog: catalog.items?.length || 0, index: index.items?.length || 0, bootstrap: bootstrap.items?.length || 0 },
  catalogHead: first(catalog.items || []),
  indexHead: first(index.items || []),
  bootstrapHead: first(bootstrap.items || []),
  foreignSeriesHead: first(foreignSeries(index.items || []), 20),
  updatedSeriesHead: first(updatedSeries(index.items || []), 20),
  targets: targetIds.map((id) => ({
    source: summary(sourceById.get(id)),
    index: summary(indexById.get(id)),
    bootstrap: summary(bootstrapById.get(id)),
  })),
}, null, 2));

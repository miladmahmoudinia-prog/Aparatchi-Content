import fs from 'node:fs/promises';
import { buildClientCatalogArtifacts } from './client-catalog.mjs';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const items = Array.isArray(catalog.items) ? catalog.items : [];
const clean = (v) => String(v || '').trim();
const norm = (v) => clean(v).toLowerCase().normalize('NFKC').replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim();
const wanted = [
  'twisted metal',
  'muppets haunted mansion',
  'chang can dunk',
  'perfect crown',
  'to my beloved thief',
];

const sample = {};
for (const needle of wanted) {
  const item = items.find((entry) => norm(entry?.name) === needle || norm(entry?.name).includes(needle));
  if (!item) { sample[needle] = null; continue; }
  const files = (item.downloads || []).flatMap((section) => section?.files || []);
  sample[needle] = {
    id: item.id,
    type: item.type,
    name: item.name,
    nameFa: item.nameFa,
    nameFaSource: item.nameFaSource,
    availableLanguages: item.availableLanguages || [],
    fileLanguages: files.reduce((acc, file) => {
      const key = file?.language || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    updateLabel: item.updateLabel || '',
    meaningfulUpdatedAt: item.meaningfulUpdatedAt || '',
    firstSeenAt: item.firstSeenAt || '',
  };
}

let episodeGroups = 0;
let episodeArtworkMissing = 0;
let trustedGenerated = 0;
let duplicateArtworkGroups = 0;
let repeatedSeriesArtworkGroups = 0;
const trustedRe = /^(?:\.\/)?assets\/media\/episodes\/[a-f0-9]{24}\.jpg$/i;
for (const item of items) {
  if (item?.type !== 'series') continue;
  const counts = new Map();
  const groups = (item.downloads || []).filter((g) => Number(g?.episodeNumber || 0) > 0);
  for (const group of groups) {
    episodeGroups += 1;
    const art = clean(group?.artwork);
    if (!art) { episodeArtworkMissing += 1; continue; }
    if (trustedRe.test(art)) trustedGenerated += 1;
    const identity = art.replace(/[?#].*$/, '').toLowerCase();
    counts.set(identity, (counts.get(identity) || 0) + 1);
    const poster = clean(item.poster).replace(/[?#].*$/, '').toLowerCase();
    const backdrop = clean(item.backdrop).replace(/[?#].*$/, '').toLowerCase();
    if (identity && (identity === poster || identity === backdrop)) repeatedSeriesArtworkGroups += 1;
  }
  for (const count of counts.values()) if (count > 1) duplicateArtworkGroups += count;
}

const artifacts = buildClientCatalogArtifacts(catalog);
const clientItems = artifacts.index.items || [];
const bootstrapItems = artifacts.bootstrap.items || [];
const firstTwenty = clientItems.slice(0, 20).map((item) => ({
  id: item.id,
  type: item.type,
  name: item.name,
  firstSeenAt: item.firstSeenAt || '',
  meaningfulUpdatedAt: item.meaningfulUpdatedAt || '',
  sourceUpdatedAt: item.sourceUpdatedAt || '',
  updatedAt: item.updatedAt || '',
  updateLabel: item.updateLabel || '',
}));
const movieBootstrapMedia = bootstrapItems.filter((item) => item?.type === 'movie' && Array.isArray(item.downloads) && item.downloads.length > 0).length;
const movieClientMedia = clientItems.filter((item) => item?.type === 'movie' && Array.isArray(item.downloads) && item.downloads.length > 0).length;
const dubbedOnlyClient = clientItems.filter((item) => item?.type === 'movie' && item?.availableLanguages?.includes('dubbed') && !item?.availableLanguages?.includes('subtitled')).length;

console.log('UI_TRUTH_V10=' + JSON.stringify({
  catalogItems: items.length,
  clientItems: clientItems.length,
  bootstrapItems: bootstrapItems.length,
  movieClientMedia,
  movieBootstrapMedia,
  dubbedOnlyClient,
  episodeGroups,
  episodeArtworkMissing,
  trustedGenerated,
  duplicateArtworkGroups,
  repeatedSeriesArtworkGroups,
  sample,
  firstTwenty,
}));

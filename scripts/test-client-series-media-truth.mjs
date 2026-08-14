import fs from 'node:fs/promises';
import { buildClientCatalogArtifacts } from './client-catalog.mjs';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const artifacts = buildClientCatalogArtifacts(catalog);
const detailsByPath = new Map(artifacts.detailFiles.map((detail) => [detail.path, JSON.parse(detail.serialized)]));

const usable = (file) => {
  const url = String(file?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return false;
  const mode = String(file?.mode || 'download');
  if (mode === 'operator-download' || mode === 'operator-play') return true;
  if (mode === 'play') return /\.(?:m3u8|mp4)(?:$|[?#])/i.test(url);
  return /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(url);
};

let seriesCount = 0;
let ongoingCount = 0;
for (const summary of artifacts.index.items.filter((item) => item.type === 'series')) {
  seriesCount += 1;
  const detail = detailsByPath.get(summary.detailPath);
  if (!detail) throw new Error(`Missing detail shard for ${summary.name || summary.id}`);
  const actual = new Map();
  for (const section of Array.isArray(detail.downloads) ? detail.downloads : []) {
    const episode = Number(section?.episodeNumber || 0);
    const season = Math.max(1, Number(section?.seasonNumber || 1));
    if (!(episode > 0)) continue;
    if (!(section.files || []).some(usable)) continue;
    actual.set(`${season}:${episode}`, section);
  }
  const ordered = [...actual.values()].sort((a, b) =>
    Number(a.seasonNumber || 1) - Number(b.seasonNumber || 1) ||
    Number(a.episodeNumber || 0) - Number(b.episodeNumber || 0));
  if (!ordered.length) throw new Error(`Published client series has zero usable episodes: ${summary.name || summary.id}`);
  const latest = ordered.at(-1);
  if (Number(summary.episodeCount || 0) !== ordered.length) {
    throw new Error(`Episode count mismatch for ${summary.name || summary.id}: summary=${summary.episodeCount}, actual=${ordered.length}`);
  }
  if (Number(summary.latestEpisode?.seasonNumber || 0) !== Number(latest.seasonNumber || 1) ||
      Number(summary.latestEpisode?.episodeNumber || 0) !== Number(latest.episodeNumber || 0)) {
    throw new Error(`Latest episode mismatch for ${summary.name || summary.id}`);
  }
  if (summary.isAiring === true) ongoingCount += 1;
  const expected = Number(summary.sourceEpisodeCount || 0);
  if (summary.isAiring !== true && expected > 0 && ordered.length < expected) {
    throw new Error(`Incomplete old series leaked into client catalog: ${summary.name || summary.id} actual=${ordered.length} expected=${expected}`);
  }
}

if (!seriesCount) throw new Error('No series were emitted into client catalog.');
console.log(JSON.stringify({ seriesCount, ongoingCount, mismatches: 0, emptyPublishedSeries: 0 }, null, 2));

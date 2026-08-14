import fs from 'node:fs/promises';

const path = 'scripts/client-catalog.mjs';
let source = await fs.readFile(path, 'utf8');

const replaceOnce = (before, after, label) => {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Missing series truth target: ${label}`);
  source = source.replace(before, after);
};

const helperAnchor = `const sanitizeClientMediaItem = (item) => {`;
const helper = `const clientSeriesFileIsUsable = (file) => {\n  const url = typeof file?.url === 'string' ? file.url.trim() : '';\n  if (!/^https?:\\/\\//i.test(url)) return false;\n  const mode = String(file?.mode || 'download');\n  if (mode === 'operator-download' || mode === 'operator-play') return true;\n  if (mode === 'play') return /\\.(?:m3u8|mp4)(?:$|[?#])/i.test(url);\n  return /\\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(url);\n};\n\nconst deriveClientSeriesMediaTruth = (downloads) => {\n  const episodes = new Map();\n  for (const section of Array.isArray(downloads) ? downloads : []) {\n    const seasonNumber = Math.max(1, Number(section?.seasonNumber || 1));\n    const episodeNumber = Number(section?.episodeNumber || 0);\n    if (!(episodeNumber > 0)) continue;\n    if (!(Array.isArray(section?.files) && section.files.some(clientSeriesFileIsUsable))) continue;\n    const key = \`${'${seasonNumber}'}:${'${episodeNumber}'}\`;\n    const current = episodes.get(key);\n    if (!current || (section.files || []).length > (current.files || []).length) episodes.set(key, section);\n  }\n  const ordered = [...episodes.values()].sort((a, b) =>\n    Number(a.seasonNumber || 1) - Number(b.seasonNumber || 1) ||\n    Number(a.episodeNumber || 0) - Number(b.episodeNumber || 0)\n  );\n  const latest = ordered.at(-1);\n  return {\n    episodeCount: ordered.length,\n    seasonCount: new Set(ordered.map((section) => Number(section.seasonNumber || 1))).size,\n    latestEpisode: latest ? {\n      id: String(latest.sourceEpisodeId || latest.id || \`s${'${latest.seasonNumber || 1}'}e${'${latest.episodeNumber || 0}'}\`),\n      seasonNumber: Math.max(1, Number(latest.seasonNumber || 1)),\n      episodeNumber: Number(latest.episodeNumber || 0),\n      ...(latest.title ? { title: latest.title } : {}),\n    } : null,\n  };\n};\n\n${helperAnchor}`;
if (!source.includes('const deriveClientSeriesMediaTruth = (downloads) => {')) {
  if (!source.includes(helperAnchor)) throw new Error('sanitizeClientMediaItem anchor missing.');
  source = source.replace(helperAnchor, helper);
}

replaceOnce(
`  const availableLanguages = [...new Set(downloads.flatMap((section) =>`,
`  const seriesMediaTruth = item.type === 'series' ? deriveClientSeriesMediaTruth(downloads) : null;\n\n  const availableLanguages = [...new Set(downloads.flatMap((section) =>`,
  'derive sanitized series truth',
);

replaceOnce(
`  const next = {\n    ...item,\n    downloads,\n    availableLanguages,`,
`  const next = {\n    ...item,\n    downloads,\n    availableLanguages,\n    ...(seriesMediaTruth ? {\n      episodeCount: seriesMediaTruth.episodeCount,\n      seasonCount: seriesMediaTruth.seasonCount,\n      latestEpisode: seriesMediaTruth.latestEpisode,\n    } : {}),`,
  'write series truth into sanitized item',
);

replaceOnce(
`  if (item.type !== 'series') return true;\n  // Iranian narrative archives are intentionally hidden while their clean`,
`  if (item.type !== 'series') return true;\n  const actualEpisodeCount = Number(item.episodeCount || 0);\n  if (!(actualEpisodeCount > 0) || !item.latestEpisode || !(Number(item.latestEpisode.episodeNumber || 0) > 0)) return false;\n  const expectedEpisodeCount = Number(item.sourceEpisodeCount || 0);\n  // Old/completed archives must not be published partially. Ongoing series may\n  // expose the currently available episodes, but their badge still comes from\n  // the actual sanitized episode list above.\n  if (item.isAiring !== true && expectedEpisodeCount > actualEpisodeCount) return false;\n  // Iranian narrative archives are intentionally hidden while their clean`,
  'series visibility uses actual episodes',
);

await fs.writeFile(path, source, 'utf8');
console.log('Client series episode count/latest/visibility now derive from usable sanitized episode media.');

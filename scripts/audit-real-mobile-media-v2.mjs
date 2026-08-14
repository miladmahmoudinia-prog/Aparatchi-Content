import fs from 'node:fs/promises';

const normalize = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
  .trim();

const index = JSON.parse(await fs.readFile('catalog-index.json', 'utf8'));
const items = Array.isArray(index.items) ? index.items : [];

const directFileUsable = (file) => {
  const url = String(file?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return false;
  const mode = String(file?.mode || 'download');
  if (mode === 'operator-play' || mode === 'operator-download') {
    return file?.panelVerified === true && file?.operatorOnly === true;
  }
  if (mode === 'play') return /\.(?:m3u8|mp4)(?:$|[?#])/i.test(url);
  return /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(url);
};

const episodeKey = (section) => {
  const episode = Number(section?.episodeNumber || 0);
  if (!(episode > 0)) return '';
  return `${Math.max(1, Number(section?.seasonNumber || 1))}:${episode}`;
};

const sampleQueries = ['ویلای من', 'قلب یخی', 'درد مشترک'];
const sampleResults = [];
const failures = [];
let missingDetailFiles = 0;
let visibleMoviesWithoutMedia = 0;
let visibleSeriesWithoutEpisodes = 0;
let seriesCountMismatch = 0;

for (const summary of items) {
  if (!summary?.detailPath) {
    failures.push({ id: summary?.id, title: summary?.nameFa || summary?.name, reason: 'missing-detail-path' });
    continue;
  }

  let detail;
  try {
    detail = JSON.parse(await fs.readFile(summary.detailPath, 'utf8'));
  } catch {
    missingDetailFiles += 1;
    failures.push({ id: summary.id, title: summary.nameFa || summary.name, reason: 'detail-file-missing', detailPath: summary.detailPath });
    continue;
  }

  const sections = Array.isArray(detail.downloads) ? detail.downloads : [];
  const files = sections.flatMap((section) => Array.isArray(section?.files) ? section.files : []);
  const usableFiles = files.filter(directFileUsable);

  if (summary.type === 'movie') {
    if (!usableFiles.length) {
      visibleMoviesWithoutMedia += 1;
      failures.push({ id: summary.id, title: summary.nameFa || summary.name, reason: 'visible-movie-no-usable-media' });
    }
  } else if (summary.type === 'series') {
    const usableEpisodeKeys = new Set(
      sections
        .filter((section) => (section.files || []).some(directFileUsable))
        .map(episodeKey)
        .filter(Boolean),
    );
    if (!usableEpisodeKeys.size) {
      visibleSeriesWithoutEpisodes += 1;
      failures.push({ id: summary.id, title: summary.nameFa || summary.name, reason: 'visible-series-no-usable-episodes' });
    }
    if (Number(summary.episodeCount || 0) !== usableEpisodeKeys.size) {
      seriesCountMismatch += 1;
      failures.push({
        id: summary.id,
        title: summary.nameFa || summary.name,
        reason: 'episode-count-mismatch',
        summaryEpisodeCount: Number(summary.episodeCount || 0),
        usableEpisodeCount: usableEpisodeKeys.size,
      });
    }
  }

  const haystack = normalize([summary.nameFa, summary.name].filter(Boolean).join(' '));
  for (const query of sampleQueries) {
    if (!haystack.includes(normalize(query))) continue;
    sampleResults.push({
      query,
      id: summary.id,
      type: summary.type,
      nameFa: summary.nameFa,
      name: summary.name,
      detailPath: summary.detailPath,
      sectionCount: sections.length,
      usableFileCount: usableFiles.length,
      episodeCount: summary.episodeCount || 0,
      usableEpisodeCount: summary.type === 'series'
        ? new Set(sections.filter((section) => (section.files || []).some(directFileUsable)).map(episodeKey).filter(Boolean)).size
        : 0,
      modes: [...new Set(usableFiles.map((file) => file.mode || 'download'))],
    });
  }
}

console.log(JSON.stringify({
  indexItems: items.length,
  sampleResults,
  missingDetailFiles,
  visibleMoviesWithoutMedia,
  visibleSeriesWithoutEpisodes,
  seriesCountMismatch,
  failureCount: failures.length,
  firstFailures: failures.slice(0, 50),
}, null, 2));

if (missingDetailFiles || visibleMoviesWithoutMedia || visibleSeriesWithoutEpisodes || seriesCountMismatch) {
  process.exitCode = 1;
}

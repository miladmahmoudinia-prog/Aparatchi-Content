import fs from 'node:fs/promises';
import { buildClientCatalogArtifacts } from './client-catalog.mjs';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const artifacts = buildClientCatalogArtifacts(catalog);
const clientById = new Map(artifacts.index.items.map((item) => [String(item.id), item]));
const detailsByPath = new Map(artifacts.detailFiles.map((detail) => [detail.path, JSON.parse(detail.serialized)]));

const hasHttp = (value) => /^https?:\/\//i.test(String(value || '').trim());
const normalizedUrl = (value) => String(value || '').trim();
const isStructurallyUsable = (file) => {
  const url = normalizedUrl(file?.url);
  if (!hasHttp(url)) return false;
  const mode = String(file?.mode || 'download');
  if (mode === 'operator-download' || mode === 'operator-play') return true;
  if (mode === 'play') return /\.(?:m3u8|mp4)(?:$|[?#])/i.test(url);
  return /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(url);
};
const languageFromText = (value) => {
  const text = String(value || '');
  if (/دوبله|دو\s*زبانه|دوزبانه|صوت\s*فارسی|صدای\s*فارسی|persian\s*(?:dub|audio|voice)|farsi\s*(?:dub|audio|voice)|dubbed|\bdub\b/i.test(text)) return 'dubbed';
  if (/زیر\s*نویس|زير\s*نويس|هارد\s*ساب|سافت\s*ساب|persian\s*sub|farsi\s*sub|subtitle|subbed|\bsub\b/i.test(text)) return 'subtitled';
  return '';
};
const detectedLanguage = (file, section) => {
  if (file?.language === 'dubbed' || file?.language === 'subtitled') return file.language;
  return languageFromText([section?.title, section?.badge, section?.language, file?.label].filter(Boolean).join(' '));
};
const mediaRows = (item) => (Array.isArray(item?.downloads) ? item.downloads : []).flatMap((section) =>
  (Array.isArray(section?.files) ? section.files : []).map((file) => ({ section, file }))
);
const normalSourceRows = (item) => mediaRows(item).filter(({ file }) =>
  isStructurallyUsable(file) && !String(file?.mode || '').startsWith('operator-')
);
const clientRows = (item) => mediaRows(item).filter(({ file }) => isStructurallyUsable(file));
const rowUrls = (rows) => new Set(rows.map(({ file }) => normalizedUrl(file?.url)).filter(Boolean));
const titleHasDubbed = (item) => mediaRows(item).some(({ section, file }) =>
  isStructurallyUsable(file) && detectedLanguage(file, section) === 'dubbed'
);

const sourceMoviesWithNormalMedia = [];
const missingClientTitles = [];
const detailUrlLoss = [];
const summaryUrlLoss = [];
const sourceDubbedMovieIds = new Set();
const clientDubbedMovieIds = new Set();
const dubbedLostIds = [];

for (const item of catalog.items || []) {
  if (item?.type !== 'movie' || item?.operatorOnly === true) continue;
  const sourceRows = normalSourceRows(item);
  if (sourceRows.length) sourceMoviesWithNormalMedia.push(item.id);
  if (titleHasDubbed(item)) sourceDubbedMovieIds.add(String(item.id));
  if (!sourceRows.length) continue;

  const summary = clientById.get(String(item.id));
  if (!summary) {
    missingClientTitles.push({ id: item.id, name: item.name, nameFa: item.nameFa, sourceMedia: sourceRows.length });
    continue;
  }

  if ((summary.availableLanguages || []).includes('dubbed') || titleHasDubbed(summary)) {
    clientDubbedMovieIds.add(String(item.id));
  }

  const detail = detailsByPath.get(summary.detailPath);
  const sourceUrls = rowUrls(sourceRows);
  const detailUrls = rowUrls(clientRows(detail));
  const summaryUrls = rowUrls(clientRows(summary));
  const missingDetailUrls = [...sourceUrls].filter((url) => !detailUrls.has(url));
  const missingSummaryUrls = [...sourceUrls].filter((url) => !summaryUrls.has(url));
  if (missingDetailUrls.length) detailUrlLoss.push({ id: item.id, nameFa: item.nameFa, name: item.name, lost: missingDetailUrls.length, total: sourceUrls.size });
  if (missingSummaryUrls.length) summaryUrlLoss.push({ id: item.id, nameFa: item.nameFa, name: item.name, lost: missingSummaryUrls.length, total: sourceUrls.size });
}

for (const id of sourceDubbedMovieIds) {
  const summary = clientById.get(id);
  if (!summary) {
    dubbedLostIds.push(id);
    continue;
  }
  const detail = detailsByPath.get(summary.detailPath);
  if ((summary.availableLanguages || []).includes('dubbed') || titleHasDubbed(summary) || titleHasDubbed(detail)) {
    clientDubbedMovieIds.add(id);
  } else {
    dubbedLostIds.push(id);
  }
}

const clientDubbedCategoryMovies = artifacts.index.items.filter((item) =>
  item?.type === 'movie' && (item.categoryKeys || []).includes('dubbed')
);
const bootstrapDubbedCategoryMovies = artifacts.bootstrap.items.filter((item) =>
  item?.type === 'movie' && (item.categoryKeys || []).includes('dubbed')
);
const indexMoviesWithMedia = artifacts.index.items.filter((item) =>
  item?.type === 'movie' && clientRows(item).length > 0
);

const metrics = {
  sourceMoviesWithNormalMedia: sourceMoviesWithNormalMedia.length,
  clientIndexMovies: artifacts.index.items.filter((item) => item?.type === 'movie').length,
  clientIndexMoviesWithImmediateMedia: indexMoviesWithMedia.length,
  sourceMediaTitlesMissingFromClient: missingClientTitles.length,
  sourceUrlsLostFromClientDetailTitles: detailUrlLoss.length,
  sourceUrlsLostFromClientSummaryTitles: summaryUrlLoss.length,
  sourceDubbedMovies: sourceDubbedMovieIds.size,
  clientDubbedMoviesByTruth: clientDubbedMovieIds.size,
  dubbedMoviesLost: dubbedLostIds.length,
  clientDubbedCategoryMovies: clientDubbedCategoryMovies.length,
  bootstrapDubbedCategoryMovies: bootstrapDubbedCategoryMovies.length,
};

console.log('REAL_CLIENT_MEDIA_METRICS=' + JSON.stringify(metrics));
console.log('MISSING_CLIENT_TITLES_SAMPLE=' + JSON.stringify(missingClientTitles.slice(0, 30)));
console.log('DETAIL_URL_LOSS_SAMPLE=' + JSON.stringify(detailUrlLoss.slice(0, 30)));
console.log('SUMMARY_URL_LOSS_SAMPLE=' + JSON.stringify(summaryUrlLoss.slice(0, 30)));
console.log('DUBBED_LOST_IDS_SAMPLE=' + JSON.stringify(dubbedLostIds.slice(0, 30)));
console.log('CLIENT_DUBBED_SAMPLE=' + JSON.stringify(clientDubbedCategoryMovies.slice(0, 20).map((item) => ({ id: item.id, nameFa: item.nameFa, name: item.name }))));

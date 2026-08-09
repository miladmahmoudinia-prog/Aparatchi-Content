import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const SUMMARY_FIELDS = [
  'id', 'slug', 'type', 'ir', 'year', 'nameFa', 'name', 'imdb', 'imdbVotes',
  'countryCodes', 'countryLabels', 'countryNames', 'originalLanguage',
  'collectionId', 'collectionNameFa', 'collectionName', 'collectionOrder',
  'poster', 'posterFallback', 'backdrop', 'backdropFallback', 'overview', 'genres', 'rate',
  'access', 'operatorOnly', 'operatorAccess', 'supportedOperators', 'availableLanguages',
  'episodeCount', 'seasonCount', 'latestEpisode', 'airDays', 'airTime', 'nextEpisodeAirDate',
  'nextEpisodeSeasonNumber', 'nextEpisodeNumber', 'isAiring', 'publicationStatus', 'archiveComplete',
  'archivePendingEpisodeCount', 'sourceEpisodeCount', 'archiveAuditStatus',
  'archiveEpisodeDiscoveryComplete', 'updateLabel', 'meaningfulUpdatedAt',
  'categoryKeys', 'categoryLabels', 'contentKind', 'isAnimation', 'isAnime', 'isTalkShow',
  'isDocumentary', 'isWildlife', 'mediaAuditStatus', 'createdAt', 'updatedAt', 'sourceCreatedAt', 'sourceUpdatedAt',
  'tmdbValidationVersion',
];

const stableJson = (value) => JSON.stringify(value, null, 2);
const digest = (value, length = 16) =>
  createHash('sha256').update(value).digest('hex').slice(0, length);

const truncateOverview = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 360 ? `${text.slice(0, 357).trimEnd()}…` : text;
};

export function clientSummaryForItem(item) {
  const summary = {};
  for (const field of SUMMARY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(item || {}, field)) summary[field] = item[field];
  }
  if (summary.overview) summary.overview = truncateOverview(summary.overview);
  if (!Array.isArray(summary.availableLanguages) || !summary.availableLanguages.length) {
    const text = (Array.isArray(item?.downloads) ? item.downloads : [])
      .flatMap((section) => [
        section?.title,
        section?.badge,
        ...(Array.isArray(section?.files)
          ? section.files.flatMap((file) => [file?.label, file?.language])
          : []),
      ])
      .filter(Boolean)
      .join(' ');
    summary.availableLanguages = [
      /دوبله|دو\s*زبانه|دوزبانه|صوت\s*فارسی|صدای\s*فارسی|فارسی\s*(?:دوبله|صدا)|persian\s*(?:dub|audio|voice)|farsi\s*(?:dub|audio|voice)|dual\s*audio|dubbed|\bdub\b/i.test(text) ? 'dubbed' : '',
      /زیر\s*نویس|زير\s*نويس|هارد\s*ساب|سافت\s*ساب|persian\s*sub|farsi\s*sub|subtitle|subbed|\bsub\b/i.test(text) ? 'subtitled' : '',
    ].filter(Boolean);
  }

  const identityHash = digest(`${item?.type || 'item'}:${item?.id || ''}`, 12);
  const detailSerialized = `${stableJson(item)}\n`;
  const contentHash = digest(detailSerialized, 12);
  summary.detailPath = `catalog-items/${identityHash}-${contentHash}.json`;
  return { summary, detailSerialized };
}

const isStructurallyUsableMediaFile = (file) => {
  const url = typeof file?.url === 'string' ? file.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) return false;
  const mode = String(file?.mode || 'download');
  if (mode === 'purchase' || mode === 'operator-download' || mode === 'operator-play') return true;
  if (mode === 'play') return /\.m3u8(?:$|[?#])|\.mp4(?:$|[?#])/i.test(url);
  return /\.mp4(?:$|[?#])/i.test(url);
};

const movieHasUsableClientMedia = (item) => {
  const streamUrl = typeof item?.streamUrl === 'string' ? item.streamUrl.trim() : '';
  if (/^https?:\/\//i.test(streamUrl) && /\.(?:m3u8|mp4)(?:$|[?#])/i.test(streamUrl)) return true;
  return (Array.isArray(item?.downloads) ? item.downloads : []).some((section) =>
    (Array.isArray(section?.files) ? section.files : []).some(isStructurallyUsableMediaFile),
  );
};

const seriesHasUsableClientMedia = (item) =>
  (Array.isArray(item?.downloads) ? item.downloads : []).some((section) =>
    (Array.isArray(section?.files) ? section.files : []).some(isStructurallyUsableMediaFile),
  );

const isClientVisibleItem = (item) => {
  if (!item || !item.id || !item.type) return false;
  if (item.type === 'movie') {
    if (item.mediaAuditStatus === 'confirmed-unavailable') return false;
    // Never publish a movie detail that has no usable play/download/purchase
    // action. The server record stays intact and the oldest-year repair queue
    // retries it until media becomes available.
    return movieHasUsableClientMedia(item);
  }
  if (item.type !== 'series') return true;
  // Keep the server-side record forever, but do not expose a completely empty
  // series detail to users while the media-repair/backfill queue is still
  // working. A previously visible series with at least one usable episode stays
  // visible even while gaps are repaired.
  if (!seriesHasUsableClientMedia(item)) return false;
  return item.publicationStatus === 'published' || item.archiveComplete === true || item.visibilityLocked === true;
};

export function buildClientCatalogArtifacts(catalog) {
  const detailFiles = [];
  const items = [];

  for (const item of Array.isArray(catalog?.items) ? catalog.items : []) {
    if (!isClientVisibleItem(item)) continue;
    const { summary, detailSerialized } = clientSummaryForItem(item);
    // Every series admitted to the lightweight client index is intentionally
    // visible. Normalize this bit so an older catalog missing the field cannot
    // be hidden again by the mobile publication gate.
    if (item.type === 'series') summary.publicationStatus = 'published';
    items.push(summary);
    detailFiles.push({ path: summary.detailPath, serialized: detailSerialized });
  }

  const index = {
    version: catalog?.version || 'client-index',
    updatedAt: catalog?.updatedAt || new Date(0).toISOString(),
    items,
    iranianSchedule: Array.isArray(catalog?.iranianSchedule) ? catalog.iranianSchedule : [],
    weeklySchedule: Array.isArray(catalog?.weeklySchedule) ? catalog.weeklySchedule : [],
    featuredPeople: Array.isArray(catalog?.featuredPeople) ? catalog.featuredPeople : [],
    ...(catalog?.imdbTop100 ? { imdbTop100: catalog.imdbTop100 } : {}),
  };

  // Compact transport: this is downloaded by every app launch after a catalog
  // revision, so whitespace is pure network/parse overhead. Detail shards stay
  // human-readable because only one is fetched when a title opens.
  const indexSerialized = `${JSON.stringify(index)}\n`;
  return {
    index,
    indexSerialized,
    detailFiles,
    clientRevision: createHash('sha256').update(indexSerialized).digest('hex'),
    clientSizeBytes: Buffer.byteLength(indexSerialized),
  };
}

async function writeIfChanged(file, serialized) {
  try {
    if (await fs.readFile(file, 'utf8') === serialized) return false;
  } catch {
    // Missing file: create it below.
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, serialized, 'utf8');
  return true;
}

export async function writeClientCatalogArtifacts(root, catalog) {
  const artifacts = buildClientCatalogArtifacts(catalog);
  const indexPath = path.join(root, 'catalog-index.json');
  const detailsRoot = path.join(root, 'catalog-items');
  await fs.mkdir(detailsRoot, { recursive: true });

  let changedDetailFiles = 0;
  const referenced = new Set();
  for (const detail of artifacts.detailFiles) {
    referenced.add(path.basename(detail.path));
    if (await writeIfChanged(path.join(root, detail.path), detail.serialized)) changedDetailFiles += 1;
  }

  // Old content-addressed detail files are safe to remove once the new index is
  // written in the same commit. This keeps the repository bounded as links and
  // episode metadata evolve over time.
  try {
    const existing = await fs.readdir(detailsRoot);
    await Promise.all(existing
      .filter((name) => name.endsWith('.json') && !referenced.has(name))
      .map((name) => fs.rm(path.join(detailsRoot, name), { force: true })));
  } catch {
    // Directory cleanup is an optimization; never fail the hourly sync for it.
  }

  const indexChanged = await writeIfChanged(indexPath, artifacts.indexSerialized);
  return { ...artifacts, indexChanged, changedDetailFiles };
}

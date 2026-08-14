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

const compactPersonReferences = (people) => {
  const seen = new Set();
  const result = [];
  for (const person of Array.isArray(people) ? people : []) {
    if (!person || !['actor', 'director'].includes(String(person.role || ''))) continue;
    const id = typeof person.id === 'string' ? person.id.trim() : '';
    const tmdbId = Number(person.tmdbId || 0);
    const nameFa = typeof person.nameFa === 'string' ? person.nameFa.trim() : '';
    const name = typeof person.name === 'string' ? person.name.trim() : '';
    if (!id && !(tmdbId > 0) && !nameFa && !name) continue;

    const identity = tmdbId > 0
      ? `tmdb:${tmdbId}:${person.role}`
      : id
        ? `id:${id}:${person.role}`
        : `name:${String(name || nameFa).toLowerCase()}:${person.role}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    result.push({
      ...(id ? { id } : {}),
      ...(nameFa ? { nameFa } : {}),
      ...(name ? { name } : {}),
      role: person.role,
      ...(tmdbId > 0 ? { tmdbId } : {}),
    });
  }
  return result;
};

const normalizePersonWorkKey = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();

const peopleWorkKeysForPerson = (person) => {
  const keys = [];
  const tmdbId = Number(person?.tmdbId || 0);
  if (tmdbId > 0) keys.push('tmdb:' + tmdbId);
  for (const value of [person?.name, person?.nameFa]) {
    const normalized = normalizePersonWorkKey(value);
    if (normalized) keys.push('name:' + normalized);
  }
  return [...new Set(keys)];
};


const clientLanguageFromText = (value) => {
  const text = String(value || '');
  if (/دوبله|دو\s*زبانه|دوزبانه|صوت\s*فارسی|صدای\s*فارسی|persian\s*(?:dub|audio|voice)|farsi\s*(?:dub|audio|voice)|dubbed|\bdub\b/i.test(text)) return 'dubbed';
  if (/زیر\s*نویس|زير\s*نويس|هارد\s*ساب|سافت\s*ساب|persian\s*sub|farsi\s*sub|subtitle|subbed|\bsub\b/i.test(text)) return 'subtitled';
  return '';
};

const clientFileLanguage = (file, section) => {
  if (file?.language === 'dubbed' || file?.language === 'subtitled') return file.language;
  return clientLanguageFromText([section?.title, section?.badge, section?.language, file?.label].filter(Boolean).join(' '));
};

const verifiedOperatorOnlyFile = (file) => Boolean(
  file?.mode === 'operator-play' && file?.operatorOnly === true && file?.panelVerified === true &&
  Number(file?.trafficOo) === 1 && String(file?.url || '').trim().toLowerCase().startsWith('https://')
);

const clientSeriesFileIsUsable = (file) => {
  const url = typeof file?.url === 'string' ? file.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) return false;
  const mode = String(file?.mode || 'download');
  if (mode === 'operator-download' || mode === 'operator-play') return true;
  if (mode === 'play') return /\.(?:m3u8|mp4)(?:$|[?#])/i.test(url);
  return /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(url);
};

const deriveClientSeriesMediaTruth = (downloads) => {
  const episodes = new Map();
  for (const section of Array.isArray(downloads) ? downloads : []) {
    const seasonNumber = Math.max(1, Number(section?.seasonNumber || 1));
    const episodeNumber = Number(section?.episodeNumber || 0);
    if (!(episodeNumber > 0)) continue;
    if (!(Array.isArray(section?.files) && section.files.some(clientSeriesFileIsUsable))) continue;
    const key = `${seasonNumber}:${episodeNumber}`;
    const current = episodes.get(key);
    if (!current || (section.files || []).length > (current.files || []).length) episodes.set(key, section);
  }
  const ordered = [...episodes.values()].sort((a, b) =>
    Number(a.seasonNumber || 1) - Number(b.seasonNumber || 1) ||
    Number(a.episodeNumber || 0) - Number(b.episodeNumber || 0)
  );
  const latest = ordered.at(-1);
  return {
    episodeCount: ordered.length,
    seasonCount: new Set(ordered.map((section) => Number(section.seasonNumber || 1))).size,
    latestEpisode: latest ? {
      id: String(latest.sourceEpisodeId || latest.id || `s${latest.seasonNumber || 1}e${latest.episodeNumber || 0}`),
      seasonNumber: Math.max(1, Number(latest.seasonNumber || 1)),
      episodeNumber: Number(latest.episodeNumber || 0),
      ...(latest.title ? { title: latest.title } : {}),
    } : null,
  };
};

const sanitizeClientMediaItem = (item) => {
  if (!item || !['movie', 'series'].includes(item.type)) return item;
  const iranian = item.ir === true || (Array.isArray(item.countryCodes) && item.countryCodes.includes('IR'));
  const operatorVariant = item.operatorOnly === true;
  const prepared = (Array.isArray(item.downloads) ? item.downloads : []).map((section) => ({
    ...section,
    files: (Array.isArray(section?.files) ? section.files : []).flatMap((file) => {
      if (!file || typeof file !== 'object') return [];
      if (String(file.mode || '').startsWith('operator-')) {
        return operatorVariant && verifiedOperatorOnlyFile(file) ? [{ ...file }] : [];
      }
      if (operatorVariant) return [];
      const language = clientFileLanguage(file, section);
      // Missing language metadata is not proof that a real Upera file is bad.
      // Preserve it neutrally; the mobile UI must not invent dubbed/subtitled
      // labels for these rows. Positively identified languages still win.
      return [{ ...file, ...(language ? { language } : {}) }];
    }),
  }));

  // For foreign episodic media, a generic HLS row can carry stale language
  // metadata even though every actual downloadable rendition of that exact
  // episode proves one different language. In that one-language case the HLS
  // stream follows the episode's concrete files. This prevents a fake second
  // playback option while preserving the real online stream.
  if (!iranian && !operatorVariant) {
    for (const section of prepared) {
      if (!Number(section?.episodeNumber || 0)) continue;
      const concreteLanguages = [...new Set((section.files || [])
        .filter((file) => file?.mode !== 'play')
        .map((file) => file?.language)
        .filter((value) => value === 'dubbed' || value === 'subtitled'))];
      if (concreteLanguages.length !== 1) continue;
      const concreteLanguage = concreteLanguages[0];
      section.files = (section.files || []).map((file) =>
        file?.mode === 'play' && file?.language !== concreteLanguage
          ? { ...file, language: concreteLanguage }
          : file
      );
    }
  }

  const languagesByUrl = new Map();
  for (const section of prepared) {
    for (const file of section.files || []) {
      if (file.language !== 'dubbed' && file.language !== 'subtitled') continue;
      const url = String(file.url || '').trim();
      if (!url) continue;
      const set = languagesByUrl.get(url) || new Set();
      set.add(file.language);
      languagesByUrl.set(url, set);
    }
  }
  const conflicts = new Set([...languagesByUrl.entries()]
    .filter(([, set]) => set.has('dubbed') && set.has('subtitled'))
    .map(([url]) => url));

  const downloads = prepared.flatMap((section) => {
    const files = (section.files || []).filter((file) => !conflicts.has(String(file.url || '').trim()));
    if (!files.length) return [];
    const languages = [...new Set(files.map((file) => file.language).filter((value) => value === 'dubbed' || value === 'subtitled'))];
    if (languages.length === 1 && !Number(section?.episodeNumber || 0)) {
      const language = languages[0];
      return [{
        ...section,
        title: language === 'dubbed' ? 'دوبله فارسی' : 'زیرنویس فارسی',
        badge: language === 'dubbed' ? 'دوبله' : 'زیرنویس',
        language,
        files,
      }];
    }
    return [{ ...section, files }];
  });

  const seriesMediaTruth = item.type === 'series' ? deriveClientSeriesMediaTruth(downloads) : null;

  const availableLanguages = [...new Set(downloads.flatMap((section) =>
    (section.files || []).map((file) => file.language)
      .filter((value) => value === 'dubbed' || value === 'subtitled')
  ))];
  const hasVerifiedOperator = downloads.some((section) => (section.files || []).some(verifiedOperatorOnlyFile));
  if (operatorVariant && !hasVerifiedOperator) return null;

  const next = {
    ...item,
    downloads,
    availableLanguages,
    ...(seriesMediaTruth ? {
      episodeCount: seriesMediaTruth.episodeCount,
      seasonCount: seriesMediaTruth.seasonCount,
      latestEpisode: seriesMediaTruth.latestEpisode,
    } : {}),
    ...(operatorVariant ? {
      access: 'operator',
      operatorOnly: true,
      categoryKeys: [...new Set([...(item.categoryKeys || []).filter((key) => key !== 'mobile-operator'), 'mobile-operator'])],
      categoryLabels: [...new Set([...(item.categoryLabels || []).filter((label) => label !== 'ویژه اینترنت همراه'), 'ویژه اینترنت همراه'])],
    } : {
      operatorOnly: false,
      operatorAccess: undefined,
      supportedOperators: undefined,
      categoryKeys: (item.categoryKeys || []).filter((key) => key !== 'mobile-operator'),
      categoryLabels: (item.categoryLabels || []).filter((label) => label !== 'ویژه اینترنت همراه'),
    }),
  };
  if (!iranian && !operatorVariant) {
    delete next.streamUrl;
    delete next.streamMode;
  }
  return next;
};

const deriveClientLanguages = (item) => [...new Set(
  (Array.isArray(item?.downloads) ? item.downloads : []).flatMap((section) =>
    (Array.isArray(section?.files) ? section.files : [])
      .map((file) => clientFileLanguage(file, section))
  ).filter((value) => value === 'dubbed' || value === 'subtitled')
)];

export function clientSummaryForItem(item) {
  const summary = {};
  for (const field of SUMMARY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(item || {}, field)) summary[field] = item[field];
  }
  if (summary.overview) summary.overview = truncateOverview(summary.overview);
  summary.availableLanguages = deriveClientLanguages(item);

  // Actor/director profile pages need a reverse lookup from person -> titles.
  // Keep only identity fields in the lightweight index; photos, character names,
  // bios and the rest of the heavy cast payload remain in the lazy detail shard.
  // This preserves fast startup while preventing every person profile from
  // incorrectly showing "0 titles".
  const compactPeople = compactPersonReferences(item?.people);
  if (compactPeople.length) summary.people = compactPeople;

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
  if (mode === 'operator-download' || mode === 'operator-play') return true;
  if (mode === 'play') return /\.(?:m3u8|mp4)(?:$|[?#])/i.test(url);
  return /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(url);
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
    // Never publish a movie detail that has no usable play/download
    // action. The server record stays intact and the oldest-year repair queue
    // retries it until media becomes available.
    return movieHasUsableClientMedia(item);
  }
  if (item.type !== 'series') return true;
  const actualEpisodeCount = Number(item.episodeCount || 0);
  if (!(actualEpisodeCount > 0) || !item.latestEpisode || !(Number(item.latestEpisode.episodeNumber || 0) > 0)) return false;
  const expectedEpisodeCount = Number(item.sourceEpisodeCount || 0);
  // Old/completed archives must not be published partially. Ongoing series may
  // expose the currently available episodes, but their badge still comes from
  // the actual sanitized episode list above.
  if (item.isAiring !== true && expectedEpisodeCount > actualEpisodeCount) return false;
  // Iranian narrative archives are intentionally hidden while their clean
  // sequential rebuild is incomplete. Keep the legacy visibility lock only for
  // other series so a foreign title does not disappear during a background audit.
  if (!seriesHasUsableClientMedia(item)) return false;
  const keys = Array.isArray(item.categoryKeys) ? item.categoryKeys : [];
  const strictIranianArchive = Boolean(
    !item.isDocumentary &&
    item.contentKind !== 'documentary' &&
    (keys.includes('iranian-series') || (item.ir === true && !keys.includes('foreign-series')))
  );
  return item.publicationStatus === 'published' ||
    item.archiveComplete === true ||
    (!strictIranianArchive && item.visibilityLocked === true);
};

const parsedTimestamp = (value) => {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const clientCatalogFreshness = (item) => {
  // Do not use lastSyncedAt: it changes every hourly pass and would make the
  // entire archive look new. firstSeenAt represents a newly discovered title;
  // meaningfulUpdatedAt represents a genuinely new episode/content update.
  const candidates = item?.type === 'series'
    ? [
        item?.meaningfulUpdatedAt,
        item?.firstSeenAt,
        item?.sourceUpdatedAt,
        item?.sourceCreatedAt,
        item?.updatedAt,
        item?.createdAt,
      ]
    : [
        item?.firstSeenAt,
        item?.sourceCreatedAt,
        item?.createdAt,
        item?.sourceUpdatedAt,
        item?.updatedAt,
      ];
  return candidates.reduce((latest, value) => Math.max(latest, parsedTimestamp(value)), 0);
};

export function buildClientCatalogArtifacts(catalog) {
  const detailFiles = [];
  const items = [];
  const peopleWorks = Object.create(null);
  // Home and category rails intentionally preserve index order for speed.
  // Sort the lightweight index once here so a newly discovered title or a
  // series with a meaningful new episode naturally appears at the front.
  const sourceItems = [...(Array.isArray(catalog?.items) ? catalog.items : [])]
    .sort((a, b) => clientCatalogFreshness(b) - clientCatalogFreshness(a));

  for (const sourceItem of sourceItems) {
    const item = sanitizeClientMediaItem(sourceItem);
    if (!item || !isClientVisibleItem(item)) continue;
    const { summary, detailSerialized } = clientSummaryForItem(item);
    // Every series admitted to the lightweight client index is intentionally
    // visible. Normalize this bit so an older catalog missing the field cannot
    // be hidden again by the mobile publication gate.
    if (item.type === 'series') summary.publicationStatus = 'published';
    items.push(summary);
    for (const person of Array.isArray(summary.people) ? summary.people : []) {
      for (const key of peopleWorkKeysForPerson(person)) {
        if (!peopleWorks[key]) peopleWorks[key] = [];
        if (!peopleWorks[key].includes(summary.id)) peopleWorks[key].push(summary.id);
      }
    }
    detailFiles.push({ path: summary.detailPath, serialized: detailSerialized });
  }

  const index = {
    version: catalog?.version || 'client-index',
    updatedAt: catalog?.updatedAt || new Date(0).toISOString(),
    items,
    iranianSchedule: Array.isArray(catalog?.iranianSchedule) ? catalog.iranianSchedule : [],
    weeklySchedule: Array.isArray(catalog?.weeklySchedule) ? catalog.weeklySchedule : [],
    featuredPeople: Array.isArray(catalog?.featuredPeople) ? catalog.featuredPeople : [],
    peopleWorks,
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

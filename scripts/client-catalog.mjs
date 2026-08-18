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
  'isDocumentary', 'isWildlife', 'mediaAuditStatus', 'firstSeenAt', 'createdAt', 'updatedAt', 'sourceCreatedAt', 'sourceUpdatedAt',
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
      ...(person.roleLabel ? { roleLabel: person.roleLabel } : {}),
      ...(person.character ? { character: person.character } : {}),
      ...(person.image ? { image: person.image } : {}),
      ...(Number.isFinite(Number(person.order)) ? { order: Number(person.order) } : {}),
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

  // A contradictory language label must not make a real Upera media URL vanish.
  // Keep one neutral representative for each conflicted URL instead of deleting
  // the playable/downloadable media altogether. The neutral row is deliberately
  // separated from dubbed/subtitled sections so the mobile client cannot infer a
  // false language from the old section title.
  const conflictRepresentativeByUrl = new Map();
  const conflictScore = (file) => {
    const mode = String(file?.mode || 'download');
    if (mode === 'download') return 3;
    if (mode === 'play') return 2;
    return 1;
  };
  for (const section of prepared) {
    for (const file of section.files || []) {
      const url = String(file?.url || '').trim();
      if (!conflicts.has(url)) continue;
      const current = conflictRepresentativeByUrl.get(url);
      if (!current || conflictScore(file) > conflictScore(current)) conflictRepresentativeByUrl.set(url, file);
    }
  }
  const emittedConflictUrls = new Set();

  const downloads = prepared.flatMap((section) => {
    const files = (section.files || []).filter((file) => !conflicts.has(String(file.url || '').trim()));
    const neutralFiles = [];
    for (const file of section.files || []) {
      const url = String(file?.url || '').trim();
      if (!conflicts.has(url) || emittedConflictUrls.has(url)) continue;
      if (conflictRepresentativeByUrl.get(url) !== file) continue;
      emittedConflictUrls.add(url);
      neutralFiles.push({ ...file, language: undefined });
    }

    const result = [];
    if (files.length) {
      const languages = [...new Set(files.map((file) => file.language).filter((value) => value === 'dubbed' || value === 'subtitled'))];
      if (languages.length === 1 && !Number(section?.episodeNumber || 0)) {
        const language = languages[0];
        result.push({
          ...section,
          title: language === 'dubbed' ? 'دوبله فارسی' : 'زیرنویس فارسی',
          badge: language === 'dubbed' ? 'دوبله' : 'زیرنویس',
          language,
          files,
        });
      } else {
        result.push({ ...section, files });
      }
    }

    if (neutralFiles.length) {
      result.push({
        ...section,
        id: `${String(section?.id || "media")}-neutral`,
        title: Number(section?.episodeNumber || 0) ? `قسمت ${Number(section.episodeNumber)}` : 'نسخه قابل پخش',
        badge: undefined,
        language: undefined,
        files: neutralFiles,
      });
    }
    return result;
  });

  const seriesMediaTruth = item.type === 'series' ? deriveClientSeriesMediaTruth(downloads) : null;

  const availableLanguages = [...new Set(downloads.flatMap((section) =>
    (section.files || []).map((file) => file.language)
      .filter((value) => value === 'dubbed' || value === 'subtitled')
  ))];
  const languageCategoryKeys = [...new Set([
    ...(Array.isArray(item.categoryKeys) ? item.categoryKeys : [])
      .map((key) => String(key || '').trim())
      .filter((key) => key && key !== 'dubbed' && key !== 'subtitled'),
    ...availableLanguages,
  ])];
  const languageCategoryLabels = [...new Set([
    ...(Array.isArray(item.categoryLabels) ? item.categoryLabels : [])
      .filter((label) => label !== 'دوبله فارسی' && label !== 'زیرنویس فارسی'),
    ...(availableLanguages.includes('dubbed') ? ['دوبله فارسی'] : []),
    ...(availableLanguages.includes('subtitled') ? ['زیرنویس فارسی'] : []),
  ])];
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
      categoryKeys: [...new Set([...languageCategoryKeys.filter((key) => key !== 'mobile-operator'), 'mobile-operator'])],
      categoryLabels: [...new Set([...languageCategoryLabels.filter((label) => label !== 'ویژه اینترنت همراه'), 'ویژه اینترنت همراه'])],
    } : {
      operatorOnly: false,
      operatorAccess: undefined,
      supportedOperators: undefined,
      categoryKeys: languageCategoryKeys.filter((key) => key !== 'mobile-operator'),
      categoryLabels: languageCategoryLabels.filter((label) => label !== 'ویژه اینترنت همراه'),
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

const compactMovieDownloadsForSummary = (downloads) => (Array.isArray(downloads) ? downloads : []).flatMap((section) => {
  const files = (Array.isArray(section?.files) ? section.files : [])
    .filter(clientSeriesFileIsUsable)
    .map((file) => {
      const compact = {};
      for (const key of ['id', 'label', 'quality', 'size', 'url', 'mode', 'language', 'operatorOnly', 'panelVerified', 'trafficOo']) {
        if (file?.[key] !== undefined && file?.[key] !== null && file?.[key] !== '') compact[key] = file[key];
      }
      return compact;
    });
  if (!files.length) return [];
  const compactSection = { files };
  for (const key of ['id', 'title', 'badge', 'language']) {
    if (section?.[key] !== undefined && section?.[key] !== null && section?.[key] !== '') compactSection[key] = section[key];
  }
  return [compactSection];
});

const compactSeriesEpisodeDownloadsForSummary = (downloads) => (Array.isArray(downloads) ? downloads : []).flatMap((section) => {
  const episodeNumber = Number(section?.episodeNumber || 0);
  if (!(episodeNumber > 0)) return [];
  const usable = (Array.isArray(section?.files) ? section.files : []).filter(clientSeriesFileIsUsable);
  if (!usable.length) return [];

  const isDownload = (file) => ['download', 'operator-download'].includes(String(file?.mode || 'download'));
  const isPlayable = (file) =>
    ['play', 'operator-play'].includes(String(file?.mode || '')) ||
    /\.(?:m3u8|mp4)(?:$|[?#])/i.test(String(file?.url || ''));
  const download = usable.find(isDownload) || usable[0];
  const play = usable.find(isPlayable);
  const chosen = [download];
  if (play && play?.url !== download?.url) chosen.push(play);

  const files = chosen.slice(0, 2).map((file) => {
    const compact = {};
    for (const key of ['id', 'label', 'quality', 'size', 'url', 'mode', 'language', 'operatorOnly', 'panelVerified', 'trafficOo', 'supportedOperators']) {
      if (file?.[key] !== undefined && file?.[key] !== null && file?.[key] !== '') compact[key] = file[key];
    }
    return compact;
  });
  const compactSection = { files, episodeNumber };
  for (const key of ['id', 'title', 'subtitle', 'badge', 'artwork', 'language', 'sourceEpisodeId', 'seasonNumber', 'sourceUpdatedAt']) {
    if (section?.[key] !== undefined && section?.[key] !== null && section?.[key] !== '') compactSection[key] = section[key];
  }
  return [compactSection];
});

export function clientSummaryForItem(item) {
  const summary = {};
  for (const field of SUMMARY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(item || {}, field)) summary[field] = item[field];
  }
  if (summary.overview) summary.overview = truncateOverview(summary.overview);
  summary.availableLanguages = deriveClientLanguages(item);
  // Carry a small first-screen cast/director preview so opening a detail page
  // does not visibly add the whole People section one or two seconds later.
  // The immutable detail shard still hydrates the complete people list.
  const summaryPeople = compactPersonReferences(item.people).slice(0, 8);
  if (summaryPeople.length) summary.people = summaryPeople;

  // Movie detail actions should be usable from the lightweight index itself.
  // Carry only the small, actionable media rows for movies; series episode
  // archives remain detail-sharded so the client index stays bounded.
  if (item?.type === 'movie') {
    const compactDownloads = compactMovieDownloadsForSummary(item.downloads);
    if (compactDownloads.length) summary.downloads = compactDownloads;
    if (item.ir === true && /^https?:\/\//i.test(String(item.streamUrl || '').trim())) {
      summary.streamUrl = item.streamUrl;
      if (item.streamMode) summary.streamMode = item.streamMode;
    }
  } else if (item?.type === 'series') {
    const episodePreviews = compactSeriesEpisodeDownloadsForSummary(item.downloads);
    if (episodePreviews.length) summary.downloads = episodePreviews;
  }

  // The reverse peopleWorks index below preserves actor/director search and
  // profile works. Summaries keep only the bounded preview above; full metadata
  // remains in the content-addressed detail shard.

  const identityHash = digest(`${item?.type || 'item'}:${item?.id || ''}`, 12);
  const detailSerialized = `${stableJson(item)}\n`;
  const contentHash = digest(detailSerialized, 12);
  summary.detailPath = `catalog-items/${identityHash}-${contentHash}.json`;
  const stableDetailPath = `catalog-stable/${identityHash}.json`;
  const stableDetailSerialized = JSON.stringify({
    schemaVersion: 1,
    type: summary.type,
    id: summary.id,
    detailPath: summary.detailPath,
  });
  return { summary, detailSerialized, stableDetailPath, stableDetailSerialized };
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

const latestSeriesSourceEpisodeTimestamp = (item) =>
  (Array.isArray(item?.downloads) ? item.downloads : []).reduce((latest, section) => {
    if (!(Number(section?.episodeNumber || 0) > 0)) return latest;
    return Math.max(latest, parsedTimestamp(section?.sourceUpdatedAt));
  }, 0);

const clientCatalogFreshness = (item) => {
  // Do not use lastSyncedAt/updatedAt: metadata enrichment and hourly repair
  // must never make an old title look newly published. firstSeenAt is the
  // discovery time. A series meaningfulUpdatedAt is trusted only when its
  // update label names a new episode and the upstream episode timestamp is not
  // older than the title's first appearance in Aparatchi. This also repairs
  // ordering for old archives that were historically backfilled as "updates".
  const firstSeen = parsedTimestamp(item?.firstSeenAt);
  const meaningful = parsedTimestamp(item?.meaningfulUpdatedAt);
  const latestEpisodeSource = latestSeriesSourceEpisodeTimestamp(item);
  const hasEpisodeUpdateLabel = /^قسمت\s+.+\s+اضافه\s+شد$/u.test(String(item?.updateLabel || '').trim());
  const meaningfulIsCredible = Boolean(
    item?.type === 'series' &&
    meaningful > 0 &&
    hasEpisodeUpdateLabel &&
    (firstSeen <= 0 || latestEpisodeSource <= 0 || latestEpisodeSource >= firstSeen - 6 * 60 * 60 * 1000)
  );
  const candidates = item?.type === 'series'
    ? [
        meaningfulIsCredible ? item?.meaningfulUpdatedAt : '',
        item?.firstSeenAt,
        item?.sourceCreatedAt,
        item?.createdAt,
      ]
    : [
        item?.firstSeenAt,
        item?.sourceCreatedAt,
        item?.createdAt,
      ];
  return candidates.reduce((latest, value) => Math.max(latest, parsedTimestamp(value)), 0);
};

const BOOTSTRAP_CATEGORY_KEYS = [
  'mobile-operator', 'iranian-movies', 'foreign-movies', 'iranian-series', 'foreign-series',
  'korean-movies', 'korean-series', 'indian-movies', 'indian-series', 'anime-movies', 'anime-series',
  'animation-movies', 'animation-series', 'kids', 'programs', 'dubbed', 'subtitled', 'documentaries', 'wildlife', 'collections',
];

const BOOTSTRAP_NAVIGATION_FIELDS = [
  'id', 'slug', 'type', 'ir', 'year', 'nameFa', 'name', 'imdb',
  'countryCodes', 'originalLanguage', 'collectionId', 'collectionOrder',
  'poster', 'posterFallback', 'backdrop', 'backdropFallback', 'rate', 'access', 'operatorOnly', 'availableLanguages',
  'episodeCount', 'seasonCount', 'latestEpisode', 'isAiring', 'publicationStatus',
  'updateLabel', 'meaningfulUpdatedAt', 'categoryKeys', 'categoryLabels',
  'contentKind', 'isAnimation', 'isAnime', 'isTalkShow', 'isDocumentary', 'isWildlife',
  'firstSeenAt', 'createdAt', 'updatedAt', 'sourceCreatedAt', 'sourceUpdatedAt', 'detailPath',
];

const compactBootstrapMovieFile = (file) => ({
  ...(file?.id ? { id: file.id } : {}),
  ...(file?.quality ? { quality: file.quality } : {}),
  url: file.url,
  mode: file.mode,
  ...(file?.language ? { language: file.language } : {}),
  ...(file?.operatorOnly ? { operatorOnly: true } : {}),
  ...(file?.panelVerified ? { panelVerified: true } : {}),
  ...(file?.trafficOo != null ? { trafficOo: file.trafficOo } : {}),
});

const compactBootstrapMovieActionPreview = (downloads) => {
  const sections = Array.isArray(downloads) ? downloads : [];
  const candidates = sections.flatMap((section) =>
    (Array.isArray(section?.files) ? section.files : []).map((file) => ({ section, file })),
  );
  const isDownload = ({ file }) => ['download', 'operator-download'].includes(String(file?.mode || 'download'));
  const isPlayable = ({ file }) => ['play', 'operator-play'].includes(String(file?.mode || '')) || /\.(?:m3u8|mp4)(?:$|[?#])/i.test(String(file?.url || ''));
  const download = candidates.find(isDownload);
  const play = candidates.find(isPlayable);
  const chosen = [];
  if (download) chosen.push(download);
  if (play && (!download || !isPlayable(download)) && play.file?.url !== download?.file?.url) chosen.push(play);
  if (!chosen.length && play) chosen.push(play);
  if (!chosen.length) return [];
  const groups = new Map();
  for (const choice of chosen.slice(0, 2)) {
    const section = choice.section || {};
    const key = String(section.id || section.language || section.title || 'media');
    const current = groups.get(key) || {
      ...(section.id ? { id: section.id } : {}),
      ...(section.language ? { language: section.language } : {}),
      files: [],
    };
    current.files.push(compactBootstrapMovieFile(choice.file));
    groups.set(key, current);
  }
  return [...groups.values()];
};


const compactBootstrapSeriesEpisodePreviews = (downloads) =>
  (Array.isArray(downloads) ? downloads : []).flatMap((section) => {
    const episodeNumber = Number(section?.episodeNumber || 0);
    const files = Array.isArray(section?.files) ? section.files : [];
    if (!(episodeNumber > 0) || !files.length) return [];

    // Full index already limits each episode to at most two truthful action
    // files. Bootstrap needs only the coordinates and fields Mobile requires to
    // normalize/open those actions. Drop ids/labels/quality/timestamps here to
    // keep first-install transport below the historical 5 MB safety cap.
    const compactFiles = files.slice(0, 2).flatMap((file) => {
      const url = String(file?.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return [];
      return [{
        url,
        ...(file?.mode ? { mode: file.mode } : {}),
        ...(file?.language ? { language: file.language } : {}),
        ...(Array.isArray(file?.supportedOperators) && file.supportedOperators.length
          ? { supportedOperators: file.supportedOperators }
          : {}),
      }];
    });
    if (!compactFiles.length) return [];
    return [{
      episodeNumber,
      ...(Number(section?.seasonNumber || 0) > 1 ? { seasonNumber: Number(section.seasonNumber) } : {}),
      ...(section?.artwork ? { artwork: section.artwork } : {}),
      files: compactFiles,
    }];
  });

const compactBootstrapNavigationItem = (item) => {
  const compact = {};
  for (const field of BOOTSTRAP_NAVIGATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(item || {}, field)) compact[field] = item[field];
  }
  // Keep only enough people metadata for the first visible cast row. The full
  // detail shard remains authoritative and replaces this preview after hydration.
  if (Array.isArray(item?.people) && item.people.length) {
    compact.people = item.people.slice(0, 4);
  }
  if (item?.type === 'movie') {
    const downloads = compactBootstrapMovieActionPreview(item.downloads);
    if (downloads.length) compact.downloads = downloads;
    if (/^https?:\/\//i.test(String(item.streamUrl || '').trim())) compact.streamUrl = item.streamUrl;
    if (item.streamMode) compact.streamMode = item.streamMode;
  } else if (item?.type === 'series') {
    const downloads = compactBootstrapSeriesEpisodePreviews(item.downloads);
    if (downloads.length) compact.downloads = downloads;
  }
  return compact;
};

const bootstrapItemsForHome = (items) => {
  const source = Array.isArray(items) ? items : [];
  const picked = [];
  const seen = new Set();
  const add = (item) => {
    const id = String(item?.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    picked.push(item);
    return true;
  };

  // Preserve the newest front of the client index for Hero/latest rails.
  source.slice(0, 36).forEach(add);

  // Preserve genuinely new/updated titles even if they are not near the
  // catalog head. Reuse the same truth function; metadata timestamps must not
  // make an old title a Home-critical row.
  [...source]
    .sort((a, b) => clientCatalogFreshness(b) - clientCatalogFreshness(a))
    .slice(0, 24)
    .forEach(add);

  // Home must never wait for the multi-megabyte full index just to populate
  // a common rail. Keep up to twelve real summaries for every Home category.
  for (const key of BOOTSTRAP_CATEGORY_KEYS) {
    let count = 0;
    for (const item of source) {
      if (!(Array.isArray(item?.categoryKeys) && item.categoryKeys.includes(key))) continue;
      if (add(item)) count += 1;
      else if (seen.has(String(item?.id || ''))) count += 1;
      if (count >= 12) break;
    }
  }

  return picked;
};

export function buildClientCatalogArtifacts(catalog) {
  const detailFiles = [];
  const stableDetailFiles = [];
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
    const { summary, detailSerialized, stableDetailPath, stableDetailSerialized } = clientSummaryForItem(item);
    // Every series admitted to the lightweight client index is intentionally
    // visible. Normalize this bit so an older catalog missing the field cannot
    // be hidden again by the mobile publication gate.
    if (item.type === 'series') summary.publicationStatus = 'published';
    const itemIndex = items.length;
    items.push(summary);
    for (const person of Array.isArray(item.people) ? item.people : []) {
      for (const key of peopleWorkKeysForPerson(person)) {
        if (!peopleWorks[key]) peopleWorks[key] = [];
        // Transport item indexes instead of repeating long string IDs for every
        // actor alias. The mobile parser resolves these indexes back to the
        // existing item.id strings without duplicating string payloads.
        if (!peopleWorks[key].includes(itemIndex)) peopleWorks[key].push(itemIndex);
      }
    }
    detailFiles.push({ path: summary.detailPath, serialized: detailSerialized });
    stableDetailFiles.push({ path: stableDetailPath, serialized: stableDetailSerialized });
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

  // Fresh installs should paint a truthful Home immediately instead of exposing
  // the tiny bundled emergency catalog while the full client index is downloading.
  // The bootstrap is intentionally Home-only; detailPath still points at the
  // immutable detail shards and the full index replaces it in the background.
  const richHomeItems = bootstrapItemsForHome(items);
  const richHomeIds = new Set(richHomeItems.map((item) => String(item?.id || '')).filter(Boolean));
  // Bootstrap is also the first navigation catalog. Every visible title must be
  // present so categories/search can never collapse to the old 8–12 item Home
  // sample. Only Home-critical rows keep their heavier media/overview payload;
  // the rest retain enough metadata to browse and hydrate their detail shard.
  const bootstrapItems = items.map((item) => {
    if (!richHomeIds.has(String(item?.id || ''))) return compactBootstrapNavigationItem(item);
    if (item?.type !== 'series') return item;
    const downloads = compactBootstrapSeriesEpisodePreviews(item.downloads);
    return downloads.length ? { ...item, downloads } : item;
  });
  const bootstrap = {
    version: index.version,
    updatedAt: index.updatedAt,
    items: bootstrapItems,
    iranianSchedule: index.iranianSchedule,
    weeklySchedule: index.weeklySchedule,
    featuredPeople: index.featuredPeople,
    ...(index.imdbTop100 ? { imdbTop100: index.imdbTop100 } : {}),
  };
  const bootstrapSerialized = `${JSON.stringify(bootstrap)}\n`;

  return {
    index,
    indexSerialized,
    bootstrap,
    bootstrapSerialized,
    detailFiles,
    stableDetailFiles,
    clientRevision: createHash('sha256').update(indexSerialized).digest('hex'),
    clientSizeBytes: Buffer.byteLength(indexSerialized),
    bootstrapRevision: createHash('sha256').update(bootstrapSerialized).digest('hex'),
    bootstrapSizeBytes: Buffer.byteLength(bootstrapSerialized),
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
  const bootstrapPath = path.join(root, 'catalog-bootstrap.json');
  const detailsRoot = path.join(root, 'catalog-items');
  const stableDetailsRoot = path.join(root, 'catalog-stable');
  await fs.mkdir(detailsRoot, { recursive: true });
  await fs.mkdir(stableDetailsRoot, { recursive: true });

  let changedDetailFiles = 0;
  let changedStableDetailFiles = 0;
  const referenced = new Set();
  for (const detail of artifacts.detailFiles) {
    referenced.add(path.basename(detail.path));
    if (await writeIfChanged(path.join(root, detail.path), detail.serialized)) changedDetailFiles += 1;
  }

  const stableReferenced = new Set();
  for (const detail of artifacts.stableDetailFiles) {
    stableReferenced.add(path.basename(detail.path));
    if (await writeIfChanged(path.join(root, detail.path), detail.serialized)) changedStableDetailFiles += 1;
  }

  // Stable aliases are tiny pointers to the current content-addressed detail.
  // A stale CDN index can derive catalog-stable/<identity>.json from its old
  // hashed path, then follow the pointer to the current shard. This avoids
  // duplicating every large movie/series detail while keeping recovery permanent.
  // Old content-addressed detail files can therefore stay bounded.
  try {
    const existing = await fs.readdir(detailsRoot);
    await Promise.all(existing
      .filter((name) => name.endsWith('.json') && !referenced.has(name))
      .map((name) => fs.rm(path.join(detailsRoot, name), { force: true })));
  } catch {
    // Directory cleanup is an optimization; never fail the hourly sync for it.
  }

  try {
    const existingStable = await fs.readdir(stableDetailsRoot);
    await Promise.all(existingStable
      .filter((name) => name.endsWith('.json') && !stableReferenced.has(name))
      .map((name) => fs.rm(path.join(stableDetailsRoot, name), { force: true })));
  } catch {
    // Stable alias cleanup is bounded housekeeping only.
  }

  const indexChanged = await writeIfChanged(indexPath, artifacts.indexSerialized);
  const bootstrapChanged = await writeIfChanged(bootstrapPath, artifacts.bootstrapSerialized);
  return { ...artifacts, indexChanged, bootstrapChanged, changedDetailFiles, changedStableDetailFiles };
}

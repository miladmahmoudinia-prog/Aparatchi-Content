import fs from 'node:fs/promises';
import { buildClientCatalogArtifacts } from './client-catalog.mjs';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const artifacts = buildClientCatalogArtifacts(catalog);
const details = new Map(artifacts.detailFiles.map((entry) => [entry.path, JSON.parse(entry.serialized)]));

const LANGUAGE_ORDER = ['dubbed', 'subtitled'];
const isHttp = (value) => /^https?:\/\//i.test(String(value || '').trim());
const isDirect = (value) => /\.(?:m3u8|mp4)(?:$|[?#])/i.test(String(value || '').trim());
const isDownloadable = (value) => /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(String(value || '').trim());
const isOperator = (file) => /^operator-/.test(String(file?.mode || ''));
const isEpisode = (section) => Number(section?.episodeNumber || 0) > 0;
const languageFromText = (value) => {
  const text = String(value || '');
  if (/دوبله|دو\s*زبانه|دوزبانه|صوت\s*فارسی|صدای\s*فارسی|persian\s*(?:dub|audio|voice)|farsi\s*(?:dub|audio|voice)|dubbed|\bdub\b/i.test(text)) return 'dubbed';
  if (/زیر\s*نویس|زير\s*نويس|هارد\s*ساب|سافت\s*ساب|persian\s*sub|farsi\s*sub|subtitle|subbed|\bsub\b/i.test(text)) return 'subtitled';
  return '';
};
const sectionLanguage = (section) => {
  if (section?.language === 'dubbed' || section?.language === 'subtitled') return section.language;
  return languageFromText([section?.title, section?.badge].filter(Boolean).join(' '));
};
const filesWithSectionLanguage = (sections) => sections.flatMap((section) => {
  const hint = sectionLanguage(section);
  return (section?.files || []).map((file) => file?.language || !hint ? file : { ...file, language: hint });
});

const reconcileCurrent = (files) => {
  const prepared = files.map((file) => ({ ...file }));
  const languagesByUrl = new Map();
  for (const file of prepared) {
    if (!file?.url || !LANGUAGE_ORDER.includes(file.language)) continue;
    const key = String(file.url).trim();
    const set = languagesByUrl.get(key) || new Set();
    set.add(file.language);
    languagesByUrl.set(key, set);
  }
  const conflicted = new Set([...languagesByUrl.entries()]
    .filter(([, set]) => set.has('dubbed') && set.has('subtitled'))
    .map(([url]) => url));
  const safe = conflicted.size ? (() => {
    const result = [];
    const emitted = new Set();
    for (const file of prepared) {
      const url = String(file?.url || '').trim();
      if (!conflicted.has(url)) { result.push(file); continue; }
      if (emitted.has(url)) continue;
      const same = prepared.filter((candidate) => String(candidate?.url || '').trim() === url);
      const representative = same.find((candidate) => String(candidate?.mode || 'download') === 'download')
        || same.find((candidate) => String(candidate?.mode || '') === 'play') || file;
      if (representative !== file) continue;
      emitted.add(url);
      result.push({ ...representative, language: undefined });
    }
    return result;
  })() : prepared;
  const explicit = new Set(safe.map((file) => file?.language).filter((value) => LANGUAGE_ORDER.includes(value)));
  const hasUnknown = safe.some((file) => !file?.language);
  if (!hasUnknown) return safe;
  if (explicit.size > 0) return safe.filter((file) => LANGUAGE_ORDER.includes(file?.language));
  return safe;
};

const reconcileProposed = (files) => {
  const prepared = files.map((file) => ({ ...file }));
  const languagesByUrl = new Map();
  for (const file of prepared) {
    if (!file?.url || !LANGUAGE_ORDER.includes(file.language)) continue;
    const key = String(file.url).trim();
    const set = languagesByUrl.get(key) || new Set();
    set.add(file.language);
    languagesByUrl.set(key, set);
  }
  const conflicted = new Set([...languagesByUrl.entries()]
    .filter(([, set]) => set.has('dubbed') && set.has('subtitled'))
    .map(([url]) => url));
  if (!conflicted.size) return prepared;
  const result = [];
  const emitted = new Set();
  for (const file of prepared) {
    const url = String(file?.url || '').trim();
    if (!conflicted.has(url)) { result.push(file); continue; }
    if (emitted.has(url)) continue;
    const same = prepared.filter((candidate) => String(candidate?.url || '').trim() === url);
    const representative = same.find((candidate) => String(candidate?.mode || 'download') === 'download')
      || same.find((candidate) => String(candidate?.mode || '') === 'play') || file;
    if (representative !== file) continue;
    emitted.add(url);
    result.push({ ...representative, language: undefined });
  }
  return result;
};

const currentDetailLanguages = (item) => LANGUAGE_ORDER.filter((language) =>
  (item?.downloads || []).some((section) => (section?.files || []).some((file) => !isOperator(file) && file?.language === language))
);
const proposedDetailLanguages = (item) => LANGUAGE_ORDER.filter((language) =>
  (item?.availableLanguages || []).includes(language) ||
  (item?.downloads || []).some((section) => {
    const hint = sectionLanguage(section);
    return hint === language || (section?.files || []).some((file) => !isOperator(file) && file?.language === language);
  })
);

const movieActions = (item, reconciler) => {
  const sections = (item?.downloads || []).filter((section) => !isEpisode(section));
  const files = reconciler(filesWithSectionLanguage(sections));
  const hasPlay = files.some((file) => !isOperator(file) && isHttp(file?.url) && isDirect(file?.url));
  const hasDownload = files.some((file) => !isOperator(file) && String(file?.mode || 'download') === 'download' && isHttp(file?.url) && isDownloadable(file?.url));
  const hasRawDownloadButton = sections.some((section) => (section?.files || []).some((file) => ['download', 'operator-download'].includes(String(file?.mode || 'download'))));
  return { hasPlay, hasDownload, hasRawDownloadButton, files };
};

const uiPlayRecovered = [];
const badgeRecovered = [];
const noActionGenerated = [];
const named = [];
const wanted = [
  'yaksha', 'یاکشا', 'دادشاه', 'romantic robbery', 'دزدی عاشقانه', 'toni kroos', 'تونی کروس',
  'prophet', 'پیامبر', 'becassine', 'بکاسین', 'i lost my body', 'بدنم را از دست دادم',
  'tales from earthsea', 'کیمیاگر', 'perfect crown', 'تاج کامل', 'to my beloved thief', 'برای دزد عزیزم'
];

for (const summary of artifacts.index.items || []) {
  const detail = details.get(summary.detailPath);
  if (!detail) continue;
  const title = `${detail.nameFa || ''} ${detail.name || ''}`.toLowerCase();
  if (wanted.some((term) => title.includes(term.toLowerCase()))) {
    const current = detail.type === 'movie' ? movieActions(detail, reconcileCurrent) : null;
    const proposed = detail.type === 'movie' ? movieActions(detail, reconcileProposed) : null;
    named.push({
      id: detail.id, type: detail.type, nameFa: detail.nameFa, name: detail.name,
      availableLanguages: detail.availableLanguages || [],
      currentDetailLanguages: currentDetailLanguages(detail),
      proposedDetailLanguages: proposedDetailLanguages(detail),
      currentActions: current ? { play: current.hasPlay, download: current.hasDownload, rawDownloadButton: current.hasRawDownloadButton } : undefined,
      proposedActions: proposed ? { play: proposed.hasPlay, download: proposed.hasDownload, rawDownloadButton: proposed.hasRawDownloadButton } : undefined,
      sectionCount: (detail.downloads || []).length,
      fileCount: (detail.downloads || []).reduce((sum, section) => sum + (section.files || []).length, 0),
      modes: [...new Set((detail.downloads || []).flatMap((section) => (section.files || []).map((file) => String(file?.mode || 'download'))))],
    });
  }

  const currentLanguages = currentDetailLanguages(detail);
  const proposedLanguages = proposedDetailLanguages(detail);
  if (!currentLanguages.includes('dubbed') && proposedLanguages.includes('dubbed')) {
    badgeRecovered.push({ id: detail.id, type: detail.type, nameFa: detail.nameFa, name: detail.name });
  }

  if (detail.type !== 'movie') continue;
  const current = movieActions(detail, reconcileCurrent);
  const proposed = movieActions(detail, reconcileProposed);
  if (!current.hasPlay && proposed.hasPlay) {
    uiPlayRecovered.push({ id: detail.id, nameFa: detail.nameFa, name: detail.name, currentDownload: current.hasDownload, proposedDownload: proposed.hasDownload });
  }
  if (!current.hasPlay && !current.hasDownload && !current.hasRawDownloadButton) {
    noActionGenerated.push({ id: detail.id, nameFa: detail.nameFa, name: detail.name, availableLanguages: detail.availableLanguages || [] });
  }
}

console.log('MOBILE_UI_REAL_METRICS=' + JSON.stringify({
  clientItems: artifacts.index.items.length,
  uiPlayRecoveredByPreservingNeutral: uiPlayRecovered.length,
  dubbedBadgeRecoveredByUnifiedTruth: badgeRecovered.length,
  generatedMoviesWithNoCurrentAction: noActionGenerated.length,
}));
console.log('UI_PLAY_RECOVERED_SAMPLE=' + JSON.stringify(uiPlayRecovered.slice(0, 40)));
console.log('BADGE_RECOVERED_SAMPLE=' + JSON.stringify(badgeRecovered.slice(0, 40)));
console.log('NO_ACTION_GENERATED_SAMPLE=' + JSON.stringify(noActionGenerated.slice(0, 40)));
console.log('NAMED_DEVICE_SAMPLES=' + JSON.stringify(named));

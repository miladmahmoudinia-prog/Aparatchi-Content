import fs from 'node:fs/promises';
import { buildClientCatalogArtifacts } from './client-catalog.mjs';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const artifacts = buildClientCatalogArtifacts(catalog);
const details = new Map(artifacts.detailFiles.map((entry) => [entry.path, JSON.parse(entry.serialized)]));
const sourceById = new Map((catalog.items || []).map((item) => [String(item.id), item]));

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

const currentDetailLanguages = (item) => LANGUAGE_ORDER.filter((language) =>
  (item?.downloads || []).some((section) => (section?.files || []).some((file) => !isOperator(file) && file?.language === language))
);
const movieActions = (item) => {
  const sections = (item?.downloads || []).filter((section) => !isEpisode(section));
  const files = reconcileCurrent(filesWithSectionLanguage(sections));
  const hasPlay = files.some((file) => !isOperator(file) && isHttp(file?.url) && isDirect(file?.url));
  const hasDownload = files.some((file) => !isOperator(file) && String(file?.mode || 'download') === 'download' && isHttp(file?.url) && isDownloadable(file?.url));
  const hasRawDownloadButton = sections.some((section) => (section?.files || []).some((file) => ['download', 'operator-download'].includes(String(file?.mode || 'download'))));
  return { hasPlay, hasDownload, hasRawDownloadButton };
};
const compactFile = (file) => ({
  id: file?.id, mode: file?.mode, language: file?.language, label: file?.label,
  quality: file?.quality, sourceType: file?.sourceType, audio: file?.audio,
  subtitle: file?.subtitle, urlTail: String(file?.url || '').slice(-90),
});
const compactSection = (section) => ({
  id: section?.id, title: section?.title, badge: section?.badge, language: section?.language,
  seasonNumber: section?.seasonNumber, episodeNumber: section?.episodeNumber,
  subtitle: section?.subtitle,
  files: (section?.files || []).slice(0, 8).map(compactFile),
});
const languageishObject = (item) => Object.fromEntries(Object.entries(item || {}).filter(([key]) =>
  /lang|audio|dub|sub|voice|version|media|tag|label|badge|title/i.test(key)
));

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
  const source = sourceById.get(String(detail.id));
  const title = `${detail.nameFa || ''} ${detail.name || ''}`.toLowerCase();
  if (wanted.some((term) => title.includes(term.toLowerCase()))) {
    named.push({
      id: detail.id, type: detail.type, nameFa: detail.nameFa, name: detail.name,
      sourceLanguageish: languageishObject(source),
      sourceCategoryKeys: source?.categoryKeys || [], sourceCategoryLabels: source?.categoryLabels || [],
      sourceDownloads: (source?.downloads || []).slice(0, 16).map(compactSection),
      generatedAvailableLanguages: detail.availableLanguages || [],
      generatedLanguages: currentDetailLanguages(detail),
      generatedActions: detail.type === 'movie' ? movieActions(detail) : undefined,
      generatedDownloads: (detail.downloads || []).slice(0, 16).map(compactSection),
    });
  }
  if (detail.type === 'movie') {
    const actions = movieActions(detail);
    if (!actions.hasPlay && !actions.hasDownload && !actions.hasRawDownloadButton) {
      noActionGenerated.push({ id: detail.id, nameFa: detail.nameFa, name: detail.name, operatorOnly: detail.operatorOnly === true });
    }
  }
}

console.log('MOBILE_UI_REAL_METRICS=' + JSON.stringify({
  clientItems: artifacts.index.items.length,
  generatedMoviesWithNoCurrentAction: noActionGenerated.length,
  generatedNormalMoviesWithNoCurrentAction: noActionGenerated.filter((item) => !item.operatorOnly).length,
}));
console.log('NO_ACTION_GENERATED_SAMPLE=' + JSON.stringify(noActionGenerated.slice(0, 40)));
console.log('NAMED_DEVICE_SAMPLES=' + JSON.stringify(named));

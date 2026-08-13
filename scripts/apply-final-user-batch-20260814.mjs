import fs from 'node:fs/promises';
import path from 'node:path';

const read = (file) => fs.readFile(file, 'utf8');
const write = (file, value) => fs.writeFile(file, value, 'utf8');

function mustReplace(text, before, after, label) {
  if (text.includes(after)) return text;
  if (!text.includes(before)) throw new Error(`Missing patch target: ${label}`);
  return text.replace(before, after);
}

function mustReplaceAll(text, before, after, minCount, label) {
  if (!text.includes(before)) {
    if (text.includes(after)) return text;
    throw new Error(`Missing patch target: ${label}`);
  }
  const count = text.split(before).length - 1;
  if (count < minCount) throw new Error(`Expected at least ${minCount} matches for ${label}, found ${count}`);
  return text.split(before).join(after);
}

let sync = await read('scripts/sync-upera.mjs');
let client = await read('scripts/client-catalog.mjs');
let enrich = await read('scripts/enrich-persian-titles.mjs');

// 1) Force a fresh language audit and give artwork/cast repair enough throughput
// to actually finish instead of leaving the app in a permanently partial state.
sync = mustReplace(sync,
  'const MEDIA_LANGUAGE_AUDIT_VERSION = 7;',
  'const MEDIA_LANGUAGE_AUDIT_VERSION = 8;',
  'language audit v8');
sync = sync.replace(/const CATALOG_VERSION = '[^']+';/,
  "const CATALOG_VERSION = '0.25.0-language-operator-artwork-truth';");
sync = mustReplace(sync,
`const peopleEnrichmentTitlesPerRun = Math.min(
  24,
  positiveInt(process.env.APARATCHI_PEOPLE_TITLES_PER_RUN, 10),
);`,
`const peopleEnrichmentTitlesPerRun = Math.min(
  120,
  positiveInt(process.env.APARATCHI_PEOPLE_TITLES_PER_RUN, 40),
);`,
  'people repair capacity');
sync = mustReplace(sync,
`const episodeArtworkSeriesPerRun = Math.min(
  24,
  positiveInt(process.env.APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN, 6),
);`,
`const episodeArtworkSeriesPerRun = Math.min(
  120,
  positiveInt(process.env.APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN, 24),
);`,
  'episode artwork series capacity');
sync = mustReplace(sync,
`const episodeFrameCapturesPerRun = Math.min(
  32,
  nonNegativeInt(process.env.APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN, 12),
);`,
`const episodeFrameCapturesPerRun = Math.min(
  160,
  nonNegativeInt(process.env.APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN, 48),
);`,
  'episode frame capacity');

const titleHelpers = `
function sourcePersianTitle(payload) {
  const candidates = [
    payload?.name_fa, payload?.nameFa, payload?.title_fa, payload?.titleFa,
    payload?.persian_name, payload?.persianName, payload?.fa_name, payload?.faName,
    payload?.persian_title, payload?.persianTitle, payload?.title, payload?.name,
  ].map(cleanText).filter(Boolean);
  return candidates.find((value) => /[\\u0600-\\u06ff]/.test(value)) || candidates[0] || '';
}

function sourceOverview(payload) {
  const candidates = [
    payload?.overview_fa, payload?.description_fa, payload?.story_fa, payload?.synopsis_fa,
    payload?.summary_fa, payload?.plot_fa, payload?.overview, payload?.description,
    payload?.story, payload?.synopsis, payload?.summary, payload?.plot, payload?.caption, payload?.about,
  ].map(cleanText).filter((value) => value && value !== 'توضیحی ثبت نشده است.');
  return candidates.find((value) => value.length >= 18) || candidates[0] || 'توضیحی ثبت نشده است.';
}

`;
if (!sync.includes('function sourcePersianTitle(payload)')) {
  const marker = 'function normalizeMovie(\n';
  if (!sync.includes(marker)) throw new Error('normalizeMovie marker missing');
  sync = sync.replace(marker, titleHelpers + marker);
}

sync = mustReplaceAll(sync,
  'nameFa: movie.name_fa || movie.name,',
  'nameFa: sourcePersianTitle(movie) || movie.name,',
  1,
  'movie classification Persian title');
sync = mustReplaceAll(sync,
  'nameFa: series.name_fa || series.name,',
  'nameFa: sourcePersianTitle(series) || series.name,',
  1,
  'series classification Persian title');
sync = mustReplace(sync,
`    nameFa: cleanText(
      movie.name_fa ||
      movie.name ||
      'بدون نام',
    ),`,
`    nameFa: cleanText(
      sourcePersianTitle(movie) ||
      movie.name ||
      'بدون نام',
    ),`,
  'movie normalized Persian title');
sync = mustReplace(sync,
`    nameFa: cleanText(
      series.name_fa ||
      series.name ||
      'بدون نام',
    ),`,
`    nameFa: cleanText(
      sourcePersianTitle(series) ||
      series.name ||
      'بدون نام',
    ),`,
  'series normalized Persian title');
sync = mustReplace(sync,
`    overview: cleanText(
      movie.overview_fa ||
      movie.overview ||
      'توضیحی ثبت نشده است.',
    ),`,
`    overview: sourceOverview(movie),`,
  'movie overview source breadth');
sync = mustReplace(sync,
`    overview: cleanText(
      series.overview_fa ||
      series.overview ||
      'توضیحی ثبت نشده است.',
    ),`,
`    overview: sourceOverview(series),`,
  'series overview source breadth');

// 2) Client transport is the final truth gate. Foreign original/unknown media is
// never sent to the app. Stale language badges are recomputed from actual links,
// duplicate URLs cannot masquerade as two languages, and only panel-verified
// operator-only variants survive.
const clientTruthHelpers = `
const clientLanguageFromText = (value) => {
  const text = String(value || '');
  if (/دوبله|دو\\s*زبانه|دوزبانه|صوت\\s*فارسی|صدای\\s*فارسی|persian\\s*(?:dub|audio|voice)|farsi\\s*(?:dub|audio|voice)|dubbed|\\bdub\\b/i.test(text)) return 'dubbed';
  if (/زیر\\s*نویس|زير\\s*نويس|هارد\\s*ساب|سافت\\s*ساب|persian\\s*sub|farsi\\s*sub|subtitle|subbed|\\bsub\\b/i.test(text)) return 'subtitled';
  return '';
};

const clientFileLanguage = (file, section) => {
  if (file?.language === 'dubbed' || file?.language === 'subtitled') return file.language;
  return clientLanguageFromText([section?.title, section?.badge, section?.language, file?.label].filter(Boolean).join(' '));
};

const verifiedOperatorOnlyFile = (file) => Boolean(
  file?.mode === 'operator-play' && file?.operatorOnly === true && file?.panelVerified === true &&
  Number(file?.trafficOo) === 1 && /^https:\/\//i.test(String(file?.url || '').trim())
);

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
      if (!iranian && language !== 'dubbed' && language !== 'subtitled') return [];
      return [{ ...file, ...(language ? { language } : {}) }];
    }),
  }));

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
    (Array.isArray(section?.files) ? section.files : []).map((file) => file?.language)
  ).filter((value) => value === 'dubbed' || value === 'subtitled')
)];

`;
if (!client.includes('const sanitizeClientMediaItem = (item) =>')) {
  const marker = 'export function clientSummaryForItem(item) {';
  if (!client.includes(marker)) throw new Error('clientSummary marker missing');
  client = client.replace(marker, clientTruthHelpers + marker);
}

const oldLanguageSummary = `  if (!Array.isArray(summary.availableLanguages) || !summary.availableLanguages.length) {
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
      /دوبله|دو\\s*زبانه|دوزبانه|صوت\\s*فارسی|صدای\\s*فارسی|فارسی\\s*(?:دوبله|صدا)|persian\\s*(?:dub|audio|voice)|farsi\\s*(?:dub|audio|voice)|dual\\s*audio|dubbed|\\bdub\\b/i.test(text) ? 'dubbed' : '',
      /زیر\\s*نویس|زير\\s*نويس|هارد\\s*ساب|سافت\\s*ساب|persian\\s*sub|farsi\\s*sub|subtitle|subbed|\\bsub\\b/i.test(text) ? 'subtitled' : '',
    ].filter(Boolean);
  }`;
client = mustReplace(client, oldLanguageSummary,
  `  summary.availableLanguages = deriveClientLanguages(item);`,
  'always derive language summary');

client = mustReplace(client,
`  for (const item of sourceItems) {
    if (!isClientVisibleItem(item)) continue;
    const { summary, detailSerialized } = clientSummaryForItem(item);`,
`  for (const sourceItem of sourceItems) {
    const item = sanitizeClientMediaItem(sourceItem);
    if (!item || !isClientVisibleItem(item)) continue;
    const { summary, detailSerialized } = clientSummaryForItem(item);`,
  'sanitize each client item');

// 3) Persian metadata: repair collections too, and prioritize every English-only
// Iranian/provider title rather than only a few screenshots.
const overrideNeedle = `  ['our father', 'پدر ما'],\n]);`;
const overrideReplacement = `  ['our father', 'پدر ما'],
  ['aunt nasrin and heavenly children', 'خاله نسرین و کودکان آسمانی'],
  ["aunt nasrin's songs for kids 4", 'ترانه‌های کودکانه خاله نسرین ۴'],
  ["aunt nasrin's songs for kids 5", 'ترانه‌های کودکانه خاله نسرین ۵'],
  ["aunt nasrin's songs for kids 7", 'ترانه‌های کودکانه خاله نسرین ۷'],
]);`;
enrich = mustReplace(enrich, overrideNeedle, overrideReplacement, 'Aunt Nasrin Persian overrides');

enrich = mustReplace(enrich,
`  .filter((item) => needsPersianTitle(item) || !isUsableArtwork(item.poster))`,
`  .filter((item) => needsPersianTitle(item) || needsPersianCollection(item) || !isUsableArtwork(item.poster))`,
  'collection repair candidates');

if (!enrich.includes('function needsPersianCollection(item)')) {
  enrich = enrich.replace(
`function needsPersianTitle(item) {
  const value = cleanText(item?.nameFa);
  return !value || !containsPersian(value) || normalizeTitle(value) === normalizeTitle(item?.name);
}
`,
`function needsPersianTitle(item) {
  const value = cleanText(item?.nameFa);
  return !value || !containsPersian(value) || normalizeTitle(value) === normalizeTitle(item?.name);
}

function needsPersianCollection(item) {
  if (!item?.collectionId && !item?.collectionName) return false;
  const value = cleanText(item?.collectionNameFa);
  return !value || !containsPersian(value) || normalizeTitle(value) === normalizeTitle(item?.collectionName);
}
`);
}

enrich = mustReplace(enrich,
`  const poster = cleanText(metadata?.poster);`,
`  const collectionNameFa = cleanText(metadata?.collectionNameFa);
  if (needsPersianCollection(item) && containsPersian(collectionNameFa)) {
    item.collectionNameFa = collectionNameFa;
    didChange = true;
  }
  const poster = cleanText(metadata?.poster);`,
  'apply Persian collection title');

enrich = mustReplace(enrich,
`  let posterPath = cleanText(details?.poster_path || candidate?.poster_path);`,
`  let posterPath = cleanText(details?.poster_path || candidate?.poster_path);
  let collectionNameFa = '';
  const collectionId = positiveInt(details?.belongs_to_collection?.id || item?.collectionId, 0);
  if (collectionId > 0) {
    try {
      const collection = await tmdbJson(\`/collection/\${collectionId}?language=fa-IR\`);
      const localizedCollection = cleanText(collection?.name);
      if (containsPersian(localizedCollection)) collectionNameFa = localizedCollection;
    } catch {
      // Collection translation is an enhancement; title repair must continue.
    }
  }`,
  'fetch Persian collection title');

enrich = mustReplace(enrich,
`    ...(titleFa ? { titleFa } : {}),
    ...(posterPath ? { poster: \`https://image.tmdb.org/t/p/w500/\${posterPath.replace(/^\\/+/, '')}\` } : {}),`,
`    ...(titleFa ? { titleFa } : {}),
    ...(collectionNameFa ? { collectionNameFa } : {}),
    ...(posterPath ? { poster: \`https://image.tmdb.org/t/p/w500/\${posterPath.replace(/^\\/+/, '')}\` } : {}),`,
  'return Persian collection title');

// Update regression expectations for the new full-catalog audit version.
for (const name of await fs.readdir('scripts/tests')) {
  if (!name.endsWith('.test.mjs')) continue;
  const file = path.join('scripts/tests', name);
  let test = await read(file);
  test = test.replaceAll('MEDIA_LANGUAGE_AUDIT_VERSION = 7', 'MEDIA_LANGUAGE_AUDIT_VERSION = 8');
  test = test.replaceAll('mediaLanguageAuditVersion, 7', 'mediaLanguageAuditVersion, 8');
  await write(file, test);
}

const regression = `import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const base = (extra = {}) => ({
  id: 'x', type: 'movie', ir: false, nameFa: 'آزمون', name: 'Test', year: 2026,
  poster: 'https://img.test/a.jpg', backdrop: 'https://img.test/b.jpg',
  overview: 'test', genres: ['درام'], ...extra,
});

test('client languages come from actual links, never stale badges', () => {
  const item = base({ availableLanguages: ['dubbed','subtitled'], downloads: [{ id: 's', title: 'زیرنویس فارسی', files: [
    { id: 'f', mode: 'download', url: 'https://cdn.test/sub.mp4', language: 'subtitled' },
  ]}] });
  const { index } = buildClientCatalogArtifacts({ items: [item] });
  assert.deepEqual(index.items[0].availableLanguages, ['subtitled']);
});

test('one URL cannot create both dubbed and subtitled choices', () => {
  const item = base({ downloads: [{ id: 's', files: [
    { id: 'd', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'dubbed' },
    { id: 'u', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'subtitled' },
  ]}] });
  const { index } = buildClientCatalogArtifacts({ items: [item] });
  assert.equal(index.items.length, 0);
});

test('foreign unlabeled original media is never exported to the app', () => {
  const item = base({ downloads: [{ id: 's', files: [
    { id: 'f', mode: 'download', url: 'https://cdn.test/original.mp4' },
  ]}] });
  const { index } = buildClientCatalogArtifacts({ items: [item] });
  assert.equal(index.items.length, 0);
});

test('unverified operator-only records are hidden', () => {
  const item = base({ operatorOnly: true, categoryKeys: ['mobile-operator'], downloads: [{ id: 'o', files: [
    { id: 'p', mode: 'operator-play', operatorOnly: true, panelVerified: false, trafficOo: 1, url: 'https://video.upera.tv/x' },
  ]}] });
  const { index } = buildClientCatalogArtifacts({ items: [item] });
  assert.equal(index.items.length, 0);
});

test('verified operator-only records stay visible and keep their badge category', () => {
  const item = base({ operatorOnly: true, categoryKeys: ['mobile-operator'], downloads: [{ id: 'o', files: [
    { id: 'p', mode: 'operator-play', operatorOnly: true, panelVerified: true, trafficOo: 1, url: 'https://video.upera.tv/x' },
  ]}] });
  const { index } = buildClientCatalogArtifacts({ items: [item] });
  assert.equal(index.items.length, 1);
  assert.equal(index.items[0].operatorOnly, true);
  assert.ok(index.items[0].categoryKeys.includes('mobile-operator'));
});
`;
await write('scripts/tests/final-user-batch-20260814.test.mjs', regression);

await write('scripts/sync-upera.mjs', sync);
await write('scripts/client-catalog.mjs', client);
await write('scripts/enrich-persian-titles.mjs', enrich);
console.log('Applied final 2026-08-14 content truth/metadata/artwork repair patch.');

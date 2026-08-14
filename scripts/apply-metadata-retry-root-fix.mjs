import fs from 'node:fs/promises';

const file = 'enrich-tmdb.mjs';
let source = await fs.readFile(file, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Missing patch target: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`let personImageLookupsUsed = 0;\nlet catalogChanged = false;\n\nfor (const item of catalog.items) {`,
`let personImageLookupsUsed = 0;\nlet catalogChanged = false;\n\nconst METADATA_RETRY_VERSION = 1;\n\nfunction isPlaceholderOverviewValue(value) {\n  const normalized = cleanText(value).toLowerCase().normalize('NFKC')\n    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');\n  return !normalized || /توضیحی\\s*ثبت\\s*نشده|توضیحات?\\s*ثبت\\s*نشده|خلاصه(?:\\s*داستان)?\\s*ثبت\\s*نشده|اطلاعاتی\\s*ثبت\\s*نشده|بدون\\s*توضیح|no\\s+(?:description|overview)|description\\s+not\\s+available/i.test(normalized);\n}\n\nfunction hasMeaningfulCastOrDirector(item) {\n  return (Array.isArray(item?.people) ? item.people : []).some((person) =>\n    person && ['actor', 'director'].includes(cleanText(person.role)) &&\n    Boolean(cleanText(person.name) || cleanText(person.nameFa))\n  );\n}\n\nfunction isOperatorCatalogItem(item) {\n  return Boolean(\n    item?.operatorOnly === true || item?.operatorAccess ||\n    (Array.isArray(item?.supportedOperators) && item.supportedOperators.length) ||\n    (Array.isArray(item?.downloads) && item.downloads.some((section) =>\n      (Array.isArray(section?.files) ? section.files : []).some((media) =>\n        /^operator-(?:play|download)$/.test(cleanText(media?.mode))\n      )\n    ))\n  );\n}\n\nfunction needsPriorityMetadataRepair(item, cached) {\n  if (!(isIranianCatalogItem(item) || isOperatorCatalogItem(item))) return false;\n  const incomplete = isPlaceholderOverviewValue(item?.overview) ||\n    !hasMeaningfulCastOrDirector(item) ||\n    (isIranianCatalogItem(item) && !containsPersian(item?.nameFa));\n  return incomplete && Number(cached?.metadataRetryVersion || 0) < METADATA_RETRY_VERSION;\n}\n\nfor (const item of catalog.items) {`,
  'metadata repair helpers',
);

replaceOnce(
`    if (cached.tmdb === null) {`,
`    if (cached.tmdb === null && !needsPriorityMetadataRepair(item, cached)) {`,
  'retry old negative TMDB cache for incomplete priority titles',
);

replaceOnce(
`      cache.items[cacheKey] = {\n        signature,\n        fetchedAt: new Date().toISOString(),\n        tmdb: null,\n        people: peopleWithImages,\n        metadata: null,\n      };`,
`      cache.items[cacheKey] = {\n        signature,\n        fetchedAt: new Date().toISOString(),\n        tmdb: null,\n        people: peopleWithImages,\n        metadata: null,\n        metadataRetryVersion: needsPriorityMetadataRepair(item, cached)\n          ? METADATA_RETRY_VERSION\n          : Number(cached?.metadataRetryVersion || 0),\n      };`,
  'remember negative-cache metadata retry version',
);

replaceOnce(
`      append_to_response: 'aggregate_credits,keywords,images',`,
`      append_to_response: 'aggregate_credits,keywords,images,translations',`,
  'TV Persian translations in title details',
);
replaceOnce(
`    append_to_response: 'credits,keywords,images',`,
`    append_to_response: 'credits,keywords,images,translations',`,
  'movie Persian translations in title details',
);

replaceOnce(
`  const isDocumentary = Boolean(\n    tmdbGenres.some((genre) => Number(genre?.id) === 99 || /documentary|مستند/i.test(cleanText(genre?.name))) ||\n    /(?:^|\\s)مرد\\s+ابدی(?:\\s|$)/i.test(cleanText(item?.nameFa)),\n  );\n\n  const nextEpisode =`,
`  const isDocumentary = Boolean(\n    tmdbGenres.some((genre) => Number(genre?.id) === 99 || /documentary|مستند/i.test(cleanText(genre?.name))) ||\n    /(?:^|\\s)مرد\\s+ابدی(?:\\s|$)/i.test(cleanText(item?.nameFa)),\n  );\n  const translations = Array.isArray(details?.translations?.translations)\n    ? details.translations.translations\n    : [];\n  const faTranslation = translations.find((entry) =>\n    cleanText(entry?.iso_639_1).toLowerCase() === 'fa'\n  );\n  const overview = cleanText(faTranslation?.data?.overview) || cleanText(details?.overview);\n\n  const nextEpisode =`,
  'extract Persian overview from TMDB translations',
);

replaceOnce(
`    isDocumentary,\n    validationVersion: 4,`,
`    isDocumentary,\n    ...(overview && !isPlaceholderOverviewValue(overview) ? { overview } : {}),\n    validationVersion: 4,`,
  'store TMDB overview metadata',
);

replaceOnce(
`    originalLanguage: item.originalLanguage,\n    poster: item.poster,`,
`    originalLanguage: item.originalLanguage,\n    overview: item.overview,\n    poster: item.poster,`,
  'overview in metadata before snapshot',
);

replaceOnce(
`  if (originalLanguage) item.originalLanguage = originalLanguage;\n  item.ir = trustedClassification`,
`  if (originalLanguage) item.originalLanguage = originalLanguage;\n  const metadataOverview = cleanText(metadata.overview);\n  if (isPlaceholderOverviewValue(item.overview) && metadataOverview && !isPlaceholderOverviewValue(metadataOverview)) {\n    item.overview = metadataOverview;\n  }\n  item.ir = trustedClassification`,
  'apply real overview only to missing placeholders',
);

// The first replacement adds overview to both snapshots only if both copies are identical.
const snapshotNeedle = `    originalLanguage: item.originalLanguage,\n    poster: item.poster,`;
if (source.includes(snapshotNeedle)) {
  source = source.replace(snapshotNeedle, `    originalLanguage: item.originalLanguage,\n    overview: item.overview,\n    poster: item.poster,`);
}

replaceOnce(
`  const iranian = isIranianCatalogItem(item);\n  const codes = detailsCountryCodes(details, mediaType);\n  const originalLanguage = cleanText(details?.original_language).toLowerCase();\n  if (iranian && originalLanguage !== 'fa' && !codes.includes('IR')) return false;`,
`  const iranian = isIranianCatalogItem(item);\n  const codes = detailsCountryCodes(details, mediaType);\n  const originalLanguage = cleanText(details?.original_language).toLowerCase();\n  const strongIranianIdentity = cleanText(item?.originalLanguage).toLowerCase() === 'fa' ||\n    containsPersian(item?.nameFa) || containsPersian(item?.name);\n  if (iranian && strongIranianIdentity && originalLanguage !== 'fa' && !codes.includes('IR')) return false;`,
  'allow TMDB to correct stale weak Iranian classifications',
);

replaceOnce(
`  const removedKeys = new Set([\n    'korean-movies', 'korean-series', 'indian-movies', 'japanese-movies',`,
`  const removedKeys = new Set([\n    'iranian-movies', 'iranian-series',\n    'korean-movies', 'korean-series', 'indian-movies', 'japanese-movies',`,
  'clear stale Iranian category keys before trusted rebuild',
);

replaceOnce(
`  if (type === 'movie' && effectiveCodes.includes('KR')) categoryKeys.push('korean-movies');`,
`  if (type === 'movie' && effectiveCodes.includes('IR')) categoryKeys.push('iranian-movies');\n  if (type === 'series' && effectiveCodes.includes('IR')) categoryKeys.push('iranian-series');\n  if (type === 'movie' && effectiveCodes.includes('KR')) categoryKeys.push('korean-movies');`,
  'rebuild Iranian category keys from trusted country data',
);

replaceOnce(
`  const classificationLabels = /^(فیلم (کره‌ای|هندی|ژاپنی)|سریال کره‌ای|انیمه (سینمایی|سریالی)|انیمیشن (سینمایی|سریالی)|مستند)$/;`,
`  const classificationLabels = /^(فیلم (ایرانی|کره‌ای|هندی|ژاپنی)|سریال (ایرانی|کره‌ای)|انیمه (سینمایی|سریالی)|انیمیشن (سینمایی|سریالی)|مستند)$/;`,
  'clear stale Iranian category labels',
);

replaceOnce(
`  if (type === 'movie' && effectiveCodes.includes('KR')) categoryLabels.push('فیلم کره‌ای');`,
`  if (type === 'movie' && effectiveCodes.includes('IR')) categoryLabels.push('فیلم ایرانی');\n  if (type === 'series' && effectiveCodes.includes('IR')) categoryLabels.push('سریال ایرانی');\n  if (type === 'movie' && effectiveCodes.includes('KR')) categoryLabels.push('فیلم کره‌ای');`,
  'rebuild Iranian category labels from trusted country data',
);

replaceOnce(
`      if (hasCompleteTmdbMetadata(item)) continue;`,
`      if (hasCompleteTmdbMetadata(item) && hasCompleteTmdbPeople(item.people)) continue;`,
  'do not let metadata-only cache hide missing cast',
);

await fs.writeFile(file, source, 'utf8');
console.log('Applied TMDB negative-cache, overview and classification root repair.');

import fs from 'node:fs/promises';

const file = 'scripts/enrich-tmdb.mjs';
let source = await fs.readFile(file, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Missing patch target: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`let personImageLookupsUsed = 0;\nlet catalogChanged = false;\n\nfor (const item of catalog.items) {`,
`let personImageLookupsUsed = 0;\nlet catalogChanged = false;\n\nconst METADATA_RETRY_VERSION = 1;\n\nfunction hasMeaningfulCastOrDirector(item) {\n  return (Array.isArray(item?.people) ? item.people : []).some((person) =>\n    person && ['actor', 'director'].includes(cleanText(person.role)) &&\n    Boolean(cleanText(person.name) || cleanText(person.nameFa))\n  );\n}\n\nfunction isOperatorCatalogItem(item) {\n  return Boolean(\n    item?.operatorOnly === true || item?.operatorAccess ||\n    (Array.isArray(item?.supportedOperators) && item.supportedOperators.length) ||\n    (Array.isArray(item?.downloads) && item.downloads.some((section) =>\n      (Array.isArray(section?.files) ? section.files : []).some((media) =>\n        /^operator-(?:play|download)$/.test(cleanText(media?.mode))\n      )\n    ))\n  );\n}\n\nfunction needsPriorityMetadataRepair(item, cached) {\n  if (!(isIranianCatalogItem(item) || isOperatorCatalogItem(item))) return false;\n  const incomplete = isMissingOverview(item?.overview) ||\n    !hasMeaningfulCastOrDirector(item) ||\n    (isIranianCatalogItem(item) && !containsPersian(item?.nameFa));\n  return incomplete && Number(cached?.metadataRetryVersion || 0) < METADATA_RETRY_VERSION;\n}\n\nfor (const item of catalog.items) {`,
  'metadata retry helpers',
);

replaceOnce(
`    if (cached.tmdb === null) {`,
`    if (cached.tmdb === null && !needsPriorityMetadataRepair(item, cached)) {`,
  'retry old negative TMDB cache for incomplete Iranian/operator titles',
);

replaceOnce(
`      cache.items[cacheKey] = {\n        signature,\n        fetchedAt: new Date().toISOString(),\n        tmdb: null,\n        people: peopleWithImages,\n        metadata: null,\n      };`,
`      cache.items[cacheKey] = {\n        signature,\n        fetchedAt: new Date().toISOString(),\n        tmdb: null,\n        people: peopleWithImages,\n        metadata: null,\n        metadataRetryVersion: needsPriorityMetadataRepair(item, cached)\n          ? METADATA_RETRY_VERSION\n          : Number(cached?.metadataRetryVersion || 0),\n      };`,
  'version forced negative-cache retry',
);

replaceOnce(
`      if (hasCompleteTmdbMetadata(item)) continue;`,
`      if (hasCompleteTmdbMetadata(item) && hasCompleteTmdbPeople(item.people)) continue;`,
  'cached metadata cannot hide missing people',
);

replaceOnce(
`  const iranian = isIranianCatalogItem(item);\n  const codes = detailsCountryCodes(details, mediaType);\n  const originalLanguage = cleanText(details?.original_language).toLowerCase();\n  if (iranian && originalLanguage !== 'fa' && !codes.includes('IR')) return false;`,
`  const iranian = isIranianCatalogItem(item);\n  const codes = detailsCountryCodes(details, mediaType);\n  const originalLanguage = cleanText(details?.original_language).toLowerCase();\n  const strongIranianIdentity = cleanText(item?.originalLanguage).toLowerCase() === 'fa' ||\n    containsPersian(item?.nameFa) || containsPersian(item?.name);\n  if (iranian && strongIranianIdentity && originalLanguage !== 'fa' && !codes.includes('IR')) return false;`,
  'let trusted TMDB correct weak stale Iranian classifications',
);

await fs.writeFile(file, source, 'utf8');
console.log('Applied active TMDB negative-cache and classification retry repair.');

import fs from 'node:fs/promises';

const file = 'scripts/enrich-persian-titles.mjs';
let source = await fs.readFile(file, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Missing patch target: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`const negativeCacheHours = Math.max(1, Math.min(72, positiveInt(process.env.PERSIAN_TITLE_NEGATIVE_CACHE_HOURS, 6)));`,
`const negativeCacheHours = Math.max(1, Math.min(72, positiveInt(process.env.PERSIAN_TITLE_NEGATIVE_CACHE_HOURS, 6)));\nconst WIKIDATA_TITLE_VERSION = 1;`,
  'Wikidata title version',
);

replaceOnce(
`  const freshCache = cached && isFresh(cached.fetchedAt, cacheWindowDays);`,
`  const needsWikidataUpgrade = Boolean(\n    cached && needsPersianTitle(item) && !cachedHasPersianTitle &&\n    Number(cached?.wikidataTitleVersion || 0) < WIKIDATA_TITLE_VERSION\n  );\n  const freshCache = cached && isFresh(cached.fetchedAt, cacheWindowDays) && !needsWikidataUpgrade;`,
  'force one Wikidata upgrade for fresh negative caches',
);

replaceOnce(
`  if (!candidate?.id) return {};`,
`  if (!candidate?.id) return { wikidataTitleVersion: WIKIDATA_TITLE_VERSION };`,
  'mark unmatched titles as checked for Wikidata upgrade',
);

replaceOnce(
`  return {\n    tmdbId: Number(candidate.id),\n    ...(titleFa ? { titleFa } : {}),`,
`  let wikidataId = '';\n  if (!titleFa) {\n    try {\n      const externalIds = await tmdbJson(\`/\${mediaType}/\${candidate.id}/external_ids\`);\n      wikidataId = cleanText(externalIds?.wikidata_id);\n      if (/^Q\\d+$/i.test(wikidataId)) {\n        const wikidataTitle = await wikidataPersianTitle(wikidataId);\n        if (containsPersian(wikidataTitle)) titleFa = wikidataTitle;\n      }\n    } catch {\n      // Wikidata is a final title-only fallback. TMDB metadata remains usable.\n    }\n  }\n\n  return {\n    tmdbId: Number(candidate.id),\n    wikidataTitleVersion: WIKIDATA_TITLE_VERSION,\n    ...(wikidataId ? { wikidataId } : {}),\n    ...(titleFa ? { titleFa } : {}),`,
  'Wikidata fallback before metadata return',
);

replaceOnce(
`async function tmdbJson(pathname) {`,
`async function wikidataPersianTitle(entityId) {\n  const url = new URL('https://www.wikidata.org/w/api.php');\n  url.searchParams.set('action', 'wbgetentities');\n  url.searchParams.set('format', 'json');\n  url.searchParams.set('ids', entityId);\n  url.searchParams.set('props', 'labels|sitelinks');\n  url.searchParams.set('languages', 'fa');\n  url.searchParams.set('sitefilter', 'fawiki');\n  const response = await fetch(url, {\n    headers: {\n      accept: 'application/json',\n      'user-agent': 'Aparatchi-Metadata/1.0 (Persian title enrichment)',\n    },\n    signal: AbortSignal.timeout(9000),\n  });\n  if (!response.ok) throw new Error(\`Wikidata HTTP \${response.status}\`);\n  const payload = await response.json();\n  const entity = payload?.entities?.[entityId];\n  const label = cleanText(entity?.labels?.fa?.value);\n  if (containsPersian(label)) return label;\n  const pageTitle = cleanText(entity?.sitelinks?.fawiki?.title);\n  return containsPersian(pageTitle) ? pageTitle : '';\n}\n\nasync function tmdbJson(pathname) {`,
  'Wikidata fetch helper',
);

await fs.writeFile(file, source, 'utf8');
console.log('Applied Wikidata Persian-title fallback.');

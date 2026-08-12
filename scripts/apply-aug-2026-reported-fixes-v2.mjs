import fs from 'node:fs/promises';

const read = (path) => fs.readFile(path, 'utf8');
const write = (path, value) => fs.writeFile(path, value, 'utf8');

function mustReplace(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`Missing patch target: ${label}`);
  return text.replace(before, after);
}

function replaceAllStrict(text, before, after, expected, label) {
  const count = text.split(before).length - 1;
  if (count !== expected) throw new Error(`Expected ${expected} targets for ${label}, found ${count}`);
  return text.split(before).join(after);
}

let sync = await read('scripts/sync-upera.mjs');
let enrich = await read('scripts/enrich-persian-titles.mjs');
let syncWorkflow = await read('.github/workflows/sync-upera.yml');
let enrichWorkflow = await read('.github/workflows/enrich-tmdb-cast.yml');

// Exact episode artwork ------------------------------------------------------
sync = mustReplace(
  sync,
  "const CATALOG_VERSION = '0.23.1-media-language-truth';",
  "const CATALOG_VERSION = '0.24.0-exact-episode-artwork';",
  'catalog version',
);

sync = mustReplace(
  sync,
  "const catalog = await readJson(catalogPath, defaultCatalog);\nconst state = await readJson(statePath, defaultState);",
  "const catalog = await readJson(catalogPath, defaultCatalog);\nconst state = await readJson(statePath, defaultState);\n\nconst isTrustedGeneratedEpisodeArtwork = (value) =>\n  /^(?:\\.\\/)?assets\\/media\\/episodes\\/[a-f0-9]{24}\\.jpg$/i.test(cleanText(value));\n\nlet removedUntrustedEpisodeArtwork = 0;\nfor (const item of Array.isArray(catalog.items) ? catalog.items : []) {\n  if (item?.type !== 'series') continue;\n  for (const group of Array.isArray(item.downloads) ? item.downloads : []) {\n    if (Number(group?.episodeNumber || 0) <= 0) continue;\n    if (!cleanText(group.artwork) || isTrustedGeneratedEpisodeArtwork(group.artwork)) continue;\n    group.artwork = '';\n    removedUntrustedEpisodeArtwork += 1;\n  }\n}\nif (removedUntrustedEpisodeArtwork) {\n  console.log('Removed ' + removedUntrustedEpisodeArtwork + ' untrusted episode artwork references; exact frames will be regenerated.');\n}",
  'catalog episode artwork sanitation',
);

sync = mustReplace(
  sync,
  "  const artwork = episodeArtworkUrl(episode);\n\n  return {",
  "  const artwork = '';\n\n  return {",
  'new episode group artwork source',
);

sync = mustReplace(
  sync,
  "function hydrateEpisodeGroupArtwork(groups, episodes) {\n  let added = 0;\n  for (const episode of Array.isArray(episodes) ? episodes : []) {\n    const group = findEpisodeGroup(groups, episode);\n    if (!group || cleanText(group.artwork)) continue;\n    const artwork = episodeArtworkUrl(episode);\n    if (!artwork) continue;\n    group.artwork = artwork;\n    added += 1;\n  }\n  return added;\n}",
  "function hydrateEpisodeGroupArtwork(_groups, _episodes) {\n  // Upera stills can be cross-linked. Only a frame captured from the exact\n  // episode media is accepted as episode-specific artwork.\n  return 0;\n}",
  'disable unverified episode artwork hydration',
);

sync = mustReplace(
  sync,
  "  if (/^(?:\\.\\/)?assets\\/media\\/episodes\\//i.test(artwork)) return false;",
  "  if (isTrustedGeneratedEpisodeArtwork(artwork)) return false;",
  'generated episode artwork trust rule',
);

// Catalog-wide Persian-title repair -----------------------------------------
enrich = mustReplace(
  enrich,
  "const cacheDays = Math.max(1, Math.min(180, positiveInt(process.env.PERSIAN_TITLE_CACHE_DAYS, 45)));",
  "const cacheDays = Math.max(1, Math.min(180, positiveInt(process.env.PERSIAN_TITLE_CACHE_DAYS, 45)));\nconst negativeCacheHours = Math.max(1, Math.min(72, positiveInt(process.env.PERSIAN_TITLE_NEGATIVE_CACHE_HOURS, 6)));",
  'short negative title cache',
);

enrich = mustReplace(
  enrich,
  "const VERIFIED_PERSIAN_TITLE_OVERRIDES = new Map([\n  ['dance with the jackals 4', 'رقص با شغال‌ها ۴'],\n]);",
  "const VERIFIED_PERSIAN_TITLE_OVERRIDES = new Map([\n  ['dance with the jackals 4', 'رقص با شغال‌ها ۴'],\n  ['the passage', 'گذرگاه'],\n  ['the bloody hundredth', 'صدمین گروه خونین'],\n  ['music by john williams', 'موسیقی از جان ویلیامز'],\n  [\"the devil's climb\", 'صعود شیطان'],\n  ['the lionheart', 'شیردل'],\n  ['our father', 'پدر ما'],\n]);",
  'verified Persian title seeds',
);

enrich = mustReplace(
  enrich,
  "  const cached = cache.items[key];\n  const freshCache = cached && isFresh(cached.fetchedAt, cacheDays);",
  "  const cached = cache.items[key];\n  const cachedHasPersianTitle = containsPersian(cached?.titleFa);\n  const cacheWindowDays = needsPersianTitle(item) && !cachedHasPersianTitle\n    ? negativeCacheHours / 24\n    : cacheDays;\n  const freshCache = cached && isFresh(cached.fetchedAt, cacheWindowDays);",
  'negative title cache freshness',
);

const translationsBlock = "  if (!titleFa) {\n    try {\n      const translations = await tmdbJson(`/${mediaType}/${candidate.id}/translations`);\n      const values = Array.isArray(translations?.translations) ? translations.translations : [];\n      const fa = values.find((entry) => String(entry?.iso_639_1 || '').toLowerCase() === 'fa');\n      const translated = cleanText(fa?.data?.title || fa?.data?.name);\n      if (containsPersian(translated)) titleFa = translated;\n    } catch {\n      // Keep poster/details even if translations endpoint is unavailable.\n    }\n  }\n\n  return {";
const translationsAndAlternatives = "  if (!titleFa) {\n    try {\n      const translations = await tmdbJson(`/${mediaType}/${candidate.id}/translations`);\n      const values = Array.isArray(translations?.translations) ? translations.translations : [];\n      const fa = values.find((entry) => String(entry?.iso_639_1 || '').toLowerCase() === 'fa');\n      const translated = cleanText(fa?.data?.title || fa?.data?.name);\n      if (containsPersian(translated)) titleFa = translated;\n    } catch {\n      // Keep poster/details even if translations endpoint is unavailable.\n    }\n  }\n\n  if (!titleFa) {\n    try {\n      const alternatives = await tmdbJson(`/${mediaType}/${candidate.id}/alternative_titles`);\n      const values = [\n        ...(Array.isArray(alternatives?.titles) ? alternatives.titles : []),\n        ...(Array.isArray(alternatives?.results) ? alternatives.results : []),\n      ];\n      const iranian = values.find((entry) =>\n        String(entry?.iso_3166_1 || '').toUpperCase() === 'IR' && containsPersian(entry?.title || entry?.name),\n      );\n      const anyPersian = values.find((entry) => containsPersian(entry?.title || entry?.name));\n      const chosen = iranian || anyPersian;\n      const alternative = cleanText(chosen?.title || chosen?.name);\n      if (containsPersian(alternative)) titleFa = alternative;\n    } catch {\n      // Missing alternative-title metadata is not fatal.\n    }\n  }\n\n  return {";
enrich = mustReplace(enrich, translationsBlock, translationsAndAlternatives, 'TMDB alternative titles');

// GitHub push race -----------------------------------------------------------
// Run 31645584233 lost a narrow race: main moved after pull --rebase and before
// push. Retry that case five times instead of aborting the whole hourly sync.
const oldSyncPush = "            git pull --rebase origin main\n            git push origin HEAD:main";
const retrySyncPush = "            PUSHED=0\n            for attempt in 1 2 3 4 5; do\n              if git pull --rebase origin main && git push origin HEAD:main; then\n                PUSHED=1\n                break\n              fi\n              git rebase --abort >/dev/null 2>&1 || true\n              echo \"Repository changed during push; retry $attempt/5\"\n              sleep $((attempt * 2))\n            done\n            if [ \"$PUSHED\" -ne 1 ]; then\n              echo \"::error::Could not push catalog progress after 5 attempts.\"\n              exit 1\n            fi";
syncWorkflow = replaceAllStrict(syncWorkflow, oldSyncPush, retrySyncPush, 4, 'sync push retries');

const oldEnrichPush = "          git pull --rebase origin main\n          git push origin HEAD:main";
const retryEnrichPush = "          PUSHED=0\n          for attempt in 1 2 3 4 5; do\n            if git pull --rebase origin main && git push origin HEAD:main; then\n              PUSHED=1\n              break\n            fi\n            git rebase --abort >/dev/null 2>&1 || true\n            echo \"Repository changed during enrichment push; retry $attempt/5\"\n            sleep $((attempt * 2))\n          done\n          if [ \"$PUSHED\" -ne 1 ]; then\n            echo \"::error::Could not push enrichment after 5 attempts.\"\n            exit 1\n          fi";
enrichWorkflow = mustReplace(enrichWorkflow, oldEnrichPush, retryEnrichPush, 'enrichment push retry');

enrichWorkflow = mustReplace(
  enrichWorkflow,
  "          PERSIAN_TITLE_REQUEST_DELAY_MS: '90'",
  "          PERSIAN_TITLE_REQUEST_DELAY_MS: '70'\n          PERSIAN_TITLE_NEGATIVE_CACHE_HOURS: '6'",
  'negative-cache workflow setting',
);

await Promise.all([
  write('scripts/sync-upera.mjs', sync),
  write('scripts/enrich-persian-titles.mjs', enrich),
  write('.github/workflows/sync-upera.yml', syncWorkflow),
  write('.github/workflows/enrich-tmdb-cast.yml', enrichWorkflow),
]);

console.log('Applied exact episode artwork, Persian-title and GitHub push-race repairs.');

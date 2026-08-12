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

// EPISODE ARTWORK -----------------------------------------------------------
// Upera's episode thumbnail fields are not reliable enough to prove that a
// still belongs to the exact episode. Generate the frame from that episode's
// own playable media instead. Existing untrusted artwork is stripped so the
// client falls back only to the same series while a frame is being generated.
sync = mustReplace(
  sync,
  `const CATALOG_VERSION = '0.23.1-media-language-truth';`,
  `const CATALOG_VERSION = '0.24.0-exact-episode-artwork';`,
  'catalog version',
);
sync = mustReplace(
  sync,
  `const catalog = await readJson(catalogPath, defaultCatalog);\nconst state = await readJson(statePath, defaultState);`,
  `const catalog = await readJson(catalogPath, defaultCatalog);\nconst state = await readJson(statePath, defaultState);\n\nconst isTrustedGeneratedEpisodeArtwork = (value) =>\n  /^(?:\\.\\/)?assets\\/media\\/episodes\\/[a-f0-9]{24}\\.jpg$/i.test(cleanText(value));\n\nlet removedUntrustedEpisodeArtwork = 0;\nfor (const item of Array.isArray(catalog.items) ? catalog.items : []) {\n  if (item?.type !== 'series') continue;\n  for (const group of Array.isArray(item.downloads) ? item.downloads : []) {\n    if (Number(group?.episodeNumber || 0) <= 0) continue;\n    if (!cleanText(group.artwork) || isTrustedGeneratedEpisodeArtwork(group.artwork)) continue;\n    group.artwork = '';\n    removedUntrustedEpisodeArtwork += 1;\n  }\n}\nif (removedUntrustedEpisodeArtwork) {\n  console.log(\`Removed ${removedUntrustedEpisodeArtwork} untrusted episode artwork references; exact frames will be regenerated.\`);\n}`,
  'catalog episode artwork sanitation',
);
sync = mustReplace(
  sync,
  `  const artwork = episodeArtworkUrl(episode);\n\n  return {`,
  `  const artwork = '';\n\n  return {`,
  'new episode group artwork source',
);
sync = mustReplace(
  sync,
  `function hydrateEpisodeGroupArtwork(groups, episodes) {\n  let added = 0;\n  for (const episode of Array.isArray(episodes) ? episodes : []) {\n    const group = findEpisodeGroup(groups, episode);\n    if (!group || cleanText(group.artwork)) continue;\n    const artwork = episodeArtworkUrl(episode);\n    if (!artwork) continue;\n    group.artwork = artwork;\n    added += 1;\n  }\n  return added;\n}`,
  `function hydrateEpisodeGroupArtwork(_groups, _episodes) {\n  // Source-provided episode stills can be cross-linked to unrelated titles.\n  // Only frames captured from the exact episode media are allowed.\n  return 0;\n}`,
  'disable unverified episode thumbnail hydration',
);
sync = mustReplace(
  sync,
  `  if (/^(?:\\.\\/)?assets\\/media\\/episodes\\//i.test(artwork)) return false;`,
  `  if (isTrustedGeneratedEpisodeArtwork(artwork)) return false;`,
  'exact generated frame trust rule',
);

// PERSIAN TITLES -------------------------------------------------------------
// A missing Persian title used to be negatively cached for 45 days. Retry
// missing titles quickly, consult TMDB alternative titles too, and seed the
// reported titles with verified Persian names. This remains a catalog-wide
// repair; the overrides are not the only titles processed.
enrich = mustReplace(
  enrich,
  `const cacheDays = Math.max(1, Math.min(180, positiveInt(process.env.PERSIAN_TITLE_CACHE_DAYS, 45)));`,
  `const cacheDays = Math.max(1, Math.min(180, positiveInt(process.env.PERSIAN_TITLE_CACHE_DAYS, 45)));\nconst negativeCacheHours = Math.max(1, Math.min(72, positiveInt(process.env.PERSIAN_TITLE_NEGATIVE_CACHE_HOURS, 6)));`,
  'short negative title cache',
);
enrich = mustReplace(
  enrich,
  `const VERIFIED_PERSIAN_TITLE_OVERRIDES = new Map([\n  ['dance with the jackals 4', 'رقص با شغال‌ها ۴'],\n]);`,
  `const VERIFIED_PERSIAN_TITLE_OVERRIDES = new Map([\n  ['dance with the jackals 4', 'رقص با شغال‌ها ۴'],\n  ['the passage', 'گذرگاه'],\n  ['the bloody hundredth', 'صدمین گروه خونین'],\n  ['music by john williams', 'موسیقی از جان ویلیامز'],\n  ["the devil's climb", 'صعود شیطان'],\n  ['the lionheart', 'شیردل'],\n  ['our father', 'پدر ما'],\n]);`,
  'verified Persian title seeds',
);
enrich = mustReplace(
  enrich,
  `  const cached = cache.items[key];\n  const freshCache = cached && isFresh(cached.fetchedAt, cacheDays);`,
  `  const cached = cache.items[key];\n  const cachedHasPersianTitle = containsPersian(cached?.titleFa);\n  const cacheWindowDays = needsPersianTitle(item) && !cachedHasPersianTitle\n    ? negativeCacheHours / 24\n    : cacheDays;\n  const freshCache = cached && isFresh(cached.fetchedAt, cacheWindowDays);`,
  'negative cache freshness',
);
enrich = mustReplace(
  enrich,
  `  if (!titleFa) {\n    try {\n      const translations = await tmdbJson(\`/${mediaType}/${candidate.id}/translations\`);\n      const values = Array.isArray(translations?.translations) ? translations.translations : [];\n      const fa = values.find((entry) => String(entry?.iso_639_1 || '').toLowerCase() === 'fa');\n      const translated = cleanText(fa?.data?.title || fa?.data?.name);\n      if (containsPersian(translated)) titleFa = translated;\n    } catch {\n      // Keep poster/details even if translations endpoint is unavailable.\n    }\n  }\n\n  return {`,
  `  if (!titleFa) {\n    try {\n      const translations = await tmdbJson(\`/${mediaType}/${candidate.id}/translations\`);\n      const values = Array.isArray(translations?.translations) ? translations.translations : [];\n      const fa = values.find((entry) => String(entry?.iso_639_1 || '').toLowerCase() === 'fa');\n      const translated = cleanText(fa?.data?.title || fa?.data?.name);\n      if (containsPersian(translated)) titleFa = translated;\n    } catch {\n      // Keep poster/details even if translations endpoint is unavailable.\n    }\n  }\n\n  if (!titleFa) {\n    try {\n      const alternatives = await tmdbJson(\`/${mediaType}/${candidate.id}/alternative_titles\`);\n      const values = [\n        ...(Array.isArray(alternatives?.titles) ? alternatives.titles : []),\n        ...(Array.isArray(alternatives?.results) ? alternatives.results : []),\n      ];\n      const iranian = values.find((entry) =>\n        String(entry?.iso_3166_1 || '').toUpperCase() === 'IR' && containsPersian(entry?.title || entry?.name),\n      );\n      const anyPersian = values.find((entry) => containsPersian(entry?.title || entry?.name));\n      const alternative = cleanText((iranian || anyPersian)?.title || (iranian || anyPersian)?.name);\n      if (containsPersian(alternative)) titleFa = alternative;\n    } catch {\n      // Missing alternative-title metadata is not fatal.\n    }\n  }\n\n  return {`,
  'TMDB Persian alternative titles',
);

// GITHUB PUSH RACES ----------------------------------------------------------
// The red run 31645584233 failed because main changed after pull --rebase but
// before git push. Retry that narrow race instead of aborting the whole hourly
// catalog pipeline.
const oldPush = `            git pull --rebase origin main\n            git push origin HEAD:main`;
const retryPush = `            PUSHED=0\n            for attempt in 1 2 3 4 5; do\n              if git pull --rebase origin main && git push origin HEAD:main; then\n                PUSHED=1\n                break\n              fi\n              git rebase --abort >/dev/null 2>&1 || true\n              echo \"Repository changed during push; retry ${attempt}/5\"\n              sleep $((attempt * 2))\n            done\n            if [ \"$PUSHED\" -ne 1 ]; then\n              echo \"::error::Could not push catalog progress after 5 attempts.\"\n              exit 1\n            fi`;
syncWorkflow = replaceAllStrict(syncWorkflow, oldPush, retryPush, 4, 'sync push retries');

for (const [name, id] of [
  ['Commit new-content progress', 'commit_normal'],
  ['Commit Iranian-series progress', 'commit_iranian'],
  ['Commit cast and crew progress', 'commit_people'],
  ['Commit archive progress', 'commit_archive'],
]) {
  syncWorkflow = mustReplace(syncWorkflow, `      - name: ${name}\n        if: always()`, `      - name: ${name}\n        id: ${id}\n        if: always()`, `step id ${id}`);
}
syncWorkflow = mustReplace(
  syncWorkflow,
  `          if [ '${{ steps.archive_sync.outcome }}' = 'failure' ]; then FAILED_STAGES=\"${FAILED_STAGES} archive\"; fi\n          if [ -n \"$FAILED_STAGES\" ]; then`,
  `          if [ '${{ steps.archive_sync.outcome }}' = 'failure' ]; then FAILED_STAGES=\"${FAILED_STAGES} archive\"; fi\n          if [ '${{ steps.commit_normal.outcome }}' = 'failure' ]; then FAILED_STAGES=\"${FAILED_STAGES} commit-normal\"; fi\n          if [ '${{ steps.commit_iranian.outcome }}' = 'failure' ]; then FAILED_STAGES=\"${FAILED_STAGES} commit-iranian\"; fi\n          if [ '${{ steps.commit_people.outcome }}' = 'failure' ]; then FAILED_STAGES=\"${FAILED_STAGES} commit-people\"; fi\n          if [ '${{ steps.commit_archive.outcome }}' = 'failure' ]; then FAILED_STAGES=\"${FAILED_STAGES} commit-archive\"; fi\n          if [ -n \"$FAILED_STAGES\" ]; then`,
  'accurate sync final report',
);

const enrichOldPush = `          git pull --rebase origin main\n          git push origin HEAD:main`;
const enrichRetryPush = `          PUSHED=0\n          for attempt in 1 2 3 4 5; do\n            if git pull --rebase origin main && git push origin HEAD:main; then\n              PUSHED=1\n              break\n            fi\n            git rebase --abort >/dev/null 2>&1 || true\n            echo \"Repository changed during enrichment push; retry ${attempt}/5\"\n            sleep $((attempt * 2))\n          done\n          if [ \"$PUSHED\" -ne 1 ]; then\n            echo \"::error::Could not push enrichment after 5 attempts.\"\n            exit 1\n          fi`;
enrichWorkflow = mustReplace(enrichWorkflow, enrichOldPush, enrichRetryPush, 'enrichment push retry');
enrichWorkflow = mustReplace(
  enrichWorkflow,
  `          PERSIAN_TITLE_REQUEST_DELAY_MS: '90'`,
  `          PERSIAN_TITLE_REQUEST_DELAY_MS: '70'\n          PERSIAN_TITLE_NEGATIVE_CACHE_HOURS: '6'`,
  'enrichment negative cache env',
);

await Promise.all([
  write('scripts/sync-upera.mjs', sync),
  write('scripts/enrich-persian-titles.mjs', enrich),
  write('.github/workflows/sync-upera.yml', syncWorkflow),
  write('.github/workflows/enrich-tmdb-cast.yml', enrichWorkflow),
]);

console.log('Applied exact episode artwork, Persian-title and GitHub push-race repairs.');

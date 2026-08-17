import fs from 'node:fs/promises';

const replaceOnce = (source, before, after, label) => {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(before, after);
};

let sync = await fs.readFile('scripts/sync-upera.mjs', 'utf8');
sync = replaceOnce(
  sync,
  `  let processedEpisodes = 0;\n  let addedEpisodes = 0;\n  let latestAddedEpisode = null;`,
  `  let processedEpisodes = 0;\n  let addedEpisodes = 0;\n  let latestAddedEpisode = null;\n  // Backfilling a historical gap is not a user-visible "update". Only an\n  // episode beyond the archive tail that existed before this run may move a\n  // published series to the front of updated/new shelves.\n  let latestForwardEpisode = null;`,
  'track forward episode separately',
);
sync = replaceOnce(
  sync,
  `      if (!previousGroup) {\n        addedEpisodes += 1;\n        stats.episodeGroupsAdded += 1;\n        latestAddedEpisode = episode;\n      }`,
  `      if (!previousGroup) {\n        addedEpisodes += 1;\n        stats.episodeGroupsAdded += 1;\n        latestAddedEpisode = episode;\n        if (isEpisodeAfterPublishedTail(episode, previousGroups)) {\n          latestForwardEpisode = episode;\n        }\n      }`,
  'only forward-tail episode is meaningful',
);
sync = replaceOnce(
  sync,
  `  const isMeaningfulEpisodeUpdate = Boolean(addedEpisodes > 0 && latestAddedEpisode && existing);`,
  `  const isMeaningfulEpisodeUpdate = Boolean(addedEpisodes > 0 && latestForwardEpisode && existing);`,
  'meaningful update requires forward episode',
);
sync = replaceOnce(
  sync,
  `  if (isMeaningfulEpisodeUpdate && latestAddedEpisode) {\n    const episodeNumber = episodeNumberValue(latestAddedEpisode);\n    updateLabel = \`قسمت \${toPersianDigits(episodeNumber)} اضافه شد\`;\n  } else if ((source === 'incremental' || source.endsWith('-priority')) && existing) {\n    updateLabel = 'بروزرسانی شد';\n  }`,
  `  if (isMeaningfulEpisodeUpdate && latestForwardEpisode) {\n    const episodeNumber = episodeNumberValue(latestForwardEpisode);\n    updateLabel = \`قسمت \${toPersianDigits(episodeNumber)} اضافه شد\`;\n  } else if (updateLabel === 'بروزرسانی شد') {\n    // A metadata/media refresh without a genuinely newer episode is not an\n    // update badge and must not pin this title at the front.\n    updateLabel = '';\n  }`,
  'truthful series update label',
);
await fs.writeFile('scripts/sync-upera.mjs', sync);

let client = await fs.readFile('scripts/client-catalog.mjs', 'utf8');
client = replaceOnce(
  client,
  `  'isDocumentary', 'isWildlife', 'mediaAuditStatus', 'createdAt', 'updatedAt', 'sourceCreatedAt', 'sourceUpdatedAt',\n  'tmdbValidationVersion',`,
  `  'isDocumentary', 'isWildlife', 'mediaAuditStatus', 'firstSeenAt', 'createdAt', 'updatedAt', 'sourceCreatedAt', 'sourceUpdatedAt',\n  'tmdbValidationVersion',`,
  'carry firstSeenAt in summaries',
);
client = replaceOnce(
  client,
  `    result.push({\n      ...(id ? { id } : {}),\n      ...(nameFa ? { nameFa } : {}),\n      ...(name ? { name } : {}),\n      role: person.role,\n      ...(tmdbId > 0 ? { tmdbId } : {}),\n    });`,
  `    result.push({\n      ...(id ? { id } : {}),\n      ...(nameFa ? { nameFa } : {}),\n      ...(name ? { name } : {}),\n      role: person.role,\n      ...(person.roleLabel ? { roleLabel: person.roleLabel } : {}),\n      ...(person.character ? { character: person.character } : {}),\n      ...(person.image ? { image: person.image } : {}),\n      ...(Number.isFinite(Number(person.order)) ? { order: Number(person.order) } : {}),\n      ...(tmdbId > 0 ? { tmdbId } : {}),\n    });`,
  'compact people carry visible fields',
);
client = replaceOnce(
  client,
  `  summary.availableLanguages = deriveClientLanguages(item);\n\n  // Movie detail actions should be usable from the lightweight index itself.`,
  `  summary.availableLanguages = deriveClientLanguages(item);\n  // Carry a small first-screen cast/director preview so opening a detail page\n  // does not visibly add the whole People section one or two seconds later.\n  // The immutable detail shard still hydrates the complete people list.\n  const summaryPeople = compactPersonReferences(item.people).slice(0, 8);\n  if (summaryPeople.length) summary.people = summaryPeople;\n\n  // Movie detail actions should be usable from the lightweight index itself.`,
  'attach compact people to client summary',
);
client = replaceOnce(
  client,
  `  // People are intentionally excluded from every item summary. The reverse\n  // peopleWorks index below preserves actor/director search and profile works\n  // without duplicating the same identities inside thousands of catalog rows.\n\n`,
  `  // The reverse peopleWorks index below preserves actor/director search and\n  // profile works. Summaries keep only the bounded preview above; full metadata\n  // remains in the content-addressed detail shard.\n\n`,
  'update people summary comment',
);
client = replaceOnce(
  client,
  `const clientCatalogFreshness = (item) => {\n  // Do not use lastSyncedAt: it changes every hourly pass and would make the\n  // entire archive look new. firstSeenAt represents a newly discovered title;\n  // meaningfulUpdatedAt represents a genuinely new episode/content update.\n  const candidates = item?.type === 'series'\n    ? [\n        item?.meaningfulUpdatedAt,\n        item?.firstSeenAt,\n        item?.sourceCreatedAt,\n        item?.createdAt,\n      ]\n    : [\n        item?.firstSeenAt,\n        item?.sourceCreatedAt,\n        item?.createdAt,\n      ];\n  return candidates.reduce((latest, value) => Math.max(latest, parsedTimestamp(value)), 0);\n};`,
  `const latestSeriesSourceEpisodeTimestamp = (item) =>\n  (Array.isArray(item?.downloads) ? item.downloads : []).reduce((latest, section) => {\n    if (!(Number(section?.episodeNumber || 0) > 0)) return latest;\n    return Math.max(latest, parsedTimestamp(section?.sourceUpdatedAt));\n  }, 0);\n\nconst clientCatalogFreshness = (item) => {\n  // Do not use lastSyncedAt/updatedAt: metadata enrichment and hourly repair\n  // must never make an old title look newly published. firstSeenAt is the\n  // discovery time. A series meaningfulUpdatedAt is trusted only when its\n  // update label names a new episode and the upstream episode timestamp is not\n  // older than the title's first appearance in Aparatchi. This also repairs\n  // ordering for old archives that were historically backfilled as "updates".\n  const firstSeen = parsedTimestamp(item?.firstSeenAt);\n  const meaningful = parsedTimestamp(item?.meaningfulUpdatedAt);\n  const latestEpisodeSource = latestSeriesSourceEpisodeTimestamp(item);\n  const hasEpisodeUpdateLabel = /^قسمت\\s+.+\\s+اضافه\\s+شد$/u.test(String(item?.updateLabel || '').trim());\n  const meaningfulIsCredible = Boolean(\n    item?.type === 'series' &&\n    meaningful > 0 &&\n    hasEpisodeUpdateLabel &&\n    (firstSeen <= 0 || latestEpisodeSource <= 0 || latestEpisodeSource >= firstSeen - 6 * 60 * 60 * 1000)\n  );\n  const candidates = item?.type === 'series'\n    ? [\n        meaningfulIsCredible ? item?.meaningfulUpdatedAt : '',\n        item?.firstSeenAt,\n        item?.sourceCreatedAt,\n        item?.createdAt,\n      ]\n    : [\n        item?.firstSeenAt,\n        item?.sourceCreatedAt,\n        item?.createdAt,\n      ];\n  return candidates.reduce((latest, value) => Math.max(latest, parsedTimestamp(value)), 0);\n};`,
  'truthful client freshness',
);
client = replaceOnce(
  client,
  `  'createdAt', 'updatedAt', 'sourceCreatedAt', 'sourceUpdatedAt', 'detailPath',`,
  `  'firstSeenAt', 'createdAt', 'updatedAt', 'sourceCreatedAt', 'sourceUpdatedAt', 'detailPath',`,
  'carry firstSeenAt in bootstrap navigation',
);
client = replaceOnce(
  client,
  `  // Preserve freshly updated titles even if they are not near the catalog head.\n  [...source]\n    .sort((a, b) => {\n      const timestamp = (item) => Math.max(\n        Date.parse(String(item?.meaningfulUpdatedAt || '')) || 0,\n        Date.parse(String(item?.sourceUpdatedAt || '')) || 0,\n        Date.parse(String(item?.updatedAt || '')) || 0,\n      );\n      return timestamp(b) - timestamp(a);\n    })\n    .slice(0, 24)\n    .forEach(add);`,
  `  // Preserve genuinely new/updated titles even if they are not near the\n  // catalog head. Reuse the same truth function; metadata timestamps must not\n  // make an old title a Home-critical row.\n  [...source]\n    .sort((a, b) => clientCatalogFreshness(b) - clientCatalogFreshness(a))\n    .slice(0, 24)\n    .forEach(add);`,
  'truthful bootstrap rich selection',
);
await fs.writeFile('scripts/client-catalog.mjs', client);

console.log('Applied v12 content fixes.');

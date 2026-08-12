import fs from 'node:fs/promises';

const read = (p) => fs.readFile(p, 'utf8');
const write = (p, s) => fs.writeFile(p, s, 'utf8');

function mustReplace(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`Missing patch target: ${label}`);
  return text.replace(before, after);
}

function replaceBetween(text, start, end, replacement, label) {
  const a = text.indexOf(start);
  if (a < 0) throw new Error(`Missing start: ${label}`);
  const b = text.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`Missing end: ${label}`);
  return text.slice(0, a) + replacement + text.slice(b);
}

let classification = await read('scripts/classification.mjs');
classification = mustReplace(
  classification,
  "const knownDocumentary = includesAny(titleText, ['از به', 'az be']);\n  const isDocumentary = knownNarrativeMovie ? false : knownDocumentary ? true : trustedTmdb\n    ? Boolean(input.isDocumentary)\n    : Boolean(documentaryGenre && !narrativeGenre);",
  "const knownDocumentary = includesAny(titleText, ['از بی', 'از به', 'az be']);\n  const explicitDocumentary = Boolean(\n    input.isDocumentary === true ||\n    existingKind === 'documentary' ||\n    existingKeys.includes('documentaries')\n  );\n  // Documentary identity is a content type, not the absence of dramatic genres.\n  // Episodic documentaries can legitimately carry Drama/War/etc. and must not\n  // fall into Iranian/foreign series merely because another genre is present.\n  const isDocumentary = knownNarrativeMovie\n    ? false\n    : Boolean(knownDocumentary || explicitDocumentary || documentaryGenre);",
  'documentary identity',
);
classification = mustReplace(
  classification,
  "  const type = input.type === 'series' ? 'series' : 'movie';\n  const genres = Array.isArray(input.genres) ? input.genres.map(clean).filter(Boolean) : [];",
  "  const type = input.type === 'series' ? 'series' : 'movie';\n  const forcedForeignTitle = includesAny(`${input.nameFa || ''} ${input.name || ''}`, ['the westies', 'وستی ها', 'وستی‌ها']);\n  const genres = Array.isArray(input.genres) ? input.genres.map(clean).filter(Boolean) : [];",
  'westies safety marker',
);
classification = mustReplace(
  classification,
  "  const trustedTmdb = validationVersion >= 7;",
  "  const trustedTmdb = validationVersion >= 7;\n  // The Westies was imported with a stale `ir` flag in an older source row.\n  // A known foreign identity must beat that legacy flag everywhere.\n  if (forcedForeignTitle) input = { ...input, ir: false, isIranian: false, is_iranian: false };",
  'westies override',
);
await write('scripts/classification.mjs', classification);

let client = await read('scripts/client-catalog.mjs');
client = mustReplace(
  client,
  "  // Keep the server-side record forever, but do not expose a completely empty\n  // series detail to users while the media-repair/backfill queue is still\n  // working. A previously visible series with at least one usable episode stays\n  // visible even while gaps are repaired.\n  if (!seriesHasUsableClientMedia(item)) return false;\n  return item.publicationStatus === 'published' || item.archiveComplete === true || item.visibilityLocked === true;",
  "  // Keep incomplete server records for backfill, but never expose a phantom\n  // or partially-built archive to the app. `visibilityLocked` was a legacy\n  // compatibility escape hatch and is intentionally NOT a publication signal.\n  if (!seriesHasUsableClientMedia(item)) return false;\n  return item.publicationStatus === 'published' || item.archiveComplete === true;",
  'strict client series visibility',
);
await write('scripts/client-catalog.mjs', client);

let sync = await read('scripts/sync-upera.mjs');
sync = mustReplace(sync, "const IRANIAN_SERIES_SCAN_VERSION = 3;", "const IRANIAN_SERIES_SCAN_VERSION = 4;", 'iranian scan version');
sync = mustReplace(sync, "const MEDIA_LANGUAGE_AUDIT_VERSION = 5;", "const MEDIA_LANGUAGE_AUDIT_VERSION = 6;\nconst IRANIAN_SERIES_REBUILD_VERSION = 1;", 'media/rebuild version');
sync = mustReplace(sync, "const CATALOG_VERSION = '0.22.0-final-stability';", "const CATALOG_VERSION = '0.23.0-user-bugfix-batch';", 'catalog version');
sync = mustReplace(
  sync,
  "const verifiedOperatorStreamOverrides = [\n  {\n    type: 'series',\n    sourceContentId: '0211f520-f2b9-11eb-8904-6179943b9168',\n    seasonNumber: 1,\n    episodeNumber: 12,\n    url: 'https://aparatchi.upera.tv/stream/episode/005c8400-0147-11f1-8eee-e3adfdcac641?ref=f1ts',\n  },\n];",
  "const verifiedOperatorStreamOverrides = [];",
  'remove manual Ganj Mozafar operator test',
);
sync = mustReplace(
  sync,
  "const syncModeSetting = ['AUTO', 'BACKFILL', 'NORMAL', 'PEOPLE'].includes(requestedSyncMode)",
  "const syncModeSetting = ['AUTO', 'BACKFILL', 'NORMAL', 'IRANIAN', 'PEOPLE'].includes(requestedSyncMode)",
  'IRANIAN sync mode',
);
sync = mustReplace(
  sync,
  "    syncModeSetting === 'BACKFILL' ? 18 : syncModeSetting === 'PEOPLE' ? 4 : 8,",
  "    syncModeSetting === 'BACKFILL' ? 18 : syncModeSetting === 'IRANIAN' ? 15 : syncModeSetting === 'PEOPLE' ? 4 : 8,",
  'IRANIAN run time',
);
sync = mustReplace(
  sync,
  "  iranianSeriesScanVersion: IRANIAN_SERIES_SCAN_VERSION,\n  operatorSeriesPage: 1,",
  "  iranianSeriesScanVersion: IRANIAN_SERIES_SCAN_VERSION,\n  iranianSeriesRebuildVersion: 0,\n  iranianSeriesNoProgress: {},\n  operatorSeriesPage: 1,",
  'iranian state defaults',
);
sync = mustReplace(
  sync,
  "state.iranianSeriesOffset = nonNegativeInt(state.iranianSeriesOffset, 0);\nif (Number(state.iranianSeriesScanVersion || 0) !== IRANIAN_SERIES_SCAN_VERSION) {",
  "state.iranianSeriesOffset = nonNegativeInt(state.iranianSeriesOffset, 0);\nif (!state.iranianSeriesNoProgress || typeof state.iranianSeriesNoProgress !== 'object' || Array.isArray(state.iranianSeriesNoProgress)) state.iranianSeriesNoProgress = {};\nif (Number(state.iranianSeriesScanVersion || 0) !== IRANIAN_SERIES_SCAN_VERSION) {",
  'iranian no-progress state init',
);

const migrationMarker = "let items = Array.isArray(catalog.items)\n  ? catalog.items.filter(Boolean)\n  : [];\n";
if (!sync.includes(migrationMarker)) throw new Error('Missing items marker');
sync = sync.replace(migrationMarker, migrationMarker + `
// One-time clean rebuild of Iranian narrative series. Old revisions could
// publish a shell with "تا قسمت N" while the episode files were empty. Preserve
// metadata, but clear only Iranian narrative episode media and rebuild it
// sequentially. Foreign series, documentaries, movies and people are untouched.
if (Number(state.iranianSeriesRebuildVersion || 0) < IRANIAN_SERIES_REBUILD_VERSION) {
  let resetCount = 0;
  items = items.map((item) => {
    if (item?.type !== 'series') return item;
    const rules = classifyCatalogRules({ ...item, categoryKeys: [], categoryLabels: [] });
    if (!rules.ir || rules.isDocumentary || rules.contentKind === 'documentary') return item;
    resetCount += 1;
    return {
      ...item,
      downloads: [],
      episodeCount: 0,
      seasonCount: 0,
      latestEpisode: null,
      sourceEpisodeCount: 0,
      archivePendingEpisodeCount: 1,
      archivePendingEpisodes: [],
      archiveUnavailableEpisodes: [],
      archiveComplete: false,
      archiveAuditStatus: 'pending',
      publicationStatus: 'building-archive',
      visibilityLocked: false,
      mediaLanguageAuditVersion: 0,
    };
  });
  state.iranianSeriesPage = 1;
  state.iranianSeriesOffset = 0;
  state.iranianSeriesNoProgress = {};
  state.iranianSeriesRebuildVersion = IRANIAN_SERIES_REBUILD_VERSION;
  // Do not let old compatibility migrations republish the shells we just hid.
  state.legacySeriesVisibilityMigrationCompleted = true;
  state.historicalVisibleSeriesRecoveryCompleted = true;
  console.log(\`بازسازی تمیز سریال ایرانی: \${resetCount} عنوان برای تکمیل ترتیبی ریست شد.\`);
}
`);

sync = mustReplace(
  sync,
  "const effectiveSyncMode =\n  syncModeSetting === 'PEOPLE'\n    ? 'PEOPLE'\n    : syncModeSetting === 'BACKFILL' ||\n      (syncModeSetting === 'AUTO' && initialBackfillQueue.length > 0)\n      ? 'BACKFILL'\n      : 'NORMAL';",
  "const effectiveSyncMode =\n  syncModeSetting === 'PEOPLE'\n    ? 'PEOPLE'\n    : syncModeSetting === 'IRANIAN'\n      ? 'IRANIAN'\n      : syncModeSetting === 'BACKFILL' ||\n        (syncModeSetting === 'AUTO' && initialBackfillQueue.length > 0)\n        ? 'BACKFILL'\n        : 'NORMAL';",
  'effective IRANIAN mode',
);
sync = mustReplace(
  sync,
  "} else if (effectiveSyncMode === 'BACKFILL') {\n  // The archive queue is intentionally exclusive:",
  `} else if (effectiveSyncMode === 'IRANIAN') {
  // Dedicated hourly lane: one Iranian narrative series stays selected until
  // every discoverable episode has usable media. This lane is independent of
  // the global foreign/archive backlog.
  await withAffiliateRequestScope(
    'iranian-series',
    iranianSeriesRequestQuota,
    syncIranianSeriesArchive,
  );
} else if (effectiveSyncMode === 'BACKFILL') {
  // The archive queue is intentionally exclusive:`,
  'IRANIAN execution branch',
);

sync = replaceBetween(
  sync,
  "async function syncIranianSeriesArchive() {",
  "\nasync function syncOperatorPriorityDiscovery()",
  `async function syncIranianSeriesArchive() {
  // Strict sequential cursor: process ONE title per run and do not advance
  // until complete. A permanently broken source is hidden and deferred after
  // bounded attempts so it cannot freeze the whole Iranian queue forever.
  const maxNoProgress = 3;
  let pagesVisited = 0;
  const seenPages = new Set();

  while (!affiliateBudgetExhausted && pagesVisited < Math.max(1, iranianSeriesPagesPerRun)) {
    const page = positiveInt(state.iranianSeriesPage, 1);
    if (seenPages.has(page)) return;
    seenPages.add(page);

    let payload;
    try {
      payload = await fetchIranianSeriesPage(page);
    } catch (error) {
      rememberError(\`iranian-series-page-\${page}\`, error);
      return;
    }

    const candidates = dedupeCandidates(payload.items)
      .sort((a, b) => Number(inferIranian(b)) - Number(inferIranian(a)));
    if (!candidates.length) {
      state.iranianSeriesPage = nextPage(page, payload.lastPage);
      state.iranianSeriesOffset = 0;
      pagesVisited += 1;
      stats.iranianSeriesPagesProcessed += 1;
      continue;
    }

    let offset = nonNegativeInt(state.iranianSeriesOffset, 0);
    if (offset >= candidates.length) offset = 0;
    const candidate = candidates[offset];
    const sourceId = String(baseCatalogId(candidate) || candidate?.t_id || candidate?.series_id || '');
    const progressKey = sourceId || \`p\${page}-o\${offset}\`;
    stats.iranianSeriesCandidates += 1;

    let result;
    try {
      result = await processSeries(candidate, 'iranian-priority', {
        requireIranian: true,
        episodeStrategy: 'latest',
        episodeLimit: Math.min(120, Math.max(1, priorityEpisodesPerSeries)),
        onlyMissing: true,
      });
    } catch (error) {
      rememberError(\`iranian-series-\${progressKey}\`, error);
      result = { added: false, reason: 'request-error', retryLater: false };
    }

    const refreshed = items.find((item) =>
      item?.type === 'series' &&
      (String(baseCatalogId(item)) === sourceId || String(item.id || '') === sourceId)
    );
    const belongsToIranianSeries = Boolean(
      refreshed &&
      classifyCatalogRules({ ...refreshed, categoryKeys: [], categoryLabels: [] }).categoryKeys.includes('iranian-series')
    );

    rememberDiagnostic('iranianSeriesDiagnostics', {
      id: sourceId,
      title: cleanText(candidate?.name_fa || candidate?.name || refreshed?.nameFa || refreshed?.name || ''),
      result: result?.archiveComplete ? 'completed' : result?.added ? 'advanced' : 'rejected',
      reason: result?.reason || '',
      addedEpisodes: Number(result?.addedEpisodes || 0),
      remainingEpisodeCount: Number(result?.remainingEpisodeCount || 0),
      retryLater: Boolean(result?.retryLater),
    });

    // Foreign/documentary/invalid rows do not belong in this queue.
    if (!belongsToIranianSeries && !result?.retryLater) {
      delete state.iranianSeriesNoProgress[progressKey];
      offset += 1;
      state.iranianSeriesOffset = offset;
      if (offset >= candidates.length) {
        state.iranianSeriesPage = nextPage(page, payload.lastPage);
        state.iranianSeriesOffset = 0;
        stats.iranianSeriesPagesProcessed += 1;
      }
      await persistSyncCheckpoint(\`iranian-skip-\${progressKey}\`);
      return;
    }

    if (
      refreshed?.archiveComplete === true &&
      refreshed?.publicationStatus === 'published' &&
      Number(result?.remainingEpisodeCount || 0) === 0
    ) {
      delete state.iranianSeriesNoProgress[progressKey];
      offset += 1;
      state.iranianSeriesOffset = offset;
      if (offset >= candidates.length) {
        state.iranianSeriesPage = nextPage(page, payload.lastPage);
        state.iranianSeriesOffset = 0;
        stats.iranianSeriesPagesProcessed += 1;
      }
      await persistSyncCheckpoint(\`iranian-complete-\${progressKey}\`);
      return;
    }

    const progressed = Number(result?.addedEpisodes || 0) > 0 || Boolean(result?.added && result?.retryLater);
    if (progressed || result?.retryLater) {
      state.iranianSeriesNoProgress[progressKey] = 0;
      // DO NOT advance offset: next hourly run continues this exact series.
      await persistSyncCheckpoint(\`iranian-progress-\${progressKey}\`);
      return;
    }

    const attempts = nonNegativeInt(state.iranianSeriesNoProgress[progressKey], 0) + 1;
    state.iranianSeriesNoProgress[progressKey] = attempts;
    if (attempts >= maxNoProgress) {
      if (refreshed) {
        replaceItem({
          ...refreshed,
          archiveComplete: false,
          publicationStatus: 'building-archive',
          visibilityLocked: false,
          archiveAuditStatus: 'blocked',
          archiveBlockedReason: result?.reason || 'iranian-no-progress',
          archiveBlockedAttempts: attempts,
          archiveBlockedAt: new Date().toISOString(),
        });
      }
      // Hidden broken title is retried later by repair/backfill lanes; advance
      // this dedicated discovery queue so the next Iranian title can start.
      offset += 1;
      state.iranianSeriesOffset = offset;
      if (offset >= candidates.length) {
        state.iranianSeriesPage = nextPage(page, payload.lastPage);
        state.iranianSeriesOffset = 0;
        stats.iranianSeriesPagesProcessed += 1;
      }
      await persistSyncCheckpoint(\`iranian-deferred-\${progressKey}\`);
      return;
    }

    await persistSyncCheckpoint(\`iranian-no-progress-\${progressKey}\`);
    return;
  }
}
`,
  'sequential Iranian series function',
);

sync = replaceBetween(
  sync,
  "async function fetchPanelShowLinks(id, type) {",
  "\nasync function fetchAffiliateLinks(",
  `function panelTrafficFlag(value, fallback = null) {
  if (!value || typeof value !== 'object') return fallback;
  for (const key of ['traffic_oo', 'trafficOo', 'trafficOO']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const number = Number(value[key]);
      if (number === 0 || number === 1) return number;
    }
  }
  return fallback;
}

function findPanelTrafficFlag(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return null;
  const direct = panelTrafficFlag(value, null);
  if (direct === 0 || direct === 1) return direct;
  for (const child of Object.values(value)) {
    if (!child || typeof child !== 'object') continue;
    const found = findPanelTrafficFlag(child, depth + 1);
    if (found === 0 || found === 1) return found;
  }
  return null;
}

async function fetchPanelShowLinks(id, type) {
  if (!panelToken || !['movie', 'episode'].includes(String(type))) return [];
  const json = await fetchPanelJson(
    \`\${PANEL_API_BASE}/owner/show_links/\${encodeURIComponent(type)}/\${encodeURIComponent(id)}\`,
  );
  const data = json?.data ?? json ?? {};
  const rootTraffic = findPanelTrafficFlag(data);
  const records = extractAffiliateLinkRecords(data);

  const verified = records.map((link) => {
    const traffic = panelTrafficFlag(link, rootTraffic);
    return {
      ...link,
      _panel_verified: true,
      ...(traffic === 0 || traffic === 1 ? { _traffic_oo: traffic } : {}),
    };
  }).filter((link) => Number(link._traffic_oo) === 0 || Number(link._traffic_oo) === 1);

  // Some panel deployments return traffic_oo and title metadata from show_links
  // but omit the already-known player URL. Because this response is
  // authenticated and scoped to the exact movie/episode id, the canonical Upera
  // /stream route is safe to reconstruct. Never do this without traffic_oo.
  if (!verified.length && (rootTraffic === 0 || rootTraffic === 1)) {
    verified.push({
      link: \`https://aparatchi.upera.tv/stream/\${type}/\${encodeURIComponent(id)}?ref=\${encodeURIComponent(refId)}\`,
      title: rootTraffic === 1 ? 'پخش ویژه اینترنت همراه' : 'پخش آنلاین',
      _panel_verified: true,
      _traffic_oo: rootTraffic,
    });
  }
  return uniqueByUrl(verified);
}
`,
  'panel show-links parser',
);

sync = mustReplace(
  sync,
  "function mediaLanguageLabel(tag) {\n  if (tag === 'dubbed') return 'دوبله فارسی';\n  if (tag === 'subtitled') return 'زیرنویس فارسی';\n  return 'نسخه اصلی';\n}",
  `function mediaLanguageLabel(tag) {
  if (tag === 'dubbed') return 'دوبله فارسی';
  if (tag === 'subtitled') return 'زیرنویس فارسی';
  return 'لینک‌های دریافت';
}

function reconcileUperaLanguageLinks(links) {
  const list = Array.isArray(links) ? links : [];
  const ordinary = list.filter((link) => !operatorPortalDetails(link?.link));
  const explicit = new Set(ordinary.map((link) => link?._media_language_tag).filter(Boolean));
  const unknown = ordinary.filter((link) => !link?._media_language_tag);

  if (!unknown.length) return list;
  if (explicit.has('dubbed') && explicit.has('subtitled')) {
    // Provider has both real variants; a third unlabeled row is stale/duplicate,
    // never a fictional "original" version.
    for (const link of unknown) link._drop_ambiguous_language = true;
    return list;
  }

  if (explicit.size === 1) {
    const counterpart = explicit.has('dubbed') ? 'subtitled' : 'dubbed';
    for (const link of unknown) {
      link._media_language_tag = counterpart;
      link._media_language = mediaLanguageLabel(counterpart);
    }
  }
  return list;
}

function isLikelyDownloadableAffiliateLink(link) {
  if (isDownloadableMediaUrl(link?.link)) return true;
  if (!isHttp(link?.link) || operatorPortalDetails(link?.link)) return false;
  const text = mediaLinkDescriptor(link);
  return /(?:360|480|720|1080|1440|2160|hq|quality|download|دانلود|کیفیت)/i.test(text);
}`,
  'language helpers',
);
sync = mustReplace(
  sync,
  "  const normalizedLinks = (Array.isArray(links) ? links : [])\n    .filter((link) => isHttp(link?.link))\n    .map((link) => {",
  "  const normalizedLinks = reconcileUperaLanguageLinks((Array.isArray(links) ? links : [])\n    .filter((link) => isHttp(link?.link))\n    .map((link) => {",
  'wrap normalized links',
);
sync = mustReplace(
  sync,
  "      return next;\n    });\n\n  // Purchase/subscription links are not part of Aparatchi.",
  "      return next;\n    }));\n\n  // Purchase/subscription links are not part of Aparatchi.",
  'close reconciled links',
);
sync = mustReplace(
  sync,
  "  const ordinaryLinks = normalizedLinks.filter((link) =>\n    !operatorPortalDetails(link?.link) && link._media_price_tier !== 'paid',\n  );",
  "  const ordinaryLinks = normalizedLinks.filter((link) =>\n    !operatorPortalDetails(link?.link) && link._media_price_tier !== 'paid' && !link._drop_ambiguous_language,\n  );",
  'drop ambiguous original',
);
sync = mustReplace(
  sync,
  "    const language = link._media_language || 'نسخه اصلی';",
  "    const language = link._media_language || 'لینک‌های دریافت';",
  'neutral language bucket',
);
sync = mustReplace(
  sync,
  "      if (isDownloadableMediaUrl(link.link)) {",
  "      if (isLikelyDownloadableAffiliateLink(link)) {",
  'extensionless downloads',
);
sync = mustReplace(
  sync,
  "  if (tag === 'subtitled') return 'زیرنویس فارسی';\n  return 'نسخه اصلی';\n}\n\nfunction qualityLabel",
  "  if (tag === 'subtitled') return 'زیرنویس فارسی';\n  return 'لینک‌های دریافت';\n}\n\nfunction qualityLabel",
  'linkLanguage neutral fallback',
);

sync = replaceBetween(
  sync,
  "function inferIranian(item) {",
  "\nfunction extractCandidates(",
  `function inferIranian(item) {
  const identity = normalizeIdentityName(\`\${item?.name_fa || item?.nameFa || ''} \${item?.name || ''}\`);
  if (/(?:^| )the westies(?: |$)/i.test(identity) || /وستی(?: |‌)?ها/.test(identity)) return false;

  // Strong source identity beats stale legacy ir flag. Do not use generic audio
  // language here: a dubbed foreign title can legitimately have Persian audio.
  const originalLanguage = cleanText(
    item?.original_language || item?.originalLanguage || '',
  ).toLowerCase();
  if (['fa', 'fas', 'per', 'persian'].includes(originalLanguage)) return true;
  if (originalLanguage) return false;

  const countryValue = [
    item?.country_fa,
    item?.country,
    item?.countries,
    item?.country_name,
    item?.countryName,
    item?.country_code,
    item?.countryCode,
  ];
  let country = '';
  try {
    country = JSON.stringify(countryValue);
  } catch {
    country = countryValue.map((value) => cleanText(value)).join(' ');
  }
  if (/ایران|iran|(?:^|[^a-z])ir(?:[^a-z]|$)/i.test(country)) return true;
  if (countryValue.some((value) => value !== undefined && value !== null && cleanText(value))) return false;

  const irFlag = item?.ir ?? item?.is_iranian ?? item?.isIranian;
  return Boolean(
    irFlag === true ||
    Number(irFlag || 0) === 1 ||
    String(irFlag || '').toLowerCase() === 'true'
  );
}
`,
  'authoritative Iranian identity',
);

sync = mustReplace(
  sync,
  "  const latestEpisode = [...groups]\n    .sort(compareEpisodeGroups)\n    .at(-1);",
  "  const usableGroups = groups.filter(episodeGroupHasUsableMedia);\n  const latestEpisode = [...usableGroups]\n    .sort(compareEpisodeGroups)\n    .at(-1);",
  'usable latest episode',
);
sync = mustReplace(
  sync,
  "  const seasonNumbers = new Set(\n    groups\n      .map((group) =>",
  "  const seasonNumbers = new Set(\n    usableGroups\n      .map((group) =>",
  'usable season count',
);
sync = mustReplace(sync, "    episodeCount: groups.length,", "    episodeCount: usableGroups.length,", 'usable episode count');
sync = mustReplace(
  sync,
  "    visibilityLocked: Boolean(\n      existing?.visibilityLocked ||\n      existing?.publicationStatus === 'published' ||\n      archiveMeta.publicationStatus === 'published'\n    ),",
  "    visibilityLocked: Boolean(\n      !ir && (\n        existing?.visibilityLocked ||\n        existing?.publicationStatus === 'published'\n      )\n    ),",
  'no Iranian legacy visibility lock',
);
sync = mustReplace(
  sync,
  "  const keepPreviouslyVisible = Boolean(\n    existing?.visibilityLocked &&\n    mergedGroups.length > 0,\n  );",
  "  const keepPreviouslyVisible = Boolean(\n    !iranian &&\n    existing?.visibilityLocked &&\n    mergedGroups.some(episodeGroupHasUsableMedia),\n  );",
  'strict Iranian process publication',
);
sync = mustReplace(
  sync,
  "  const visibilityLocked = Boolean(\n    item.visibilityLocked ||\n    (item.publicationStatus === 'published' && hasEpisodes)\n  );",
  "  const strictIranianArchive = Boolean(effectiveIranianIdentity(item) && !item.isDocumentary && item.contentKind !== 'documentary');\n  const visibilityLocked = Boolean(\n    !strictIranianArchive && (\n      item.visibilityLocked ||\n      (item.publicationStatus === 'published' && hasEpisodes)\n    )\n  );",
  'strict Iranian withSeriesPublicationState',
);
sync = mustReplace(
  sync,
  "  if (wasVisible && current.publicationStatus !== 'published') {",
  "  const strictIranian = Boolean(effectiveIranianIdentity(current) && !current?.isDocumentary && current?.contentKind !== 'documentary');\n  if (wasVisible && !strictIranian && current.publicationStatus !== 'published') {",
  'monotonic guard Iranian exception',
);

await write('scripts/sync-upera.mjs', sync);

let backfill = await read('scripts/prepare-archive-backfill.mjs');
backfill = backfill.replace(/const MEDIA_LANGUAGE_AUDIT_VERSION = \d+;/, 'const MEDIA_LANGUAGE_AUDIT_VERSION = 6;');
await write('scripts/prepare-archive-backfill.mjs', backfill);

let workflow = await read('.github/workflows/sync-upera.yml');
workflow = mustReplace(
  workflow,
  "      - name: Ensure ffmpeg for episode thumbnails",
  `      - name: Complete one Iranian series sequentially
        id: iranian_sync
        continue-on-error: true
        env:
          UPERA_REF_ID: \${{ secrets.UPERA_REF_ID }}
          UPERA_TOKEN: \${{ secrets.UPERA_TOKEN }}
          UPERA_PANEL_TOKEN: \${{ secrets.UPERA_PANEL_TOKEN }}
          UPERA_SYNC_MODE: 'IRANIAN'
          APARATCHI_RUN_TIME_LIMIT_MINUTES: '15'
          APARATCHI_CHECKPOINT_RESERVE_MS: '45000'
          APARATCHI_REQUEST_TIMEOUT_MS: '12000'
          APARATCHI_REQUEST_MAX_ATTEMPTS: '2'
          UPERA_MAX_REQUESTS_PER_RUN: '220'
          UPERA_REQUEST_DELAY_MS: '520'
          UPERA_IRANIAN_SERIES_REQUEST_QUOTA: '180'
          UPERA_IRANIAN_SERIES_PAGES_PER_RUN: '5'
          UPERA_IRANIAN_SERIES_TITLES_PER_RUN: '1'
          UPERA_PRIORITY_EPISODES_PER_SERIES: '120'
          UPERA_MAX_EPISODE_PAGES: '80'
          UPERA_OPERATOR_MOVIE_REQUEST_QUOTA: '8'
          UPERA_OPERATOR_SERIES_REQUEST_QUOTA: '8'
          UPERA_OPERATOR_MOVIE_PAGES_PER_RUN: '2'
          UPERA_OPERATOR_SERIES_PAGES_PER_RUN: '2'
          APARATCHI_SYNC_MAX_MIRRORED_IMAGES: '0'
        run: node scripts/sync-upera.mjs

      - name: Commit Iranian-series progress
        if: always()
        shell: bash
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add catalog.json catalog-index.json catalog-items catalog-manifest.json sync-state.json sync-report*.json
          if git diff --cached --quiet; then
            echo "No Iranian-series changes."
          else
            git commit -m "chore: advance Iranian series sequentially"
            git pull --rebase origin main
            git push origin HEAD:main
          fi

      - name: Ensure ffmpeg for episode thumbnails`,
  'insert Iranian workflow stage',
);
workflow = mustReplace(workflow, "          UPERA_RETRY_BLOCKED: 'true'", "          UPERA_RETRY_BLOCKED: 'false'", 'bounded blocked backfill');
workflow = mustReplace(
  workflow,
  "          if [ '${{ steps.people_sync.outcome }}' = 'failure' ]; then FAILED_STAGES=\"${FAILED_STAGES} people\"; fi",
  "          if [ '${{ steps.iranian_sync.outcome }}' = 'failure' ]; then FAILED_STAGES=\"${FAILED_STAGES} iranian\"; fi\n          if [ '${{ steps.people_sync.outcome }}' = 'failure' ]; then FAILED_STAGES=\"${FAILED_STAGES} people\"; fi",
  'workflow status Iranian',
);
await write('.github/workflows/sync-upera.yml', workflow);

const regression = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { classifyCatalogItem } from '../classification.mjs';

test('Az Be stays documentary even when Drama is also present', () => {
  const item = classifyCatalogItem({
    type: 'series',
    ir: true,
    nameFa: 'از بی',
    name: 'Az Be',
    genres: ['مستند', 'درام'],
  });
  assert.equal(item.isDocumentary, true);
  assert.ok(item.categoryKeys.includes('documentaries'));
  assert.ok(!item.categoryKeys.includes('iranian-series'));
});

test('The Westies is never classified as Iranian series from stale flags', () => {
  const item = classifyCatalogItem({
    type: 'series',
    ir: true,
    nameFa: 'وستی ها',
    name: 'The Westies',
    genres: ['درام'],
  });
  assert.ok(!item.categoryKeys.includes('iranian-series'));
});

test('sync source has no Persian UI fallback named نسخه اصلی', () => {
  const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');
  assert.ok(!source.includes("return 'نسخه اصلی'"));
  assert.ok(source.includes('MEDIA_LANGUAGE_AUDIT_VERSION = 6'));
  assert.ok(source.includes("UPERA_SYNC_MODE || 'AUTO'"));
});

test('Iranian lane is independent and sequential', () => {
  const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes("syncModeSetting === 'IRANIAN'"));
  assert.ok(source.includes('DO NOT advance offset'));
  assert.ok(source.includes('IRANIAN_SERIES_REBUILD_VERSION = 1'));
});
`;
await write('scripts/tests/user-bugfix-batch.test.mjs', regression);

console.log('Applied Aparatchi user bugfix batch.');

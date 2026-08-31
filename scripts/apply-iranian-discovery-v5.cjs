const fs = require('fs');
const file = 'scripts/sync-upera.mjs';
let source = fs.readFileSync(file, 'utf8');

source = source.replace('const IRANIAN_SERIES_SCAN_VERSION = 4;', 'const IRANIAN_SERIES_SCAN_VERSION = 5;');

const resetStart = source.indexOf('if (Number(state.iranianSeriesScanVersion || 0) !== IRANIAN_SERIES_SCAN_VERSION) {');
if (resetStart < 0) throw new Error('Iranian scan reset block not found');
const resetEnd = source.indexOf('\n}', resetStart);
if (resetEnd < 0) throw new Error('Iranian scan reset block end not found');
const resetBlock = source.slice(resetStart, resetEnd + 2);
if (!resetBlock.includes('state.iranianSeriesActiveId')) {
  const patchedReset = resetBlock.replace(
    '  state.iranianSeriesOffset = 0;',
    "  state.iranianSeriesOffset = 0;\n  state.iranianSeriesActiveId = '';\n  state.iranianSeriesNoProgress = {};",
  );
  source = source.slice(0, resetStart) + patchedReset + source.slice(resetEnd + 2);
}

const fetchStart = source.indexOf('async function fetchIranianSeriesPage(page) {');
const fetchEnd = source.indexOf('\nasync function fetchOperatorSeriesPage', fetchStart);
if (fetchStart < 0 || fetchEnd < 0) throw new Error('fetchIranianSeriesPage block not found');
const newFetch = String.raw`async function fetchIranianSeriesPage(page) {
  // Verified against Seeko on 2026-08-31: country=IR is the actual Iranian
  // archive selector. persian=1 returns the generic media-language feed.
  const variants = [
    { free: 1, persian: '', country: 'IR', traffic: 1, noFreeFallback: true },
    { free: '', persian: '', country: 'IR', traffic: 1, noFreeFallback: true },
  ];
  const results = [];
  for (const filters of variants) {
    try {
      results.push(await fetchScopedArchivePage('series', page, filters));
    } catch (error) {
      rememberError('iranian-series-filter-' + page + '-' + JSON.stringify(filters), error);
    }
  }
  return {
    items: dedupeCandidates(results.flatMap((result) => result.items || [])),
    lastPage: Math.max(1, ...results.map((result) => Number(result.lastPage || 1))),
  };
}
`;
source = source.slice(0, fetchStart) + newFetch + source.slice(fetchEnd + 1);

const syncStart = source.indexOf('async function syncIranianSeriesArchive() {');
const syncEnd = source.indexOf('\nasync function syncOperatorPriorityDiscovery()', syncStart);
if (syncStart < 0 || syncEnd < 0) throw new Error('syncIranianSeriesArchive block not found');
const newSync = String.raw`async function syncIranianSeriesArchive() {
  // This lane discovers one genuinely NEW Iranian series at a time. Existing
  // titles are skipped in the same invocation instead of wasting an hourly run.
  const maxNoProgress = 2;
  let pagesVisited = 0;
  const seenPages = new Set();

  const suppressed = (candidate, sourceId) => {
    const identity = normalizeIdentityName(String(candidate?.name_fa || candidate?.nameFa || '') + ' ' + String(candidate?.name || ''));
    return sourceId === 'f72e7850-344c-11f1-9db2-59adfc143adb' ||
      identity.includes('peopleofiran') || identity.includes('اهلایران') ||
      identity.includes('thewesties') || identity.includes('وستیها');
  };

  const advanceCursor = (page, payload, candidates, nextOffset) => {
    state.iranianSeriesActiveId = '';
    state.iranianSeriesOffset = nextOffset;
    if (nextOffset >= candidates.length) {
      state.iranianSeriesPage = nextPage(page, payload.lastPage);
      state.iranianSeriesOffset = 0;
      stats.iranianSeriesPagesProcessed += 1;
      pagesVisited += 1;
    }
  };

  while (
    !affiliateBudgetExhausted &&
    !affiliateScopeExhausted &&
    pagesVisited < Math.max(1, iranianSeriesPagesPerRun) &&
    !runTimeBudgetReached('iranian-series-discovery', 65000)
  ) {
    const page = positiveInt(state.iranianSeriesPage, 1);
    if (seenPages.has(page)) break;
    seenPages.add(page);

    let payload;
    try {
      payload = await fetchIranianSeriesPage(page);
    } catch (error) {
      rememberError('iranian-series-page-' + page, error);
      break;
    }

    const candidates = dedupeCandidates(payload.items)
      .sort((a, b) => Number(inferIranian(b)) - Number(inferIranian(a)));
    if (!candidates.length) {
      state.iranianSeriesPage = nextPage(page, payload.lastPage);
      state.iranianSeriesOffset = 0;
      state.iranianSeriesActiveId = '';
      stats.iranianSeriesPagesProcessed += 1;
      pagesVisited += 1;
      continue;
    }

    let offset = nonNegativeInt(state.iranianSeriesOffset, 0);
    if (offset >= candidates.length) offset = 0;
    const lockedId = cleanText(state.iranianSeriesActiveId || '');
    if (lockedId) {
      const lockedIndex = candidates.findIndex((entry) =>
        String(baseCatalogId(entry) || entry?.t_id || entry?.series_id || '') === lockedId,
      );
      if (lockedIndex >= 0) offset = lockedIndex;
      else state.iranianSeriesActiveId = '';
    }

    let pageAdvanced = false;
    while (
      offset < candidates.length &&
      !affiliateBudgetExhausted &&
      !affiliateScopeExhausted &&
      !runTimeBudgetReached('iranian-series-candidate', 60000)
    ) {
      const candidate = candidates[offset];
      const sourceId = String(baseCatalogId(candidate) || candidate?.t_id || candidate?.series_id || '');
      const progressKey = sourceId || ('p' + page + '-o' + offset);

      if (suppressed(candidate, sourceId) || !inferIranian(candidate)) {
        delete state.iranianSeriesNoProgress[progressKey];
        advanceCursor(page, payload, candidates, offset + 1);
        offset = nonNegativeInt(state.iranianSeriesOffset, 0);
        if (state.iranianSeriesPage !== page) { pageAdvanced = true; break; }
        continue;
      }

      const existing = findExistingItem(candidate, 'series');
      const isLocked = Boolean(state.iranianSeriesActiveId && state.iranianSeriesActiveId === sourceId);
      if (existing && !isLocked) {
        delete state.iranianSeriesNoProgress[progressKey];
        advanceCursor(page, payload, candidates, offset + 1);
        offset = nonNegativeInt(state.iranianSeriesOffset, 0);
        if (state.iranianSeriesPage !== page) { pageAdvanced = true; break; }
        continue;
      }

      if (!state.iranianSeriesActiveId && sourceId) state.iranianSeriesActiveId = sourceId;
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
        rememberError('iranian-series-' + progressKey, error);
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
      const publishedNow = Boolean(
        belongsToIranianSeries &&
        refreshed?.archiveComplete === true &&
        refreshed?.publicationStatus === 'published' &&
        Number(result?.remainingEpisodeCount || 0) === 0
      );

      rememberDiagnostic('iranianSeriesDiagnostics', {
        id: sourceId,
        title: cleanText(candidate?.name_fa || candidate?.name || refreshed?.nameFa || refreshed?.name || ''),
        result: publishedNow ? 'published-new' : result?.added ? 'advanced-new' : 'rejected',
        reason: result?.reason || '',
        addedEpisodes: Number(result?.addedEpisodes || 0),
        remainingEpisodeCount: Number(result?.remainingEpisodeCount || 0),
        retryLater: Boolean(result?.retryLater),
        newlyPublished: publishedNow,
        discovery: 'new-only-country-IR',
      });

      if (publishedNow) {
        delete state.iranianSeriesNoProgress[progressKey];
        advanceCursor(page, payload, candidates, offset + 1);
        await persistSyncCheckpoint('iranian-published-new-' + progressKey);
        return true;
      }

      const progressed = Boolean(
        belongsToIranianSeries &&
        (Number(result?.addedEpisodes || 0) > 0 || (result?.added && refreshed?.publicationStatus === 'building-archive'))
      );
      if (progressed || result?.retryLater) {
        state.iranianSeriesNoProgress[progressKey] = 0;
        await persistSyncCheckpoint('iranian-progress-new-' + progressKey);
        return false;
      }

      const attempts = nonNegativeInt(state.iranianSeriesNoProgress[progressKey], 0) + 1;
      state.iranianSeriesNoProgress[progressKey] = attempts;
      const terminal = !belongsToIranianSeries || ['not-iranian', 'no-usable-links', 'missing-detail'].includes(String(result?.reason || ''));
      if (terminal || attempts >= maxNoProgress) {
        if (refreshed && belongsToIranianSeries && refreshed.publicationStatus !== 'published') {
          replaceItem({
            ...refreshed,
            archiveComplete: false,
            publicationStatus: 'building-archive',
            visibilityLocked: false,
            archiveAuditStatus: 'blocked',
            archiveBlockedReason: result?.reason || 'iranian-discovery-no-progress',
            archiveBlockedAttempts: attempts,
            archiveBlockedAt: new Date().toISOString(),
          });
        }
        state.iranianSeriesActiveId = '';
        advanceCursor(page, payload, candidates, offset + 1);
        offset = nonNegativeInt(state.iranianSeriesOffset, 0);
        if (state.iranianSeriesPage !== page) { pageAdvanced = true; break; }
        continue;
      }

      await persistSyncCheckpoint('iranian-no-progress-new-' + progressKey);
      return false;
    }

    if (pageAdvanced) continue;
    if (offset >= candidates.length) {
      state.iranianSeriesPage = nextPage(page, payload.lastPage);
      state.iranianSeriesOffset = 0;
      state.iranianSeriesActiveId = '';
      stats.iranianSeriesPagesProcessed += 1;
      pagesVisited += 1;
    }
  }

  return false;
}
`;
source = source.slice(0, syncStart) + newSync + source.slice(syncEnd + 1);

fs.writeFileSync(file, source);
console.log('Patched Iranian discovery v5');

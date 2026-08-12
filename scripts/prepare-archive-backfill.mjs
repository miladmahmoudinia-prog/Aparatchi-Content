import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const statePath = path.join(root, 'sync-state.json');
const MEDIA_LANGUAGE_AUDIT_VERSION = 6;
const blockedCooldownHours = Math.max(
  1,
  Number.parseInt(String(process.env.APARATCHI_BLOCKED_COOLDOWN_HOURS || '6'), 10) || 6,
);

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const yearOf = (item) => {
  const year = Number(item?.year);
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : 9999;
};

const isUsableFile = (file) => {
  if (!file || file.mode === 'purchase' || file.purchaseRequired === true) return false;
  const mode = String(file.mode || 'download');
  if (mode === 'operator-play' || mode === 'operator-download') return /^https?:\/\//i.test(String(file.url || ''));
  return /\.(?:mp4|m3u8|m4v|mov|webm|mkv)(?:$|[?#])/i.test(String(file.url || ''));
};

const hasUsableMedia = (item) => {
  if (/\.(?:mp4|m3u8|m4v|mov|webm|mkv)(?:$|[?#])/i.test(String(item?.streamUrl || ''))) return true;
  return (Array.isArray(item?.downloads) ? item.downloads : []).some((section) =>
    (Array.isArray(section?.files) ? section.files : []).some(isUsableFile),
  );
};

const blockedCoolingDown = (item, now = Date.now()) => {
  if (item?.archiveAuditStatus !== 'blocked') return false;
  const blockedAt = Date.parse(String(item?.archiveBlockedAt || ''));
  if (!Number.isFinite(blockedAt)) return false;
  return now - blockedAt < blockedCooldownHours * 60 * 60 * 1000;
};

const needsArchiveWork = (item, now) => {
  if (!item || !['movie', 'series'].includes(item.type)) return false;
  if (item.type === 'movie') {
    if (item.mediaAuditStatus === 'confirmed-unavailable') return false;
    return !hasUsableMedia(item) || Number(item.mediaLanguageAuditVersion || 0) < MEDIA_LANGUAGE_AUDIT_VERSION;
  }

  if (blockedCoolingDown(item, now)) return false;
  return Boolean(
    item.archiveComplete !== true ||
    item.publicationStatus !== 'published' ||
    Number(item.archivePendingEpisodeCount || 0) > 0 ||
    Number(item.mediaLanguageAuditVersion || 0) < MEDIA_LANGUAGE_AUDIT_VERSION
  );
};

const needsSeriesArchiveWork = (item) => Boolean(
  item?.type === 'series' && (
    item.archiveComplete !== true ||
    item.publicationStatus !== 'published' ||
    Number(item.archivePendingEpisodeCount || 0) > 0 ||
    Number(item.mediaLanguageAuditVersion || 0) < MEDIA_LANGUAGE_AUDIT_VERSION
  )
);

const clearArchiveLocks = (state) => {
  state.archiveBackfillItemId = '';
  state.archiveBackfillItemType = '';
  state.archiveBackfillItemTitle = '';
  state.archiveBackfillSeriesId = '';
  state.archiveBackfillSeriesTitle = '';
};

const catalog = await readJson(catalogPath, { items: [] });
const state = await readJson(statePath, {});
const items = Array.isArray(catalog?.items) ? catalog.items.filter(Boolean) : [];
const now = Date.now();
// BACKFILL is series-first. Movie media repair has its own NORMAL lane and
// must not influence which series owns the archive lock.
const candidates = items.filter((item) => needsSeriesArchiveWork(item));
const oldestYear = candidates.length ? Math.min(...candidates.map(yearOf)) : null;

const activeId = String(state.archiveBackfillItemId || state.archiveBackfillSeriesId || '');
const activeType = String(state.archiveBackfillItemType || (state.archiveBackfillSeriesId ? 'series' : ''));
const active = activeId
  ? items.find((item) => String(item?.id || '') === activeId && (!activeType || item?.type === activeType))
  : null;
const noProgressRuns = activeId
  ? Number(state.archiveBackfillNoProgress?.[activeId] || 0)
  : 0;

// A selected series owns the cursor until it is genuinely complete. Neither
// repeated source failures nor the discovery of an older item may silently
// move the queue to another incomplete series.
const stale = Boolean(
  activeId && (
    !active ||
    active.type !== 'series' ||
    !needsSeriesArchiveWork(active)
  )
);

if (stale) {
  const activeYear = active ? yearOf(active) : null;
  clearArchiveLocks(state);
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  console.log(`Archive cursor released: active=${activeId || '-'} year=${activeYear ?? '-'} oldest=${oldestYear ?? '-'} noProgress=${noProgressRuns}`);
} else {
  console.log(`Archive cursor ready: active=${activeId || '-'} oldest=${oldestYear ?? '-'} noProgress=${noProgressRuns}`);
}

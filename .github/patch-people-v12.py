from pathlib import Path
import subprocess

BAD_COMMIT = "f25ebc56923360d6116c908f441888b974763301"
BASE_REF = f"{BAD_COMMIT}^"
sync_path = Path("scripts/sync-upera.mjs")

last_source_commit = subprocess.check_output(
    ["git", "log", "-1", "--format=%H", "--", str(sync_path)],
    text=True,
).strip()
if last_source_commit != BAD_COMMIT:
    raise SystemExit(
        f"sync source moved after audited commit: {last_source_commit}; refusing to overwrite newer source"
    )

text = subprocess.check_output(
    ["git", "show", f"{BASE_REF}:{sync_path}"],
    text=True,
)

old_select = """  const start = options.preferRecent ? 0 : state.peopleEnrichmentOffset % candidates.length;
  const selected = Array.from(
    { length: Math.min(maxTitles, candidates.length) },
    (_, index) => candidates[(start + index) % candidates.length],
  );

  let visited = 0;
  for (const item of selected) {
    if (runTimeBudgetReached('people-enrichment', 45000)) break;
    visited += 1;
    stats.peopleEnrichmentProcessed += 1;
"""
new_select = """  // Keep newly added titles with no people metadata from waiting behind a long
  // historical cursor, while still reserving half of every run for rotating
  // backlog repair. This is generic queue policy; no title is hard-coded.
  const priorityTake = options.preferRecent
    ? 0
    : Math.min(maxTitles, Math.max(1, Math.ceil(maxTitles / 2)));
  const priorityCandidates = options.preferRecent
    ? []
    : candidates
        .filter((item) =>
          (!Array.isArray(item.people) || item.people.length === 0) &&
          !cleanText(item.peopleEnrichmentCheckedAt),
        )
        .slice(0, priorityTake);
  const prioritySet = new Set(priorityCandidates);
  const rotatingCandidates = options.preferRecent
    ? candidates
    : candidates.filter((item) => !prioritySet.has(item));
  const start = options.preferRecent
    ? 0
    : rotatingCandidates.length
      ? state.peopleEnrichmentOffset % rotatingCandidates.length
      : 0;
  const selected = options.preferRecent
    ? candidates.slice(0, Math.min(maxTitles, candidates.length))
    : [...priorityCandidates];
  if (!options.preferRecent && rotatingCandidates.length > 0) {
    const remaining = Math.max(0, maxTitles - selected.length);
    for (let index = 0; index < Math.min(remaining, rotatingCandidates.length); index += 1) {
      selected.push(rotatingCandidates[(start + index) % rotatingCandidates.length]);
    }
  }

  let visited = 0;
  let rotatingVisited = 0;
  for (const item of selected) {
    if (runTimeBudgetReached('people-enrichment', 45000)) break;
    visited += 1;
    if (!options.preferRecent && !prioritySet.has(item)) rotatingVisited += 1;
    stats.peopleEnrichmentProcessed += 1;
"""
if text.count(old_select) != 1:
    raise SystemExit(f"people selection block mismatch in audited base: {text.count(old_select)}")
text = text.replace(old_select, new_select, 1)

old_offset = """  state.peopleEnrichmentOffset = candidates.length
    ? (start + visited) % candidates.length
    : 0;
  state.lastPeopleEnrichmentAt = new Date().toISOString();
"""
new_offset = """  if (!options.preferRecent && rotatingCandidates.length > 0 && rotatingVisited > 0) {
    state.peopleEnrichmentOffset =
      (start + rotatingVisited) % rotatingCandidates.length;
  } else if (!options.preferRecent && rotatingCandidates.length === 0) {
    state.peopleEnrichmentOffset = 0;
  }
  state.lastPeopleEnrichmentAt = new Date().toISOString();
"""
if text.count(old_offset) != 1:
    raise SystemExit(f"people offset block mismatch in audited base: {text.count(old_offset)}")
text = text.replace(old_offset, new_offset, 1)

old_people_mode = """if (effectiveSyncMode === 'PEOPLE') {
  // Fill episode artwork first so this user-visible repair cannot be starved
  // by slower external cast lookups. Remaining time continues cast enrichment.
  await syncEpisodeArtworkMetadata();
  if (!runTimeBudgetReached('before-people-metadata', 60000)) {
    await syncPeopleMetadata();
  }
} else if (effectiveSyncMode === 'IRANIAN') {"""
new_people_mode = """if (effectiveSyncMode === 'PEOPLE') {
  // PEOPLE mode exists primarily to repair cast/director metadata. Do that first
  // so a large episode-artwork queue cannot consume the entire run budget.
  await syncPeopleMetadata();
  if (!runTimeBudgetReached('before-episode-artwork-metadata', 60000)) {
    await syncEpisodeArtworkMetadata();
  }
} else if (effectiveSyncMode === 'IRANIAN') {"""
if text.count(old_people_mode) != 1:
    raise SystemExit(f"PEOPLE mode prefix mismatch in audited base: {text.count(old_people_mode)}")
text = text.replace(old_people_mode, new_people_mode, 1)

for required in (
    "} else if (effectiveSyncMode === 'IRANIAN') {",
    "} else if (effectiveSyncMode === 'BACKFILL') {",
    "await syncSequentialArchiveBackfill();",
    "syncRecentMovieDiscovery,",
    "syncRecentSeriesDiscovery,",
    "syncIncompleteMovieMedia,",
    "syncMovieArchive,",
    "syncSeriesArchive,",
    "syncIranianSeriesArchive,",
):
    if required not in text:
        raise SystemExit(f"required sync branch missing after repair: {required}")

sync_path.write_text(text)

from pathlib import Path

sync_path = Path("scripts/sync-upera.mjs")
text = sync_path.read_text()

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
    raise SystemExit(f"people selection block mismatch: {text.count(old_select)}")
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
    raise SystemExit(f"people offset block mismatch: {text.count(old_offset)}")
text = text.replace(old_offset, new_offset, 1)

mode_start = text.find("if (effectiveSyncMode === 'PEOPLE') {")
if mode_start < 0:
    raise SystemExit("PEOPLE mode start not found")
mode_end = text.find("\n}\n", mode_start)
if mode_end < 0:
    raise SystemExit("PEOPLE mode end not found")
mode_end += 3
old_mode = text[mode_start:mode_end]
if "await syncEpisodeArtworkMetadata();" not in old_mode or "await syncPeopleMetadata();" not in old_mode:
    raise SystemExit("PEOPLE mode expected calls missing")
if old_mode.index("await syncEpisodeArtworkMetadata();") > old_mode.index("await syncPeopleMetadata();"):
    raise SystemExit("PEOPLE mode already people-first; refusing unexpected re-patch")
new_mode = """if (effectiveSyncMode === 'PEOPLE') {
  // PEOPLE mode exists primarily to repair cast/director metadata. Do that first
  // so a large episode-artwork queue cannot consume the entire run budget.
  await syncPeopleMetadata();
  if (!runTimeBudgetReached('before-episode-artwork-metadata', 60000)) {
    await syncEpisodeArtworkMetadata();
  }
}
"""
text = text[:mode_start] + new_mode + text[mode_end:]
sync_path.write_text(text)

workflow_path = Path(".github/workflows/enrich-tmdb-cast.yml")
workflow = workflow_path.read_text()
old_add = "git add catalog.json sync-report-min.json sync-report.json catalog-index.json catalog-items catalog-manifest.json"
new_add = "git add catalog.json catalog-index.json catalog-items catalog-stable catalog-manifest.json catalog-bootstrap.json tmdb-cache.json tmdb-enrichment-report.json sync-report-min.json sync-report.json"
if workflow.count(old_add) != 1:
    raise SystemExit(f"TMDB git add mismatch: {workflow.count(old_add)}")
workflow = workflow.replace(old_add, new_add, 1)
workflow_path.write_text(workflow)

from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)

script_path = Path('scripts/client-catalog.mjs')
text = script_path.read_text(encoding='utf-8')

old = """  if (item?.type === 'movie') {
    const downloads = compactBootstrapMovieActionPreview(item.downloads);
    if (downloads.length) compact.downloads = downloads;
    if (/^https?:\\/\\//i.test(String(item.streamUrl || '').trim())) compact.streamUrl = item.streamUrl;
    if (item.streamMode) compact.streamMode = item.streamMode;
  }
  return compact;
};
"""
new = """  if (item?.type === 'movie') {
    const downloads = compactBootstrapMovieActionPreview(item.downloads);
    if (downloads.length) compact.downloads = downloads;
    if (/^https?:\\/\\//i.test(String(item.streamUrl || '').trim())) compact.streamUrl = item.streamUrl;
    if (item.streamMode) compact.streamMode = item.streamMode;
  } else if (item?.type === 'series' && Array.isArray(item.downloads) && item.downloads.length) {
    // The client index already reduced every episode to at most two real action
    // files. Reuse that bounded preview in bootstrap so a fresh install can
    // render the episode list immediately without waiting for the 10+ MB index
    // or a per-title detail shard.
    compact.downloads = item.downloads;
  }
  return compact;
};
"""
text = replace_once(text, old, new, 'bootstrap compact series previews')

old = """  const bootstrapItems = items.map((item) => {
    if (!richHomeIds.has(String(item?.id || ''))) return compactBootstrapNavigationItem(item);
    if (item?.type !== 'series' || !Array.isArray(item.downloads)) return item;
    const { downloads: _episodePreviews, ...withoutEpisodePreviews } = item;
    return withoutEpisodePreviews;
  });
"""
new = """  const bootstrapItems = items.map((item) =>
    richHomeIds.has(String(item?.id || '')) ? item : compactBootstrapNavigationItem(item)
  );
"""
text = replace_once(text, old, new, 'keep rich-home series previews')
script_path.write_text(text, encoding='utf-8')

test_path = Path('scripts/tests/client-catalog.test.mjs')
test = test_path.read_text(encoding='utf-8')
test = replace_once(
    test,
    "test('series summary keeps every episode coordinate with at most two actionable preview files and bootstrap strips them', () => {",
    "test('series summary and bootstrap keep every episode coordinate with bounded actionable previews', () => {",
    'series preview test title',
)
test = replace_once(
    test,
    "  assert.equal('downloads' in artifacts.bootstrap.items[0], false, 'bootstrap must stay navigation-light for series');",
    "  const bootstrapSummary = artifacts.bootstrap.items[0];\n  assert.deepEqual(bootstrapSummary.downloads.map((section) => section.episodeNumber), [1, 2, 3]);\n  assert.ok(bootstrapSummary.downloads.every((section) => section.files.length > 0 && section.files.length <= 2));\n  assert.ok(bootstrapSummary.downloads.flatMap((section) => section.files).every((file) => sourceUrls.has(file.url)));",
    'bootstrap preview assertion',
)
test_path.write_text(test, encoding='utf-8')

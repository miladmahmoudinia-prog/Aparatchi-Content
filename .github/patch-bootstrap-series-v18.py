from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)

script_path = Path('scripts/client-catalog.mjs')
text = script_path.read_text(encoding='utf-8')

movie_anchor = """const compactBootstrapMovieActionPreview = (downloads) => {
  const sections = Array.isArray(downloads) ? downloads : [];
  const candidates = sections.flatMap((section) =>
    (Array.isArray(section?.files) ? section.files : []).map((file) => ({ section, file })),
  );
  const isDownload = ({ file }) => ['download', 'operator-download'].includes(String(file?.mode || 'download'));
  const isPlayable = ({ file }) => ['play', 'operator-play'].includes(String(file?.mode || '')) || /\\.(?:m3u8|mp4)(?:$|[?#])/i.test(String(file?.url || ''));
  const download = candidates.find(isDownload);
  const play = candidates.find(isPlayable);
  const chosen = [];
  if (download) chosen.push(download);
  if (play && (!download || !isPlayable(download)) && play.file?.url !== download?.file?.url) chosen.push(play);
  if (!chosen.length && play) chosen.push(play);
  if (!chosen.length) return [];
  const groups = new Map();
  for (const choice of chosen.slice(0, 2)) {
    const section = choice.section || {};
    const key = String(section.id || section.language || section.title || 'media');
    const current = groups.get(key) || {
      ...(section.id ? { id: section.id } : {}),
      ...(section.language ? { language: section.language } : {}),
      files: [],
    };
    current.files.push(compactBootstrapMovieFile(choice.file));
    groups.set(key, current);
  }
  return [...groups.values()];
};
"""
series_helper = movie_anchor + """

const compactBootstrapSeriesEpisodePreviews = (downloads) =>
  (Array.isArray(downloads) ? downloads : []).flatMap((section) => {
    const episodeNumber = Number(section?.episodeNumber || 0);
    const files = Array.isArray(section?.files) ? section.files : [];
    if (!(episodeNumber > 0) || !files.length) return [];

    // Full index already limits each episode to at most two truthful action
    // files. Bootstrap needs only the coordinates and fields Mobile requires to
    // normalize/open those actions. Drop ids/labels/quality/timestamps here to
    // keep first-install transport below the historical 5 MB safety cap.
    const compactFiles = files.slice(0, 2).flatMap((file) => {
      const url = String(file?.url || '').trim();
      if (!/^https?:\\/\\//i.test(url)) return [];
      return [{
        url,
        ...(file?.mode ? { mode: file.mode } : {}),
        ...(file?.language ? { language: file.language } : {}),
        ...(Array.isArray(file?.supportedOperators) && file.supportedOperators.length
          ? { supportedOperators: file.supportedOperators }
          : {}),
      }];
    });
    if (!compactFiles.length) return [];
    return [{
      episodeNumber,
      ...(Number(section?.seasonNumber || 0) > 1 ? { seasonNumber: Number(section.seasonNumber) } : {}),
      ...(section?.artwork ? { artwork: section.artwork } : {}),
      files: compactFiles,
    }];
  });
"""
text = replace_once(text, movie_anchor, series_helper, 'bootstrap series helper anchor')

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
  } else if (item?.type === 'series') {
    const downloads = compactBootstrapSeriesEpisodePreviews(item.downloads);
    if (downloads.length) compact.downloads = downloads;
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
new = """  const bootstrapItems = items.map((item) => {
    if (!richHomeIds.has(String(item?.id || ''))) return compactBootstrapNavigationItem(item);
    if (item?.type !== 'series') return item;
    const downloads = compactBootstrapSeriesEpisodePreviews(item.downloads);
    return downloads.length ? { ...item, downloads } : item;
  });
"""
text = replace_once(text, old, new, 'keep compact rich-home series previews')
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
    "  const bootstrapSummary = artifacts.bootstrap.items[0];\n  assert.deepEqual(bootstrapSummary.downloads.map((section) => section.episodeNumber), [1, 2, 3]);\n  assert.ok(bootstrapSummary.downloads.every((section) => section.files.length > 0 && section.files.length <= 2));\n  assert.ok(bootstrapSummary.downloads.flatMap((section) => section.files).every((file) => sourceUrls.has(file.url)));\n  assert.ok(bootstrapSummary.downloads.flatMap((section) => section.files).every((file) => !('quality' in file) && !('id' in file)));",
    'bootstrap preview assertion',
)
test_path.write_text(test, encoding='utf-8')

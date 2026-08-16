from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label} mismatch: expected 1, got {count}')
    return text.replace(old, new, 1)

path = Path('scripts/client-catalog.mjs')
text = path.read_text(encoding='utf-8')

anchor = """const compactMovieDownloadsForSummary = (downloads) => (Array.isArray(downloads) ? downloads : []).flatMap((section) => {
  const files = (Array.isArray(section?.files) ? section.files : [])
    .filter(clientSeriesFileIsUsable)
    .map((file) => {
      const compact = {};
      for (const key of ['id', 'label', 'quality', 'size', 'url', 'mode', 'language', 'operatorOnly', 'panelVerified', 'trafficOo']) {
        if (file?.[key] !== undefined && file?.[key] !== null && file?.[key] !== '') compact[key] = file[key];
      }
      return compact;
    });
  if (!files.length) return [];
  const compactSection = { files };
  for (const key of ['id', 'title', 'badge', 'language']) {
    if (section?.[key] !== undefined && section?.[key] !== null && section?.[key] !== '') compactSection[key] = section[key];
  }
  return [compactSection];
});
"""
addition = anchor + """
const compactSeriesEpisodeDownloadsForSummary = (downloads) => (Array.isArray(downloads) ? downloads : []).flatMap((section) => {
  const episodeNumber = Number(section?.episodeNumber || 0);
  if (!(episodeNumber > 0)) return [];
  const usable = (Array.isArray(section?.files) ? section.files : []).filter(clientSeriesFileIsUsable);
  if (!usable.length) return [];

  const isDownload = (file) => ['download', 'operator-download'].includes(String(file?.mode || 'download'));
  const isPlayable = (file) =>
    ['play', 'operator-play'].includes(String(file?.mode || '')) ||
    /\\.(?:m3u8|mp4)(?:$|[?#])/i.test(String(file?.url || ''));
  const download = usable.find(isDownload) || usable[0];
  const play = usable.find(isPlayable);
  const chosen = [download];
  if (play && play?.url !== download?.url) chosen.push(play);

  const files = chosen.slice(0, 2).map((file) => {
    const compact = {};
    for (const key of ['id', 'label', 'quality', 'size', 'url', 'mode', 'language', 'operatorOnly', 'panelVerified', 'trafficOo', 'supportedOperators']) {
      if (file?.[key] !== undefined && file?.[key] !== null && file?.[key] !== '') compact[key] = file[key];
    }
    return compact;
  });
  const compactSection = { files, episodeNumber };
  for (const key of ['id', 'title', 'subtitle', 'badge', 'artwork', 'language', 'sourceEpisodeId', 'seasonNumber', 'sourceUpdatedAt']) {
    if (section?.[key] !== undefined && section?.[key] !== null && section?.[key] !== '') compactSection[key] = section[key];
  }
  return [compactSection];
});
"""
text = replace_once(text, anchor, addition, 'series preview helper anchor')

old = """  if (item?.type === 'movie') {
    const compactDownloads = compactMovieDownloadsForSummary(item.downloads);
    if (compactDownloads.length) summary.downloads = compactDownloads;
    if (item.ir === true && /^https?:\\/\\//i.test(String(item.streamUrl || '').trim())) {
      summary.streamUrl = item.streamUrl;
      if (item.streamMode) summary.streamMode = item.streamMode;
    }
  }
"""
new = """  if (item?.type === 'movie') {
    const compactDownloads = compactMovieDownloadsForSummary(item.downloads);
    if (compactDownloads.length) summary.downloads = compactDownloads;
    if (item.ir === true && /^https?:\\/\\//i.test(String(item.streamUrl || '').trim())) {
      summary.streamUrl = item.streamUrl;
      if (item.streamMode) summary.streamMode = item.streamMode;
    }
  } else if (item?.type === 'series') {
    const episodePreviews = compactSeriesEpisodeDownloadsForSummary(item.downloads);
    if (episodePreviews.length) summary.downloads = episodePreviews;
  }
"""
text = replace_once(text, old, new, 'series summary media branch')

old = """  const bootstrapItems = items.map((item) =>
    richHomeIds.has(String(item?.id || '')) ? item : compactBootstrapNavigationItem(item)
  );
"""
new = """  const bootstrapItems = items.map((item) => {
    if (!richHomeIds.has(String(item?.id || ''))) return compactBootstrapNavigationItem(item);
    if (item?.type !== 'series' || !Array.isArray(item.downloads)) return item;
    const { downloads: _episodePreviews, ...withoutEpisodePreviews } = item;
    return withoutEpisodePreviews;
  });
"""
text = replace_once(text, old, new, 'bootstrap series preview stripping')
path.write_text(text, encoding='utf-8')

# Update the focused client-catalog tests to match the bounded episode preview contract.
test_path = Path('scripts/tests/client-catalog.test.mjs')
test = test_path.read_text(encoding='utf-8')
test = replace_once(
    test,
    "test('client item summary strips heavy media and duplicated cast identities', () => {",
    "test('client item summary keeps bounded episode action previews but strips duplicated cast identities', () => {",
    'test title',
)
test = replace_once(
    test,
    "    downloads: [{ id: 'e1', seasonNumber: 1, episodeNumber: 1, files: [{ id: 'f1', url: 'https://example.test/a.mp4' }] }],",
    "    downloads: [{ id: 'e1', seasonNumber: 1, episodeNumber: 1, files: [{ id: 'f1', mode: 'download', quality: '720p', url: 'https://example.test/a.mp4' }] }],",
    'test episode media',
)
test = replace_once(
    test,
    "  assert.equal('downloads' in summary, false);\n  assert.equal('people' in summary, false);",
    "  assert.equal(summary.downloads?.length, 1);\n  assert.equal(summary.downloads?.[0]?.episodeNumber, 1);\n  assert.equal(summary.downloads?.[0]?.files?.length, 1);\n  assert.equal('people' in summary, false);",
    'summary preview assertion',
)

append = """

test('series summary keeps every episode coordinate with at most two actionable preview files and bootstrap strips them', () => {
  const episode = (number) => ({
    id: `e${number}`,
    title: `قسمت ${number}`,
    seasonNumber: 1,
    episodeNumber: number,
    sourceEpisodeId: `source-${number}`,
    files: [
      { id: `d${number}-1080`, mode: 'download', quality: '1080p', url: `https://cdn.test/${number}/1080.mp4` },
      { id: `d${number}-720`, mode: 'download', quality: '720p', url: `https://cdn.test/${number}/720.mp4` },
      { id: `p${number}`, mode: 'play', quality: 'پخش', url: `https://cdn.test/${number}/master.m3u8` },
    ],
  });
  const catalog = {
    version: 'preview-test', updatedAt: '2026-01-01T00:00:00Z',
    items: [{
      id: 'series-preview', type: 'series', nameFa: 'نمونه سریال', name: 'Series Preview',
      publicationStatus: 'published', archiveComplete: true,
      downloads: [episode(1), episode(2), episode(3)],
    }],
  };
  const artifacts = buildClientCatalogArtifacts(catalog);
  const summary = artifacts.index.items[0];
  assert.deepEqual(summary.downloads.map((section) => section.episodeNumber), [1, 2, 3]);
  assert.ok(summary.downloads.every((section) => section.files.length > 0 && section.files.length <= 2));
  assert.deepEqual(summary.downloads.map((section) => section.sourceEpisodeId), ['source-1', 'source-2', 'source-3']);
  const sourceUrls = new Set(catalog.items[0].downloads.flatMap((section) => section.files.map((file) => file.url)));
  assert.ok(summary.downloads.flatMap((section) => section.files).every((file) => sourceUrls.has(file.url)));
  assert.equal('downloads' in artifacts.bootstrap.items[0], false, 'bootstrap must stay navigation-light for series');
  const detail = JSON.parse(artifacts.detailFiles[0].serialized);
  assert.equal(detail.downloads.flatMap((section) => section.files).length, 9, 'detail shard keeps every quality');
});
"""
if "series summary keeps every episode coordinate" in test:
    raise SystemExit('preview test already exists')
test += append
test_path.write_text(test, encoding='utf-8')

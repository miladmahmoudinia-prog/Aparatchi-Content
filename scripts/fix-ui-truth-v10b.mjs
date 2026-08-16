import fs from 'node:fs/promises';

async function rewrite(path, fn) {
  const before = await fs.readFile(path, 'utf8');
  const after = fn(before);
  if (after === before) console.log(`${path}: unchanged`);
  else { await fs.writeFile(path, after, 'utf8'); console.log(`${path}: updated`); }
}

const replaceExact = (source, from, to, label) => {
  if (source.includes(to)) return source;
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  return source.replace(from, to);
};

await rewrite('scripts/persian-title-overrides.mjs', (source) => {
  if (source.includes("['twisted metal', 'فلز درهم‌تنیده']")) return source;
  return replaceExact(source, 'const VERIFIED_PERSIAN_TITLE_ENTRIES = [\n', "const VERIFIED_PERSIAN_TITLE_ENTRIES = [\n  ['twisted metal', 'فلز درهم‌تنیده'],\n", 'Twisted Metal override');
});

await rewrite('scripts/client-catalog.mjs', (source) => {
  if (source.includes('const compactBootstrapMovieActionPreview = (downloads) =>')) return source;
  const old = `const compactBootstrapNavigationItem = (item) => {\n  const compact = {};\n  for (const field of BOOTSTRAP_NAVIGATION_FIELDS) {\n    if (Object.prototype.hasOwnProperty.call(item || {}, field)) compact[field] = item[field];\n  }\n  return compact;\n};`;
  const next = `const compactBootstrapMovieFile = (file) => ({\n  ...(file?.id ? { id: file.id } : {}),\n  ...(file?.quality ? { quality: file.quality } : {}),\n  ...(file?.label ? { label: file.label } : {}),\n  url: file.url,\n  mode: file.mode,\n  ...(file?.language ? { language: file.language } : {}),\n  ...(file?.operatorOnly ? { operatorOnly: true } : {}),\n  ...(file?.panelVerified ? { panelVerified: true } : {}),\n  ...(file?.trafficOo != null ? { trafficOo: file.trafficOo } : {}),\n});\n\nconst compactBootstrapMovieActionPreview = (downloads) => {\n  const sections = Array.isArray(downloads) ? downloads : [];\n  const candidates = sections.flatMap((section) =>\n    (Array.isArray(section?.files) ? section.files : []).map((file) => ({ section, file })),\n  );\n  const isDownload = ({ file }) => ['download', 'operator-download'].includes(String(file?.mode || 'download'));\n  const isPlayable = ({ file }) => ['play', 'operator-play'].includes(String(file?.mode || '')) || /\\.(?:m3u8|mp4)(?:$|[?#])/i.test(String(file?.url || ''));\n  const download = candidates.find(isDownload);\n  const play = candidates.find(isPlayable);\n  const chosen = [];\n  if (download) chosen.push(download);\n  if (play && (!download || !isPlayable(download)) && play.file?.url !== download?.file?.url) chosen.push(play);\n  if (!chosen.length && play) chosen.push(play);\n  if (!chosen.length) return [];\n  const groups = new Map();\n  for (const choice of chosen.slice(0, 2)) {\n    const section = choice.section || {};\n    const key = String(section.id || section.language || section.title || 'media');\n    const current = groups.get(key) || {\n      ...(section.id ? { id: section.id } : {}),\n      ...(section.title ? { title: section.title } : {}),\n      ...(section.badge ? { badge: section.badge } : {}),\n      ...(section.language ? { language: section.language } : {}),\n      files: [],\n    };\n    current.files.push(compactBootstrapMovieFile(choice.file));\n    groups.set(key, current);\n  }\n  return [...groups.values()];\n};\n\nconst compactBootstrapNavigationItem = (item) => {\n  const compact = {};\n  for (const field of BOOTSTRAP_NAVIGATION_FIELDS) {\n    if (Object.prototype.hasOwnProperty.call(item || {}, field)) compact[field] = item[field];\n  }\n  if (item?.type === 'movie') {\n    const downloads = compactBootstrapMovieActionPreview(item.downloads);\n    if (downloads.length) compact.downloads = downloads;\n    if (/^https?:\\/\\//i.test(String(item.streamUrl || '').trim())) compact.streamUrl = item.streamUrl;\n    if (item.streamMode) compact.streamMode = item.streamMode;\n  }\n  return compact;\n};`;
  return replaceExact(source, old, next, 'bootstrap movie preview');
});

await rewrite('scripts/sync-upera.mjs', (source) => {
  if (source.includes("'ffprobe',\n        ['-v', 'error', '-show_entries', 'format=duration'")) return source;
  const old = `    await execFileAsync(\n      'ffmpeg',\n      [\n        '-hide_banner',\n        '-loglevel', 'error',\n        '-ss', String(45 + ((Number(group?.episodeNumber || 1) * 37) % 210)),\n        '-i', source,`;
  const next = `    let seekSeconds = 120;\n    try {\n      const probe = await execFileAsync(\n        'ffprobe',\n        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', source],\n        { timeout: Math.min(requestTimeoutMs, 12000), maxBuffer: 1024 * 1024 },\n      );\n      const duration = Number(String(probe?.stdout || '').trim());\n      if (Number.isFinite(duration) && duration > 20) seekSeconds = Math.max(10, Math.round(duration * 0.5));\n    } catch {\n      seekSeconds = 90 + ((Number(group?.episodeNumber || 1) * 17) % 90);\n    }\n\n    await execFileAsync(\n      'ffmpeg',\n      [\n        '-hide_banner',\n        '-loglevel', 'error',\n        '-ss', String(seekSeconds),\n        '-i', source,`;
  return replaceExact(source, old, next, 'episode midpoint frame');
});

await rewrite('.github/workflows/sync-upera.yml', (source) => {
  let next = source;
  const pairs = [
    ["          APARATCHI_RUN_TIME_LIMIT_MINUTES: '6'", "          APARATCHI_RUN_TIME_LIMIT_MINUTES: '12'"],
    ["          APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '24'", "          APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '120'"],
    ["          APARATCHI_EPISODE_ARTWORK_MIRROR_PER_RUN: '36'", "          APARATCHI_EPISODE_ARTWORK_MIRROR_PER_RUN: '0'"],
    ["          APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN: '36'", "          APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN: '160'"],
  ];
  for (const [from, to] of pairs) if (!next.includes(to)) next = replaceExact(next, from, to, `workflow ${to.trim()}`);
  return next;
});

await rewrite('scripts/tests/current-media-truth.test.mjs', (source) => {
  if (source.includes('same URL with contradictory languages survives once as neutral media')) return source;
  const old = `test('same URL cannot appear as both dubbed and subtitled', () => {\n  const item = foreign({ downloads: [{ id: 'mixed', files: [\n    { id: 'dub-file', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'dubbed' },\n    { id: 'sub-file', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'subtitled' },\n  ]}] });\n  const { index } = buildClientCatalogArtifacts({ items: [item] });\n  assert.equal(index.items.length, 0);\n});`;
  const next = `test('same URL with contradictory languages survives once as neutral media', () => {\n  const item = foreign({ downloads: [{ id: 'mixed', files: [\n    { id: 'dub-file', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'dubbed' },\n    { id: 'sub-file', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'subtitled' },\n  ]}] });\n  const { index, detailFiles } = buildClientCatalogArtifacts({ items: [item] });\n  assert.equal(index.items.length, 1);\n  assert.deepEqual(index.items[0].availableLanguages, []);\n  const detail = JSON.parse(detailFiles[0].serialized);\n  const files = detail.downloads.flatMap((section) => section.files || []);\n  assert.equal(files.filter((file) => file.url === 'https://cdn.test/same.mp4').length, 1);\n});`;
  return replaceExact(source, old, next, 'current neutral conflict test');
});

await rewrite('scripts/tests/final-user-batch-20260814.test.mjs', (source) => {
  if (source.includes('one contradictory URL becomes one neutral playable choice')) return source;
  const old = `test('one URL cannot create both dubbed and subtitled choices', () => {\n  const item = base({ downloads: [{ id: 's', files: [\n    { id: 'd', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'dubbed' },\n    { id: 'u', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'subtitled' },\n  ]}] });\n  const { index } = buildClientCatalogArtifacts({ items: [item] });\n  assert.equal(index.items.length, 0);\n});`;
  const next = `test('one contradictory URL becomes one neutral playable choice', () => {\n  const item = base({ downloads: [{ id: 's', files: [\n    { id: 'd', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'dubbed' },\n    { id: 'u', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'subtitled' },\n  ]}] });\n  const { index, detailFiles } = buildClientCatalogArtifacts({ items: [item] });\n  assert.equal(index.items.length, 1);\n  assert.deepEqual(index.items[0].availableLanguages, []);\n  const detail = JSON.parse(detailFiles[0].serialized);\n  const files = detail.downloads.flatMap((section) => section.files || []);\n  assert.equal(files.filter((file) => file.url === 'https://cdn.test/same.mp4').length, 1);\n});`;
  return replaceExact(source, old, next, 'final neutral conflict test');
});

await rewrite('scripts/tests/mock-sync-fetch.mjs', (source) => {
  let next = source;
  if (!next.includes("const detailDubbed = scenario !== 'paid-movie'")) {
    const languageStart = next.indexOf("  if ([\n    'paid-movie',\n    'dubbed-movie',");
    const anchor = `    if (url.pathname.endsWith('/ghost/get/series/sort')) {\n      return jsonResponse({ status: 'success', data: { series: { data: [], last_page: 1 } } });\n    }`;
    const at = languageStart >= 0 ? next.indexOf(anchor, languageStart) : -1;
    if (at < 0) throw new Error('language mock anchor missing');
    const addition = `    if (url.pathname.endsWith(\`/ghost/get/movie/\${movieId}\`)) {\n      const detailDubbed = scenario !== 'paid-movie' && scenario !== 'mixed-language-price';\n      return jsonResponse({ status: 'success', data: { movie: { id: movieId, type: 'movie', name: 'Media Movie', name_fa: 'فیلم رسانه', year: 2026, poster: \`https://example.test/\${movieId}-poster.jpg\`, backdrop: \`https://example.test/\${movieId}-backdrop.jpg\`, dubbed: detailDubbed ? 1 : 0 } } });\n    }\n\n`;
    next = next.slice(0, at) + addition + next.slice(at);
  }
  if (!next.includes("url.pathname.match(/\\/ghost\\/get\\/movie\\/(old-movie|new-movie)$/)")) {
    const affiliateAnchor = "  if ((scenario === 'year-order' || scenario === 'year-order-zero-media') && url.pathname.endsWith('/ghost/get/getaffiliatelinks')) {";
    const at = next.indexOf(affiliateAnchor);
    if (at < 0) throw new Error('year-order affiliate anchor missing');
    const addition = `  if ((scenario === 'year-order' || scenario === 'year-order-zero-media') && url.pathname.match(/\\/ghost\\/get\\/movie\\/(old-movie|new-movie)$/)) {\n    const id = url.pathname.endsWith('/old-movie') ? 'old-movie' : 'new-movie';\n    return jsonResponse({ status: 'success', data: { movie: { id, type: 'movie', name: id === 'old-movie' ? 'Old Movie' : 'New Movie', name_fa: id === 'old-movie' ? 'فیلم قدیمی' : 'فیلم جدید', year: id === 'old-movie' ? 2015 : 2016, poster: \`https://example.test/\${id}.jpg\`, backdrop: \`https://example.test/\${id}-bg.jpg\`, dubbed: 0 } } });\n  }\n\n`;
    next = next.slice(0, at) + addition + next.slice(at);
  }
  return next;
});

await rewrite('scripts/tests/ui-truth-v10.test.mjs', (source) => source.replace(
  "assert.ok(files.length > 0 && files.length <= Math.max(2, item.downloads.length * 2));",
  "assert.ok(files.length > 0 && files.length <= 2, 'bootstrap keeps at most two immediate action files per movie');",
));

console.log('UI truth v10b patch ready');

import fs from 'node:fs/promises';

async function patch(path, transform) {
  const before = await fs.readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) console.log(`${path}: already current or no change`);
  else {
    await fs.writeFile(path, after, 'utf8');
    console.log(`${path}: patched`);
  }
}

const replaceOnce = (source, from, to, label) => {
  if (source.includes(to)) return source;
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(from, to);
};

await patch('scripts/persian-title-overrides.mjs', (source) => {
  if (source.includes("['twisted metal', 'فلز درهم‌تنیده']")) return source;
  return replaceOnce(
    source,
    "const VERIFIED_PERSIAN_TITLE_ENTRIES = [\n",
    "const VERIFIED_PERSIAN_TITLE_ENTRIES = [\n  ['twisted metal', 'فلز درهم‌تنیده'],\n",
    'Twisted Metal verified Persian title',
  );
});

await patch('scripts/client-catalog.mjs', (source) => {
  if (source.includes('const compactBootstrapMovieActionPreview = (downloads) =>')) return source;
  const oldBlock = `const compactBootstrapNavigationItem = (item) => {\n  const compact = {};\n  for (const field of BOOTSTRAP_NAVIGATION_FIELDS) {\n    if (Object.prototype.hasOwnProperty.call(item || {}, field)) compact[field] = item[field];\n  }\n  return compact;\n};`;
  const newBlock = `const compactBootstrapMovieActionPreview = (downloads) =>\n  (Array.isArray(downloads) ? downloads : []).flatMap((section) => {\n    const files = Array.isArray(section?.files) ? section.files : [];\n    const picked = [];\n    const take = (predicate) => {\n      const file = files.find(predicate);\n      if (!file || picked.some((entry) => entry?.url === file?.url && entry?.mode === file?.mode)) return;\n      picked.push({\n        ...(file.id ? { id: file.id } : {}),\n        ...(file.quality ? { quality: file.quality } : {}),\n        ...(file.label ? { label: file.label } : {}),\n        url: file.url,\n        mode: file.mode,\n        ...(file.language ? { language: file.language } : {}),\n        ...(file.operatorOnly ? { operatorOnly: true } : {}),\n        ...(file.panelVerified ? { panelVerified: true } : {}),\n        ...(file.trafficOo != null ? { trafficOo: file.trafficOo } : {}),\n      });\n    };\n    take((file) => ['play', 'operator-play'].includes(String(file?.mode || '')));\n    take((file) => ['download', 'operator-download'].includes(String(file?.mode || 'download')));\n    if (!picked.length) return [];\n    return [{\n      ...(section.id ? { id: section.id } : {}),\n      ...(section.title ? { title: section.title } : {}),\n      ...(section.badge ? { badge: section.badge } : {}),\n      ...(section.language ? { language: section.language } : {}),\n      files: picked,\n    }];\n  });\n\nconst compactBootstrapNavigationItem = (item) => {\n  const compact = {};\n  for (const field of BOOTSTRAP_NAVIGATION_FIELDS) {\n    if (Object.prototype.hasOwnProperty.call(item || {}, field)) compact[field] = item[field];\n  }\n  if (item?.type === 'movie') {\n    const downloads = compactBootstrapMovieActionPreview(item.downloads);\n    if (downloads.length) compact.downloads = downloads;\n    if (/^https?:\\/\\//i.test(String(item.streamUrl || '').trim())) compact.streamUrl = item.streamUrl;\n    if (item.streamMode) compact.streamMode = item.streamMode;\n  }\n  return compact;\n};`;
  return replaceOnce(source, oldBlock, newBlock, 'bootstrap immediate movie actions');
});

await patch('scripts/sync-upera.mjs', (source) => {
  if (source.includes("'ffprobe',\n        ['-v', 'error', '-show_entries', 'format=duration'")) return source;
  const oldSeek = `    await execFileAsync(\n      'ffmpeg',\n      [\n        '-hide_banner',\n        '-loglevel', 'error',\n        '-ss', String(45 + ((Number(group?.episodeNumber || 1) * 37) % 210)),\n        '-i', source,`;
  const newSeek = `    let seekSeconds = 120;\n    try {\n      const probe = await execFileAsync(\n        'ffprobe',\n        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', source],\n        { timeout: Math.min(requestTimeoutMs, 12000), maxBuffer: 1024 * 1024 },\n      );\n      const duration = Number(String(probe?.stdout || '').trim());\n      if (Number.isFinite(duration) && duration > 20) seekSeconds = Math.max(10, Math.round(duration * 0.5));\n    } catch {\n      seekSeconds = 90 + ((Number(group?.episodeNumber || 1) * 17) % 90);\n    }\n\n    await execFileAsync(\n      'ffmpeg',\n      [\n        '-hide_banner',\n        '-loglevel', 'error',\n        '-ss', String(seekSeconds),\n        '-i', source,`;
  return replaceOnce(source, oldSeek, newSeek, 'middle episode frame');
});

await patch('.github/workflows/sync-upera.yml', (source) => {
  let next = source;
  const changes = [
    ["          APARATCHI_RUN_TIME_LIMIT_MINUTES: '6'", "          APARATCHI_RUN_TIME_LIMIT_MINUTES: '12'", 'episode artwork time budget'],
    ["          APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '24'", "          APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '120'", 'episode artwork series budget'],
    ["          APARATCHI_EPISODE_ARTWORK_MIRROR_PER_RUN: '36'", "          APARATCHI_EPISODE_ARTWORK_MIRROR_PER_RUN: '0'", 'disable untrusted episode mirror'],
    ["          APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN: '36'", "          APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN: '160'", 'episode frame capture budget'],
  ];
  for (const [from, to, label] of changes) {
    if (!next.includes(to)) next = replaceOnce(next, from, to, label);
  }
  return next;
});

await patch('scripts/tests/current-media-truth.test.mjs', (source) => {
  if (source.includes("same URL with contradictory languages survives once as neutral media")) return source;
  const old = `test('same URL cannot appear as both dubbed and subtitled', () => {\n  const item = foreign({ downloads: [{ id: 'mixed', files: [\n    { id: 'dub-file', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'dubbed' },\n    { id: 'sub-file', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'subtitled' },\n  ]}] });\n  const { index } = buildClientCatalogArtifacts({ items: [item] });\n  assert.equal(index.items.length, 0);\n});`;
  const replacement = `test('same URL with contradictory languages survives once as neutral media', () => {\n  const item = foreign({ downloads: [{ id: 'mixed', files: [\n    { id: 'dub-file', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'dubbed' },\n    { id: 'sub-file', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'subtitled' },\n  ]}] });\n  const { index, detailFiles } = buildClientCatalogArtifacts({ items: [item] });\n  assert.equal(index.items.length, 1);\n  assert.deepEqual(index.items[0].availableLanguages, []);\n  const detail = JSON.parse(detailFiles[0].serialized);\n  const files = detail.downloads.flatMap((section) => section.files || []);\n  assert.equal(files.filter((file) => file.url === 'https://cdn.test/same.mp4').length, 1);\n  assert.equal(files[0].language, undefined);\n});`;
  return replaceOnce(source, old, replacement, 'neutral conflict current-media test');
});

await patch('scripts/tests/final-user-batch-20260814.test.mjs', (source) => {
  if (source.includes("one contradictory URL becomes one neutral playable choice")) return source;
  const old = `test('one URL cannot create both dubbed and subtitled choices', () => {\n  const item = base({ downloads: [{ id: 's', files: [\n    { id: 'd', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'dubbed' },\n    { id: 'u', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'subtitled' },\n  ]}] });\n  const { index } = buildClientCatalogArtifacts({ items: [item] });\n  assert.equal(index.items.length, 0);\n});`;
  const replacement = `test('one contradictory URL becomes one neutral playable choice', () => {\n  const item = base({ downloads: [{ id: 's', files: [\n    { id: 'd', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'dubbed' },\n    { id: 'u', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'subtitled' },\n  ]}] });\n  const { index, detailFiles } = buildClientCatalogArtifacts({ items: [item] });\n  assert.equal(index.items.length, 1);\n  assert.deepEqual(index.items[0].availableLanguages, []);\n  const detail = JSON.parse(detailFiles[0].serialized);\n  const files = detail.downloads.flatMap((section) => section.files || []);\n  assert.equal(files.filter((file) => file.url === 'https://cdn.test/same.mp4').length, 1);\n});`;
  return replaceOnce(source, old, replacement, 'neutral conflict final-batch test');
});

await patch('scripts/tests/mock-sync-fetch.mjs', (source) => {
  if (source.includes("const detailDubbed = scenario !== 'paid-movie'")) return source;
  const scenarioMarker = "  if ([\n    'paid-movie',\n    'dubbed-movie',";
  const start = source.indexOf(scenarioMarker);
  if (start < 0) throw new Error('language scenario block not found');
  const anchor = `    if (url.pathname.endsWith('/ghost/get/series/sort')) {\n      return jsonResponse({ status: 'success', data: { series: { data: [], last_page: 1 } } });\n    }`;
  const at = source.indexOf(anchor, start);
  if (at < 0) throw new Error('language scenario series anchor not found');
  const addition = `    if (url.pathname.endsWith(\`/ghost/get/movie/\${movieId}\`)) {\n      const detailDubbed = scenario !== 'paid-movie' && scenario !== 'mixed-language-price';\n      return jsonResponse({\n        status: 'success',\n        data: {\n          movie: {\n            id: movieId,\n            type: 'movie',\n            name: scenario === 'paid-movie' ? 'Paid Movie' : scenario === 'grouped-dubbed-movie' ? 'Grouped Dubbed Movie' : 'Dubbed Media Movie',\n            name_fa: scenario === 'paid-movie' ? 'فیلم خریدنی' : scenario === 'grouped-dubbed-movie' ? 'فیلم دوبله گروهی' : 'فیلم رسانه دوبله',\n            year: 2026,\n            poster: \`https://example.test/\${movieId}-poster.jpg\`,\n            backdrop: \`https://example.test/\${movieId}-backdrop.jpg\`,\n            overview: 'Media parsing regression fixture',\n            dubbed: detailDubbed ? 1 : 0,\n          },\n        },\n      });\n    }\n\n`;
  return source.slice(0, at) + addition + source.slice(at);
});

console.log('Prepared Content UI truth v10 patch');

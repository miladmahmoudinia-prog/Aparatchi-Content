import fs from 'node:fs';

const target = 'scripts/client-catalog.mjs';
let source = fs.readFileSync(target, 'utf8');

if (!source.includes('const preparedForClient = iranian')) {
  const insertionPoint = `  }\n\n  const languagesByUrl = new Map();`;
  const insertion = `  }\n\n  // Aparatchi exposes foreign media only when the source positively proves\n  // Persian dubbing or Persian subtitles. Native Iranian titles keep their\n  // ordinary Persian media without a redundant language badge.\n  const preparedForClient = iranian\n    ? prepared\n    : prepared.map((section) => ({\n        ...section,\n        files: (section.files || []).filter((file) =>\n          file?.language === 'dubbed' || file?.language === 'subtitled'\n        ),\n      }));\n\n  const languagesByUrl = new Map();`;
  if (!source.includes(insertionPoint)) throw new Error('preparedForClient insertion point not found');
  source = source.replace(insertionPoint, insertion);

  const marker = source.indexOf('  const preparedForClient = iranian');
  const head = source.slice(0, marker);
  let tail = source.slice(marker);
  tail = tail.replaceAll('for (const section of prepared) {', 'for (const section of preparedForClient) {');
  tail = tail.replace('const downloads = prepared.flatMap((section) => {', 'const downloads = preparedForClient.flatMap((section) => {');
  tail = tail.replace('if (neutralFiles.length) {', 'if (neutralFiles.length && iranian) {');
  source = head + tail;
}

if (!source.includes('if (!iranian && !availableLanguages.length) return null;')) {
  const languageBlock = `  const availableLanguages = [...new Set(downloads.flatMap((section) =>\n    (section.files || []).map((file) => file.language)\n      .filter((value) => value === 'dubbed' || value === 'subtitled')\n  ))];`;
  if (!source.includes(languageBlock)) throw new Error('availableLanguages block not found');
  source = source.replace(
    languageBlock,
    `${languageBlock}\n  // Foreign titles without proven Persian dub/sub are not part of the app catalog.\n  if (!iranian && !availableLanguages.length) return null;`,
  );
}

fs.writeFileSync(target, source);

// Regression fixtures that are testing transport/sorting rather than language
// truth must explicitly declare a supported Persian language. Tests that used
// to permit neutral foreign media are updated to assert the new product rule.
const testPath = 'scripts/tests/client-catalog.test.mjs';
let tests = fs.readFileSync(testPath, 'utf8');
const replacements = [
  [
    "const media = [{ files: [{ mode: 'download', url: 'https://cdn.test/movie.mp4' }] }];",
    "const media = [{ files: [{ mode: 'download', url: 'https://cdn.test/movie.mp4', language: 'subtitled' }] }];",
  ],
  [
    "const media = [{ id: 's1e1', seasonNumber: 1, episodeNumber: 1, sourceUpdatedAt: '2025-01-01T00:00:00.000Z', files: [{ mode: 'download', url: 'https://cdn.test/e1.mp4' }] }];",
    "const media = [{ id: 's1e1', seasonNumber: 1, episodeNumber: 1, sourceUpdatedAt: '2025-01-01T00:00:00.000Z', files: [{ mode: 'download', url: 'https://cdn.test/e1.mp4', language: 'subtitled' }] }];",
  ],
  [
    "{ id: 'mkv', type: 'movie', nameFa: 'ام‌کی‌وی', name: 'MKV', downloads: [{ id: 'd', files: [{ id: 'f', mode: 'download', url: 'https://cdn.test/file.mkv' }] }] },",
    "{ id: 'mkv', type: 'movie', nameFa: 'ام‌کی‌وی', name: 'MKV', downloads: [{ id: 'd', files: [{ id: 'f', mode: 'download', url: 'https://cdn.test/file.mkv', language: 'subtitled' }] }] },",
  ],
  [
    "{ id: `d${index}`, mode: 'download', url: `https://cdn.test/e${index}.mkv` },",
    "{ id: `d${index}`, mode: 'download', url: `https://cdn.test/e${index}.mkv`, language: 'subtitled' },",
  ],
  [
    "{ id: `p${index}`, mode: 'play', url: `https://cdn.test/e${index}.m3u8` },",
    "{ id: `p${index}`, mode: 'play', url: `https://cdn.test/e${index}.m3u8`, language: 'subtitled' },",
  ],
  [
    "{ id: `x${index}`, mode: 'download', url: `https://cdn.test/e${index}-extra.mp4` },",
    "{ id: `x${index}`, mode: 'download', url: `https://cdn.test/e${index}-extra.mp4`, language: 'subtitled' },",
  ],
];
for (const [from, to] of replacements) {
  if (tests.includes(from)) tests = tests.replace(from, to);
}

const oldNeutralTest = `test('missing ir flag never makes a foreign title Iranian and keeps real media neutral', () => {\n  const item = {\n    id: 'foreign-neutral', type: 'movie', nameFa: 'خارجی', name: 'Foreign',\n    countryCodes: ['US'], downloads: [{ id: 'd', files: [{ id: 'f', mode: 'download', url: 'https://cdn.test/f.mp4' }] }],\n  };\n  const artifacts = buildClientCatalogArtifacts({ version: '1', updatedAt: 'now', items: [item] });\n  assert.equal(artifacts.index.items.length, 1);\n  assert.deepEqual(artifacts.index.items[0].availableLanguages, []);\n});`;
const newNeutralTest = `test('missing ir flag never makes a foreign title Iranian and unproven-language media stays out of the app', () => {\n  const item = {\n    id: 'foreign-neutral', type: 'movie', nameFa: 'خارجی', name: 'Foreign',\n    countryCodes: ['US'], downloads: [{ id: 'd', files: [{ id: 'f', mode: 'download', url: 'https://cdn.test/f.mp4' }] }],\n  };\n  const artifacts = buildClientCatalogArtifacts({ version: '1', updatedAt: 'now', items: [item] });\n  assert.equal(artifacts.index.items.length, 0);\n});`;
if (tests.includes(oldNeutralTest)) tests = tests.replace(oldNeutralTest, newNeutralTest);

const oldConflictTest = `test('same URL with contradictory languages survives once as neutral media', () => {\n  const item = {\n    id: 'conflict', type: 'movie', nameFa: 'تعارض', name: 'Conflict', countryCodes: ['US'],\n    downloads: [\n      { id: 'd', title: 'دوبله فارسی', files: [{ id: 'f1', mode: 'download', url: 'https://cdn.test/shared.mp4' }] },\n      { id: 's', title: 'زیرنویس فارسی', files: [{ id: 'f2', mode: 'download', url: 'https://cdn.test/shared.mp4' }] },\n    ],\n  };\n  const artifacts = buildClientCatalogArtifacts({ version: '1', updatedAt: 'now', items: [item] });\n  const files = artifacts.index.items[0].downloads.flatMap((section) => section.files || []);\n  assert.equal(files.length, 1);\n  assert.equal(files[0].language, undefined);\n});`;
const newConflictTest = `test('same URL with contradictory Persian-language claims is not exposed as neutral foreign media', () => {\n  const item = {\n    id: 'conflict', type: 'movie', nameFa: 'تعارض', name: 'Conflict', countryCodes: ['US'],\n    downloads: [\n      { id: 'd', title: 'دوبله فارسی', files: [{ id: 'f1', mode: 'download', url: 'https://cdn.test/shared.mp4' }] },\n      { id: 's', title: 'زیرنویس فارسی', files: [{ id: 'f2', mode: 'download', url: 'https://cdn.test/shared.mp4' }] },\n    ],\n  };\n  const artifacts = buildClientCatalogArtifacts({ version: '1', updatedAt: 'now', items: [item] });\n  assert.equal(artifacts.index.items.length, 0);\n});`;
if (tests.includes(oldConflictTest)) tests = tests.replace(oldConflictTest, newConflictTest);

// Iranian/native Persian media is valid without a dubbing/subtitle badge.
if (!tests.includes("native Iranian media remains visible without a redundant language badge")) {
  tests += `\n\ntest('native Iranian media remains visible without a redundant language badge', () => {\n  const item = {\n    id: 'iranian-native', type: 'movie', ir: true, nameFa: 'ایرانی', name: 'Iranian',\n    downloads: [{ id: 'native', files: [{ id: 'f', mode: 'download', url: 'https://cdn.test/ir.mp4' }] }],\n  };\n  const artifacts = buildClientCatalogArtifacts({ version: '1', updatedAt: 'now', items: [item] });\n  assert.equal(artifacts.index.items.length, 1);\n  assert.deepEqual(artifacts.index.items[0].availableLanguages, []);\n});\n`;
}
fs.writeFileSync(testPath, tests);
console.log('Persian-only foreign media filtering and regression contract applied.');

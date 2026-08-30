import fs from 'node:fs';

function replaceExact(file, from, to, label, count = 1) {
  let text = fs.readFileSync(file, 'utf8');
  let replaced = 0;
  while (replaced < count) {
    const index = text.indexOf(from);
    if (index < 0) throw new Error(`${label}: expected occurrence ${replaced + 1}/${count} not found in ${file}`);
    text = `${text.slice(0, index)}${to}${text.slice(index + from.length)}`;
    replaced += 1;
  }
  fs.writeFileSync(file, text);
}

function replaceRegex(file, pattern, to, label) {
  let text = fs.readFileSync(file, 'utf8');
  if (!pattern.test(text)) throw new Error(`${label}: expected block not found in ${file}`);
  text = text.replace(pattern, to);
  fs.writeFileSync(file, text);
}

replaceRegex(
  'scripts/tests/current-media-truth.test.mjs',
  /test\('missing ir flag never makes a foreign title Iranian and keeps real media neutral',[\s\S]*?\n\}\);\n\n(?=test\('a real dubbed foreign download survives)/,
  `test('missing ir flag never makes a foreign title Iranian and unproven-language media stays out', () => {
  const item = foreign({ downloads: [{ id: 'plain', files: [
    { id: 'plain-file', mode: 'download', url: 'https://cdn.test/original.mp4' },
  ]}] });
  const { index, detailFiles } = buildClientCatalogArtifacts({ items: [item] });
  assert.equal(index.items.length, 0);
  assert.equal(detailFiles.length, 0);
});

`,
  'current media unlabeled foreign policy',
);

replaceRegex(
  'scripts/tests/client-catalog.test.mjs',
  /test\('same URL with contradictory Persian-language claims is not exposed as neutral foreign media',[\s\S]*?\n\}\);\n(?=\n\ntest\('native Iranian media)/,
  `test('same URL with contradictory Persian-language claims survives once as neutral media', () => {
  const item = {
    id: 'conflict', type: 'movie', nameFa: 'تعارض', name: 'Conflict', countryCodes: ['US'],
    downloads: [
      { id: 'd', title: 'دوبله فارسی', files: [{ id: 'f1', mode: 'download', url: 'https://cdn.test/shared.mp4' }] },
      { id: 's', title: 'زیرنویس فارسی', files: [{ id: 'f2', mode: 'download', url: 'https://cdn.test/shared.mp4' }] },
    ],
  };
  const artifacts = buildClientCatalogArtifacts({ version: '1', updatedAt: 'now', items: [item] });
  assert.equal(artifacts.index.items.length, 1);
  assert.deepEqual(artifacts.index.items[0].availableLanguages, []);
  const detail = JSON.parse(artifacts.detailFiles[0].serialized);
  const files = detail.downloads.flatMap((section) => section.files || []);
  assert.equal(files.filter((file) => file.url === 'https://cdn.test/shared.mp4').length, 1);
});`,
  'contradictory Persian URL policy',
);

replaceRegex(
  'scripts/tests/final-user-batch-20260814.test.mjs',
  /test\('foreign unlabeled original media stays visible without fake language labels',[\s\S]*?\n\}\);\n\n(?=test\('unverified operator-only records are hidden)/,
  `test('foreign unlabeled original media stays out until Persian language is proven', () => {
  const item = base({ downloads: [{ id: 's', files: [
    { id: 'f', mode: 'download', url: 'https://cdn.test/original.mp4' },
  ]}] });
  const { index, detailFiles } = buildClientCatalogArtifacts({ items: [item] });
  assert.equal(index.items.length, 0);
  assert.equal(detailFiles.length, 0);
});

`,
  'final batch unlabeled foreign policy',
);

replaceExact(
  'scripts/tests/detail-first-paint-v45.test.mjs',
  '    id: `movie-${index}`,\n    type: \'movie\',',
  '    id: `movie-${index}`,\n    type: \'movie\',\n    ir: true,',
  'detail first paint movie fixture identity',
);
replaceExact(
  'scripts/tests/detail-first-paint-v45.test.mjs',
  "      id: 'series', type: 'series', nameFa: 'سریال', name: 'Series',",
  "      id: 'series', type: 'series', ir: true, nameFa: 'سریال', name: 'Series',",
  'detail first paint series fixture identity',
);

replaceExact(
  'scripts/tests/full-navigation-bootstrap-v1.test.mjs',
  '    downloads: [{ files: [{ mode: \'download\', url: `https://cdn.test/${index}.mp4` }] }],',
  '    downloads: [{ files: [{ mode: \'download\', url: `https://cdn.test/${index}.mp4`, language: \'subtitled\' }] }],',
  'full navigation foreign fixture language',
);

const homeOld = 'files: [{ id: `${id}-file`, mode: \'download\', url: `https://cdn.test/${id}.mp4` }]';
const homeNew = 'files: [{ id: `${id}-file`, mode: \'download\', url: `https://cdn.test/${id}.mp4`, language: \'subtitled\' }]';
replaceExact('scripts/tests/home-bootstrap-v1.test.mjs', homeOld, homeNew, 'home fixture languages', 2);

replaceExact(
  'scripts/tests/smart-categories-v38.test.mjs',
  "    id: 'short-film-bootstrap',\n    type: 'movie',",
  "    id: 'short-film-bootstrap',\n    type: 'movie',\n    ir: true,",
  'short film bootstrap fixture identity',
);

replaceExact(
  'scripts/tests/ui-truth-v10.test.mjs',
  'const media = (id) => [{ id: `${id}-media`, files: [{ id: `${id}-file`, mode: \'download\', url: `https://cdn.test/${id}.mp4` }] }];',
  'const media = (id) => [{ id: `${id}-media`, files: [{ id: `${id}-file`, mode: \'download\', url: `https://cdn.test/${id}.mp4`, language: \'subtitled\' }] }];',
  'ui ordering movie fixture language',
);
replaceExact(
  'scripts/tests/ui-truth-v10.test.mjs',
  "files: [{ id: 'e1f', mode: 'download', url: 'https://cdn.test/e1.mp4' }]",
  "files: [{ id: 'e1f', mode: 'download', url: 'https://cdn.test/e1.mp4', language: 'subtitled' }]",
  'ui ordering series fixture language',
);

replaceExact(
  'scripts/tests/user-report-v11.test.mjs',
  "files: [{ id: id + '-file', mode: 'download', url: 'https://cdn.test/' + id + '.mp4' }]",
  "files: [{ id: id + '-file', mode: 'download', url: 'https://cdn.test/' + id + '.mp4', language: 'subtitled' }]",
  'v11 ordering fixture language',
);

replaceExact(
  'scripts/tests/user-report-v12.test.mjs',
  'files: [{ id: `f-${id}`, quality: \'720p\', url: `https://example.com/${id}.mp4`, mode: \'download\' }],',
  'files: [{ id: `f-${id}`, quality: \'720p\', url: `https://example.com/${id}.mp4`, mode: \'download\', language: \'subtitled\' }],',
  'v12 series fixture language',
);

console.log('Regression fixtures aligned with current client media truth.');

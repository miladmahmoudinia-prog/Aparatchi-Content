import fs from 'node:fs/promises';

await import('./apply-aug-2026-reported-fixes-v2.mjs');

const testPath = 'scripts/tests/sync-upera-regression.test.mjs';
let source = await fs.readFile(testPath, 'utf8');
const before = `test('episode artwork is stored with a newly discovered playable episode', async () => {\n  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-episode-artwork-'));\n  await writeJson(path.join(fixtureDirectory, 'catalog.json'), initialCatalog());\n  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });\n\n  try {\n    const result = await runSync(fixtureDirectory, { scenario: 'episode-artwork' });\n    const secondEpisode = result.catalog.items[0].downloads.find(\n      (group) => group.sourceEpisodeId === 'episode-2',\n    );\n    assert.equal(secondEpisode?.artwork, 'https://example.test/episode-2.jpg');\n    assert.ok(secondEpisode?.files.some((file) => file.url === 'https://cdn.example.test/episode-2.mp4'));`;
const after = `test('unverified source artwork is not trusted for a newly discovered playable episode', async () => {\n  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-episode-artwork-'));\n  await writeJson(path.join(fixtureDirectory, 'catalog.json'), initialCatalog());\n  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });\n\n  try {\n    const result = await runSync(fixtureDirectory, { scenario: 'episode-artwork' });\n    const secondEpisode = result.catalog.items[0].downloads.find(\n      (group) => group.sourceEpisodeId === 'episode-2',\n    );\n    assert.ok(!secondEpisode?.artwork, 'source still is withheld until an exact episode frame is generated');\n    assert.ok(secondEpisode?.files.some((file) => file.url === 'https://cdn.example.test/episode-2.mp4'));`;
if (!source.includes(before)) throw new Error('Episode-artwork regression target not found.');
source = source.replace(before, after);
await fs.writeFile(testPath, source, 'utf8');
console.log('Updated regression test to enforce exact episode-frame policy.');

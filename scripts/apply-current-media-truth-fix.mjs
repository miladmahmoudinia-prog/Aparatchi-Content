import fs from 'node:fs/promises';
import path from 'node:path';

const clientPath = 'scripts/client-catalog.mjs';
let source = await fs.readFile(clientPath, 'utf8');

const before = "  const iranian = item.ir !== false || (Array.isArray(item.countryCodes) && item.countryCodes.includes('IR'));";
const after = "  const iranian = item.ir === true || (Array.isArray(item.countryCodes) && item.countryCodes.includes('IR'));";
if (source.includes(before)) {
  source = source.replace(before, after);
} else if (!source.includes(after)) {
  throw new Error('Could not locate strict Iranian identity rule in client-catalog.mjs');
}

await fs.writeFile(clientPath, source, 'utf8');

// Older transport tests exercise visibility/people indexing rather than
// language inference. Give their foreign playable fixture an explicit real
// language instead of weakening the production foreign-media rule.
const clientCatalogTestPath = path.join('scripts', 'tests', 'client-catalog.test.mjs');
let clientCatalogTests = await fs.readFile(clientCatalogTestPath, 'utf8');
const oldPlayable = "const playableEpisode = [{ id: 'e1', files: [{ id: 'f1', mode: 'download', url: 'https://cdn.test/e1.mp4' }] }];";
const newPlayable = "const playableEpisode = [{ id: 'e1', files: [{ id: 'f1', mode: 'download', url: 'https://cdn.test/e1.mp4', language: 'subtitled' }] }];";
if (clientCatalogTests.includes(oldPlayable)) clientCatalogTests = clientCatalogTests.replace(oldPlayable, newPlayable);
else if (!clientCatalogTests.includes(newPlayable)) throw new Error('Could not update legacy playableEpisode fixture');
await fs.writeFile(clientCatalogTestPath, clientCatalogTests, 'utf8');

const finalStabilityTestPath = path.join('scripts', 'tests', 'final-stability.test.mjs');
let finalStabilityTests = await fs.readFile(finalStabilityTestPath, 'utf8');
finalStabilityTests = finalStabilityTests
  .replace("{ id: 'm1', type: 'movie', nameFa:", "{ id: 'm1', type: 'movie', ir: true, nameFa:")
  .replace("{ id: 'm2', type: 'movie', nameFa:", "{ id: 'm2', type: 'movie', ir: true, nameFa:");
await fs.writeFile(finalStabilityTestPath, finalStabilityTests, 'utf8');

const testPath = path.join('scripts', 'tests', 'current-media-truth.test.mjs');
const regression = `import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const foreign = (extra = {}) => ({
  id: 'foreign-x', type: 'movie', nameFa: 'آزمون', name: 'Foreign Test', year: 2026,
  poster: 'https://img.test/a.jpg', backdrop: 'https://img.test/b.jpg', overview: 'test', genres: ['درام'],
  countryCodes: ['US'], ...extra,
});

test('missing ir flag never makes a foreign title Iranian', () => {
  const item = foreign({ downloads: [{ id: 'plain', files: [
    { id: 'plain-file', mode: 'download', url: 'https://cdn.test/original.mp4' },
  ]}] });
  const { index } = buildClientCatalogArtifacts({ items: [item] });
  assert.equal(index.items.length, 0);
});

test('a real dubbed foreign download survives and is labelled dubbed', () => {
  const item = foreign({ downloads: [{ id: 'dub', title: 'دوبله فارسی', files: [
    { id: 'dub-file', mode: 'download', url: 'https://cdn.test/dubbed.mp4', language: 'dubbed' },
  ]}] });
  const { index, detailFiles } = buildClientCatalogArtifacts({ items: [item] });
  assert.equal(index.items.length, 1);
  assert.deepEqual(index.items[0].availableLanguages, ['dubbed']);
  const detail = JSON.parse(detailFiles[0].serialized);
  assert.equal(detail.downloads[0].title, 'دوبله فارسی');
  assert.equal(detail.downloads[0].files[0].language, 'dubbed');
  assert.equal(detail.downloads[0].files[0].mode, 'download');
});

test('same URL cannot appear as both dubbed and subtitled', () => {
  const item = foreign({ downloads: [{ id: 'mixed', files: [
    { id: 'dub-file', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'dubbed' },
    { id: 'sub-file', mode: 'play', url: 'https://cdn.test/same.mp4', language: 'subtitled' },
  ]}] });
  const { index } = buildClientCatalogArtifacts({ items: [item] });
  assert.equal(index.items.length, 0);
});
`;
await fs.writeFile(testPath, regression, 'utf8');

console.log('Applied strict current media-language truth fix.');

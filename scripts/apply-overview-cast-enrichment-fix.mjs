import fs from 'node:fs/promises';
import path from 'node:path';

const target = 'scripts/enrich-tmdb.mjs';
let source = await fs.readFile(target, 'utf8');

function replaceRequired(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Missing patch target: ${label}`);
  source = source.replace(before, after);
}

// v1 already added TMDB translations/overview. v2 also treats provider placeholder
// prose ("توضیحی ثبت نشده است") as a missing overview instead of valid metadata.
replaceRequired(
`  const cachedMetadataCurrent = cached?.tmdb === null || Boolean(
    Number(cached?.metadata?.validationVersion || 0) >= 7 &&
    Number(cached?.metadata?.overviewAuditVersion || 0) >= 1
  );`,
`  const cachedMetadataCurrent = cached?.tmdb === null || Boolean(
    Number(cached?.metadata?.validationVersion || 0) >= 7 &&
    Number(cached?.metadata?.overviewAuditVersion || 0) >= 2
  );`,
  'overview audit cache gate v2',
);

replaceRequired(
`  if (
    hasCompleteTmdbPeople(item.people) &&
    hasCompleteTmdbMetadata(item) &&
    Number(item.tmdbValidationVersion || 0) >= 5
  ) {`,
`  if (
    hasCompleteTmdbPeople(item.people) &&
    hasCompleteTmdbMetadata(item) &&
    Number(item.tmdbValidationVersion || 0) >= 5 &&
    (!isMissingOverview(item.overview) || Number(cached?.metadata?.overviewAuditVersion || 0) >= 2)
  ) {`,
  'do not skip unaudited placeholder overview',
);

replaceRequired(
`    overviewAuditVersion: 1,`,
`    overviewAuditVersion: 2,`,
  'overview audit version v2',
);

replaceRequired(
`  if (!cleanText(item.overview) && metadataOverview) item.overview = metadataOverview;`,
`  if (isMissingOverview(item.overview) && metadataOverview) item.overview = metadataOverview;`,
  'replace placeholder overview',
);

if (!source.includes('function isMissingOverview(value) {')) {
  replaceRequired(
`function cleanText(value) {
  return String(value ?? '').replace(/\\s+/g, ' ').trim();
}`,
`function isMissingOverview(value) {
  const text = cleanText(value);
  if (!text) return true;
  return /^(?:توضیحی\\s+ثبت\\s+نشده(?:\\s+است)?[.!؟]?|بدون\\s+توضیح[.!؟]?|خلاصه(?:\\s+داستان)?\\s+ثبت\\s+نشده(?:\\s+است)?[.!؟]?|no\\s+(?:description|overview)(?:\\s+(?:available|provided))?[.!?]?)$/i.test(text);
}

function cleanText(value) {
  return String(value ?? '').replace(/\\s+/g, ' ').trim();
}`,
    'missing-overview helper',
  );
}

await fs.writeFile(target, source, 'utf8');

const regressionPath = path.join('scripts', 'tests', 'overview-cast-enrichment.test.mjs');
const regression = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../enrich-tmdb.mjs', import.meta.url), 'utf8');

test('TMDB details include translations together with cast and crew', () => {
  assert.ok(source.includes("append_to_response: 'aggregate_credits,keywords,images,translations'"));
  assert.ok(source.includes("append_to_response: 'credits,keywords,images,translations'"));
  assert.ok(source.includes('function buildTmdbPeople(details, mediaType)'));
});

test('missing overview prefers Persian TMDB translation and falls back to TMDB overview', () => {
  assert.ok(source.includes("cleanText(entry?.iso_639_1).toLowerCase() === 'fa'"));
  assert.ok(source.includes('const overview = translatedOverview || cleanText(details?.overview);'));
  assert.ok(source.includes('...(overview ? { overview } : {})'));
});

test('provider placeholder overview is treated as missing and gets a v2 audit', () => {
  assert.ok(source.includes('function isMissingOverview(value)'));
  assert.ok(source.includes('توضیحی\\\\s+ثبت\\\\s+نشده'));
  assert.ok(source.includes('Number(cached?.metadata?.overviewAuditVersion || 0) >= 2'));
  assert.ok(source.includes('overviewAuditVersion: 2'));
  assert.ok(source.includes('if (isMissingOverview(item.overview) && metadataOverview) item.overview = metadataOverview;'));
});

test('a real existing overview is still never overwritten', () => {
  const assignment = 'if (isMissingOverview(item.overview) && metadataOverview) item.overview = metadataOverview;';
  assert.ok(source.includes(assignment));
  assert.ok(!source.includes('if (metadataOverview) item.overview = metadataOverview;'));
});
`;
await fs.writeFile(regressionPath, regression, 'utf8');

console.log('Applied overview + cast/crew enrichment v2 (placeholder-aware).');

import fs from 'node:fs/promises';

const file = 'scripts/sync-upera.mjs';
let source = await fs.readFile(file, 'utf8');

const replaceOnce = (before, after, label) => {
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one marker, found ${count}`);
  source = source.replace(before, after);
};

replaceOnce(
  `function parseMediaLinks(links) {`,
  `function providerPrimaryMediaLanguage(source) {\n  if (!source || typeof source !== 'object') return '';\n  const dubbed = source.dubbed === true || Number(source.dubbed) === 1 || /^(?:1|true|yes)$/i.test(cleanText(source.dubbed));\n  return dubbed ? 'dubbed' : '';\n}\n\nfunction isUperaPrimaryMediaVariant(value) {\n  const text = cleanText(value);\n  if (!/upera\\.tv|upera\\.link|seeko\\.film/i.test(text)) return false;\n  let pathname = text;\n  try { pathname = new URL(text).pathname; } catch {}\n  const filename = pathname.split('/').pop() || '';\n  return /-0-(?:[^/?#]+)$/i.test(filename);\n}\n\nfunction parseMediaLinks(links, primaryLanguage = '') {`,
  'provider language helpers',
);

replaceOnce(
  `      next._media_language_tag = mediaLanguageTagForLink(next);`,
  `      next._media_language_tag = mediaLanguageTagForLink(next) ||\n        (primaryLanguage === 'dubbed' && isUperaPrimaryMediaVariant(next.link) ? 'dubbed' : '');`,
  'affiliate primary language fallback',
);

// Movie list/search rows do not reliably expose Upera's title-level dubbed flag.
// Fetch the title detail whenever that field is absent so hourly media refreshes
// cannot erase a previously-correct dubbed badge merely because the list row was
// sparse. Series processing already fetches fetchSeriesDetail(id) unconditionally.
replaceOnce(
  `  if (!hasBasicMetadata(movie) || options.panelCandidate === true) {`,
  `  if (!hasBasicMetadata(movie) || options.panelCandidate === true || !Object.prototype.hasOwnProperty.call(movie, 'dubbed')) {`,
  'movie provider dubbed detail refresh',
);

const callMarker = `const media = parseMediaLinks(linkResult.links);`;
const firstCall = source.indexOf(callMarker);
if (firstCall >= 0) {
  source = source.slice(0, firstCall) + `const media = parseMediaLinks(linkResult.links, providerPrimaryMediaLanguage(movie));` + source.slice(firstCall + callMarker.length);
}
const secondCall = source.indexOf(callMarker);
if (secondCall >= 0) {
  source = source.slice(0, secondCall) + `const media = parseMediaLinks(linkResult.links, providerPrimaryMediaLanguage(series));` + source.slice(secondCall + callMarker.length);
}
if (source.includes(callMarker)) throw new Error('Unexpected additional parseMediaLinks caller remains unpatched.');
if (!source.includes('providerPrimaryMediaLanguage(movie)')) throw new Error('Movie provider language context was not wired.');
if (!source.includes('providerPrimaryMediaLanguage(series)')) throw new Error('Series provider language context was not wired.');
if (!source.includes("!Object.prototype.hasOwnProperty.call(movie, 'dubbed')")) throw new Error('Sparse movie list rows can still skip title-level dubbed truth.');

await fs.writeFile(file, source);
console.log('Applied provider language truth parser v9.');

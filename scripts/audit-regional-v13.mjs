import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const index = JSON.parse(await fs.readFile('catalog-index.json', 'utf8'));

const pick = (item) => ({
  id: item.id,
  type: item.type,
  nameFa: item.nameFa,
  name: item.name,
  year: item.year,
  originalLanguage: item.originalLanguage,
  countryCodes: item.countryCodes,
  countryLabels: item.countryLabels,
  countryNames: item.countryNames,
  categoryKeys: item.categoryKeys,
  categoryLabels: item.categoryLabels,
  tmdbId: item.tmdbId,
  tmdbValidationVersion: item.tmdbValidationVersion,
  sourceTitle: item.sourceTitle,
  overview: item.overview,
});

const korean = (index.items || []).filter((item) => item.type === 'movie' && item.categoryKeys?.includes('korean-movies'));
const koreanNonKo = korean.filter((item) => String(item.originalLanguage || '').toLowerCase() !== 'ko');
const indianSeries = (index.items || []).filter((item) => item.categoryKeys?.includes('indian-series'));
const conan = (index.items || []).filter((item) => /conan\s+the\s+barbarian/i.test(`${item.name || ''} ${item.nameFa || ''}`));
const arabicLookingKorean = korean.filter((item) => /[أإؤئءةى]/u.test(String(item.nameFa || '')) || String(item.originalLanguage || '').toLowerCase() === 'ar');
const sourceById = new Map((catalog.items || []).map((item) => [String(item.id), item]));

console.log(JSON.stringify({
  counts: {
    koreanMovies: korean.length,
    koreanNonKo: koreanNonKo.length,
    indianSeries: indianSeries.length,
    conan: conan.length,
    arabicLookingKorean: arabicLookingKorean.length,
  },
  koreanNonKo: koreanNonKo.map((item) => ({ index: pick(item), source: pick(sourceById.get(String(item.id)) || {}) })),
  conan: conan.map((item) => ({ index: pick(item), source: pick(sourceById.get(String(item.id)) || {}) })),
  arabicLookingKorean: arabicLookingKorean.map((item) => ({ index: pick(item), source: pick(sourceById.get(String(item.id)) || {}) })),
  indianSeries: indianSeries.map(pick),
}, null, 2));

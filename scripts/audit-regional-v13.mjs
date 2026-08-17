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
const koreanInvalid = korean.filter((item) => !(item.countryCodes || []).includes('KR') && String(item.originalLanguage || '').toLowerCase() !== 'ko');
const indianSeries = (index.items || []).filter((item) => item.categoryKeys?.includes('indian-series'));
const sourceById = new Map((catalog.items || []).map((item) => [String(item.id), item]));

console.log(JSON.stringify({
  counts: {
    koreanMovies: korean.length,
    koreanInvalid: koreanInvalid.length,
    indianSeries: indianSeries.length,
  },
  koreanHead: korean.slice(0, 40).map((item) => ({
    index: pick(item),
    source: pick(sourceById.get(String(item.id)) || {}),
  })),
  koreanInvalid: koreanInvalid.slice(0, 100).map(pick),
  indianSeries: indianSeries.slice(0, 100).map(pick),
}, null, 2));

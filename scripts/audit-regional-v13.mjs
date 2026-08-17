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
});

const korean = (index.items || []).filter((item) => item.type === 'movie' && item.categoryKeys?.includes('korean-movies'));
const koreanNonKo = korean.filter((item) => String(item.originalLanguage || '').toLowerCase() !== 'ko');
const indianSeries = (index.items || []).filter((item) => item.categoryKeys?.includes('indian-series'));
const arabicLookingKorean = korean.filter((item) => /[أإؤئءةى]/u.test(String(item.nameFa || '')) || String(item.originalLanguage || '').toLowerCase() === 'ar');
const sourceById = new Map((catalog.items || []).map((item) => [String(item.id), item]));
const episodeGroups = (catalog.items || []).flatMap((item) =>
  item.type === 'series'
    ? (item.downloads || []).filter((group) => Number(group?.episodeNumber || 0) > 0).map((group) => ({ item, group }))
    : []
);
const generatedEpisodeFrames = episodeGroups.filter(({ group }) => /(?:^|\/)assets\/media\/episodes\//i.test(String(group?.artwork || '')));
const uniqueEpisodeArtwork = new Set(generatedEpisodeFrames.map(({ group }) => String(group.artwork || '')));
const seriesWithGeneratedFrames = new Set(generatedEpisodeFrames.map(({ item }) => String(item.id)));

console.log(JSON.stringify({
  counts: {
    koreanMovies: korean.length,
    koreanNonKo: koreanNonKo.length,
    indianSeries: indianSeries.length,
    arabicLookingKorean: arabicLookingKorean.length,
    episodeGroups: episodeGroups.length,
    generatedEpisodeFrames: generatedEpisodeFrames.length,
    uniqueGeneratedEpisodeFrames: uniqueEpisodeArtwork.size,
    seriesWithGeneratedFrames: seriesWithGeneratedFrames.size,
  },
  koreanNonKo: koreanNonKo.map((item) => ({ index: pick(item), source: pick(sourceById.get(String(item.id)) || {}) })),
  arabicLookingKorean: arabicLookingKorean.map((item) => ({ index: pick(item), source: pick(sourceById.get(String(item.id)) || {}) })),
  indianSeries: indianSeries.map(pick),
}, null, 2));

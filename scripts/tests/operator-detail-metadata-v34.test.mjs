import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperatorMetadataRepair } from '../operator-metadata-repair.mjs';
import { classifyCatalogItem } from '../classification.mjs';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const operatorFile = {
  id: 'operator-play',
  mode: 'operator-play',
  operatorOnly: true,
  panelVerified: true,
  trafficOo: 1,
  url: 'https://upera.tv/stream/movie/example',
};

test('matched operator shell inherits documentary/category identity without copying ordinary media', () => {
  const donor = {
    id: 'same-id', type: 'movie', year: 2024, nameFa: 'نمونه مستند', name: 'Documentary Sample',
    genres: ['مستند'], countryCodes: ['IR'], countryLabels: ['ایران'], originalLanguage: 'fa',
    overview: 'این مستند درباره یک موضوع تاریخی و اجتماعی است.',
    people: [{ id: 'd', nameFa: 'کارگردان نمونه', role: 'director', roleLabel: 'کارگردان' }],
    downloads: [{ id: 'ordinary', files: [{ mode: 'download', url: 'https://cdn.test/movie.mp4' }] }],
  };
  const operator = {
    id: 'same-id--operator', type: 'movie', year: 2024, nameFa: 'نمونه مستند', operatorOnly: true,
    contentVariant: 'operator-exclusive', categoryKeys: ['mobile-operator', 'iranian-movies'],
    downloads: [{ id: 'operator', files: [operatorFile] }],
  };
  const items = [donor, operator];
  const stats = applyOperatorMetadataRepair(items);
  assert.equal(stats.donorMatches, 1);
  assert.deepEqual(operator.genres, ['مستند']);
  assert.deepEqual(operator.countryCodes, ['IR']);
  assert.equal(operator.originalLanguage, 'fa');
  assert.match(operator.overview, /مستند/);
  assert.equal(operator.people.length, 1);
  assert.equal(operator.downloads[0].files[0].mode, 'operator-play', 'operator media stays isolated');
  const classification = classifyCatalogItem(operator);
  assert.ok(classification.categoryKeys.includes('documentaries'));
  assert.ok(!classification.categoryKeys.includes('iranian-movies'));
});

test('reported operator documentary samples use documentary identity without broad title substring guesses', () => {
  const samples = [
    [2023, 'شاهد'],
    [2025, 'عبای سوخته'],
    [2026, 'زنگ میناب'],
    [2024, 'شه بانو'],
    [2025, 'فرزانه جلیسی'],
    [2021, 'فاطمیه در کلیسا'],
    [2024, 'غدیر از کانت تا وایسکه'],
    [2024, 'نجیب زادگی'],
    [2025, 'سلطان ناصر'],
  ];
  for (const [year, nameFa] of samples) {
    const result = classifyCatalogItem({ type: 'movie', year, nameFa, ir: true, categoryKeys: ['iranian-movies', 'mobile-operator'] });
    assert.ok(result.categoryKeys.includes('documentaries'), `${nameFa} must be documentary`);
    assert.ok(!result.categoryKeys.includes('iranian-movies'), `${nameFa} must leave Iranian movies`);
  }
  const narrative = classifyCatalogItem({ type: 'movie', year: 2023, nameFa: 'شاهد یک قتل', genres: ['درام'], ir: true });
  assert.equal(narrative.isDocumentary, false);
  assert.ok(narrative.categoryKeys.includes('iranian-movies'));
});

test('bootstrap carries overview, genres and an immediate bounded people preview before detail opens', () => {
  const item = {
    id: 'operator-doc', type: 'movie', year: 2024, nameFa: 'مستند تست', name: 'Test Doc', ir: true,
    contentKind: 'documentary', isDocumentary: true, genres: ['مستند'], countryCodes: ['IR'], countryLabels: ['ایران'],
    overview: 'خلاصه‌ای که باید از همان نمایش اول صفحه جزئیات حاضر باشد.',
    categoryKeys: ['documentaries', 'mobile-operator'], categoryLabels: ['مستند', 'ویژه اینترنت همراه'],
    operatorOnly: true, tmdbId: 12345,
    people: Array.from({ length: 10 }, (_, index) => ({ id: `p${index}`, nameFa: `نفر ${index}`, role: index === 0 ? 'director' : 'actor' })),
    downloads: [{ id: 'operator', files: [operatorFile] }],
  };
  const artifacts = buildClientCatalogArtifacts({ version: 'v34', updatedAt: 'now', items: [item] });
  assert.equal(artifacts.index.items.length, 1);
  const bootstrap = artifacts.bootstrap.items[0];
  assert.equal(bootstrap.overview, item.overview);
  assert.deepEqual(bootstrap.genres, ['مستند']);
  assert.deepEqual(bootstrap.countryLabels, ['ایران']);
  assert.equal(bootstrap.people.length, 4);
  assert.ok(bootstrap.categoryKeys.includes('mobile-operator'));
});

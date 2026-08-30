import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { classifyCatalogItem, classicComedyCollectionFor } from '../classification.mjs';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

test('Arghavan sample goes to short films, not Iranian movies', () => {
  const result = classifyCatalogItem({ type: 'movie', year: 2025, nameFa: 'لمس جهان', name: 'لمس جهان', ir: true, genres: ['سایر'] });
  assert.equal(result.contentKind, 'short-film');
  assert.ok(result.categoryKeys.includes('short-films'));
  assert.ok(!result.categoryKeys.includes('iranian-movies'));
});

test('Arghavan teaser is a program, not a short or cinema movie', () => {
  const result = classifyCatalogItem({ type: 'movie', year: 2025, nameFa: 'تیزر جشنواره ارغوان', ir: true, genres: ['سایر'] });
  assert.equal(result.contentKind, 'program');
  assert.ok(result.categoryKeys.includes('programs'));
  assert.ok(!result.categoryKeys.includes('short-films'));
  assert.ok(!result.categoryKeys.includes('iranian-movies'));
});

test('reported documentary samples leave Iranian movies', () => {
  for (const [nameFa, year] of [['فروغ فرخزاد: ۱۳۱۳-۱۳۴۵', 1967], ['پا به پای آزادی', 2006], ['امپراتور و ما', 2006], ['اشغال جزایر', 2025], ['اتو استاپ', 2004], ['آزادی در مه', 2007]]) {
    const result = classifyCatalogItem({ type: 'movie', year, nameFa, ir: true, genres: ['سایر'] });
    assert.equal(result.contentKind, 'documentary', nameFa);
    assert.ok(result.categoryKeys.includes('documentaries'), nameFa);
    assert.ok(!result.categoryKeys.includes('iranian-movies'), nameFa);
  }
});

test('unknown weak operator shell cannot pollute regional movie shelves', () => {
  const result = classifyCatalogItem({ type: 'movie', nameFa: 'عنوان ناشناخته', ir: true, genres: ['سایر'], operatorClassificationPending: true });
  assert.ok(!result.categoryKeys.includes('iranian-movies'));
  assert.ok(!result.categoryKeys.includes('foreign-movies'));
});

test('unknown operator shells stay server-side until automatic classification resolves them', () => {
  const pending = {
    id: 'pending-operator-shell',
    type: 'movie',
    nameFa: 'عنوان ناشناخته',
    name: 'عنوان ناشناخته',
    operatorOnly: true,
    operatorClassificationStatus: 'pending',
    categoryKeys: ['movies', 'mobile-operator'],
    downloads: [{ files: [{
      mode: 'operator-play',
      operatorOnly: true,
      panelVerified: true,
      trafficOo: 1,
      url: 'https://cdn.test/operator.mp4',
    }] }],
  };
  const artifacts = buildClientCatalogArtifacts({ version: 'test', updatedAt: 'now', items: [pending] });
  assert.equal(artifacts.index.items.length, 0);
  assert.equal(artifacts.bootstrap.items.length, 0);
});

test('verified operator titles publish in their resolved specialized category', () => {
  const verified = {
    id: 'verified-operator-documentary',
    type: 'movie',
    nameFa: 'مستند نمونه',
    name: 'Sample Documentary',
    operatorOnly: true,
    tmdbId: 99123,
    operatorClassificationStatus: 'verified',
    contentKind: 'documentary',
    categoryKeys: ['documentaries', 'mobile-operator'],
    downloads: [{ files: [{
      mode: 'operator-play',
      operatorOnly: true,
      panelVerified: true,
      trafficOo: 1,
      url: 'https://cdn.test/operator-documentary.mp4',
    }] }],
  };
  const artifacts = buildClientCatalogArtifacts({ version: 'test', updatedAt: 'now', items: [verified] });
  assert.deepEqual(artifacts.index.items[0].categoryKeys, ['documentaries', 'mobile-operator']);
});

test('operator identity, not optional cast or overview completeness, controls publication', () => {
  const media = [{ files: [{
    mode: 'operator-play', operatorOnly: true, panelVerified: true, trafficOo: 1,
    url: 'https://cdn.test/operator-famous.mp4',
  }] }];
  const identified = {
    id: 'known-famous-title', type: 'movie', nameFa: 'فیلم معروف', name: 'Famous Film',
    operatorOnly: true, tmdbId: 12345, categoryKeys: ['movies', 'mobile-operator'], downloads: media,
  };
  const unidentified = {
    ...identified, id: 'unverified-shell', tmdbId: undefined,
    operatorClassificationStatus: 'verified', people: [{ nameFa: 'بازیگر نمایشی', role: 'actor' }],
  };
  const artifacts = buildClientCatalogArtifacts({ version: 'test', updatedAt: 'now', items: [identified, unidentified] });
  assert.deepEqual(artifacts.index.items.map((item) => item.id), ['known-famous-title']);
  assert.equal(artifacts.index.items[0].overview, undefined);
  assert.equal(artifacts.index.items[0].people, undefined);
});

test('operator sync searches TMDB classification before final publish', () => {
  const source = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');
  assert.ok(source.includes('await enrichOperatorClassificationMetadata();'));
  assert.ok(source.includes("item.operatorClassificationSource = 'tmdb'"));
  assert.ok(source.includes('operatorClassificationNeedsVerification(item)'));
  assert.ok(source.includes("language: 'fa-IR'"));
  assert.ok(source.includes("language: 'en-US'"));
  assert.ok(source.includes('external_source: \'imdb_id\''));
});

test('Iranian lane probes recent titles and refreshes current-year series even without a stale airing flag', () => {
  const source = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');
  assert.ok(source.includes('await syncRecentIranianSeriesDiscovery();'));
  assert.ok(source.includes("discovery: 'recent-page-1'"));
  assert.ok(source.includes('(effectiveIranianIdentity(item) && Number(item?.year || 0) >= currentYear)'));
});

test('client bootstrap carries short film category', () => {
  const item = {
    id: 'short-film-bootstrap',
    type: 'movie',
    ir: true,
    nameFa: 'فیلم کوتاه نمونه',
    name: 'Short Film Sample',
    contentKind: 'short-film',
    categoryKeys: ['short-films'],
    downloads: [{ files: [{ mode: 'download', url: 'https://cdn.test/short-film.mp4' }] }],
  };
  const artifacts = buildClientCatalogArtifacts({ version: 'test', updatedAt: 'now', items: [item] });
  assert.equal(artifacts.index.items.length, 1);
  assert.equal(artifacts.bootstrap.items.length, 1);
  assert.ok(artifacts.bootstrap.items[0].categoryKeys.includes('short-films'));
});

test('2073 cannot become a short film from a synopsis that merely mentions another short film', () => {
  const result = classifyCatalogItem({
    type: 'movie', year: 2024, nameFa: '2073', name: '2073',
    overview: 'این فیلم بلند از فیلم کوتاه نمادین اسکله الهام گرفته است.',
    contentKind: 'short-film', categoryKeys: ['short-films'],
    countryCodes: ['GB'], originalLanguage: 'en', genres: ['سایر'],
  });
  assert.equal(result.contentKind, 'movie');
  assert.ok(result.categoryKeys.includes('foreign-movies'));
  assert.ok(!result.categoryKeys.includes('short-films'));
});

test('Laurel and Hardy and Charlie Chaplin films receive stable classic collections', () => {
  const laurelAndHardy = classicComedyCollectionFor({
    type: 'movie', genres: ['کمدی', 'فیلم کوتاه'],
    people: [
      { role: 'actor', name: 'Stan Laurel' },
      { role: 'actor', name: 'Oliver Hardy' },
    ],
  });
  assert.equal(laurelAndHardy?.id, 'classic:laurel-and-hardy');
  assert.equal(laurelAndHardy?.nameFa, 'کالکشن لورل و هاردی');
  const classified = classifyCatalogItem({
    type: 'movie', name: 'Busy Bodies', year: 1933,
    genres: ['کمدی', 'فیلم کوتاه'], countryCodes: ['US'], originalLanguage: 'en',
    collectionId: laurelAndHardy.id,
  });
  assert.ok(classified.categoryKeys.includes('collections'));
  assert.ok(classified.categoryKeys.includes('foreign-movies'));
  assert.ok(!classified.categoryKeys.includes('short-films'));

  const chaplin = classicComedyCollectionFor({
    type: 'movie', genres: ['کمدی'],
    people: [{ role: 'director', name: 'Charlie Chaplin' }],
  });
  assert.equal(chaplin?.id, 'classic:charlie-chaplin');
  assert.equal(chaplin?.nameFa, 'کالکشن چارلی چاپلین');
});

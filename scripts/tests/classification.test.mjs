import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCatalogItem } from '../classification.mjs';

const classify = (overrides = {}) => classifyCatalogItem({
  type: 'movie',
  name: 'Sample',
  nameFa: 'نمونه',
  genres: ['درام'],
  originalLanguage: 'en',
  countryCodes: ['US'],
  ...overrides,
});

test('Korean and Indian movies use dedicated shelves while Indian series stay under foreign series', () => {
  const koreanMovie = classify({ originalLanguage: 'ko', countryCodes: ['KR'] });
  assert.ok(koreanMovie.categoryKeys.includes('korean-movies'));
  assert.ok(!koreanMovie.categoryKeys.includes('foreign-movies'));

  const indianMovie = classify({ originalLanguage: 'hi', countryCodes: ['IN'] });
  assert.ok(indianMovie.categoryKeys.includes('indian-movies'));
  assert.ok(!indianMovie.categoryKeys.includes('foreign-movies'));

  const indianSeries = classify({ type: 'series', originalLanguage: 'hi', countryCodes: ['IN'] });
  assert.ok(indianSeries.categoryKeys.includes('foreign-series'));
  assert.ok(!indianSeries.categoryKeys.includes('indian-series'));
});

test('narrative films with children/family wording are not child-program content', () => {
  const result = classify({
    name: "The Children's Train",
    nameFa: 'قطار کودکان',
    genres: ['درام', 'خانوادگی'],
    contentKind: 'children-program', // stale legacy classification must not win
    categoryKeys: ['movies', 'kids'],
    tmdbValidationVersion: 6,
  });
  assert.equal(result.isChildrenProgram, false);
  assert.ok(!result.categoryKeys.includes('kids'));
  assert.ok(result.categoryKeys.includes('foreign-movies'));
});

test('actual child programs stay only in Kids and are excluded from Iranian cinema/program shelf', () => {
  const result = classify({
    name: "Aunt Nasrin's Songs for Kids 5",
    nameFa: 'ترانه های کودکانه خاله نسرین ۵',
    originalLanguage: 'fa',
    countryCodes: ['IR'],
    genres: ['کودک'],
  });
  assert.equal(result.isChildrenProgram, true);
  assert.ok(result.categoryKeys.includes('kids'));
  assert.ok(!result.categoryKeys.includes('programs'));
  assert.ok(!result.categoryKeys.includes('iranian-movies'));
});

test('foreign-series reclassification removes a stale Iranian identity when trusted country/language exists', () => {
  const result = classify({
    type: 'series', name: 'The Westies', nameFa: 'وستی ها',
    originalLanguage: 'en', countryCodes: ['US'], ir: true,
    categoryKeys: ['series', 'iranian-series'],
  });
  assert.equal(result.ir, false);
  assert.ok(result.categoryKeys.includes('foreign-series'));
  assert.ok(!result.categoryKeys.includes('iranian-series'));
});

test('wildlife needs real animal context and rejects unrelated documentaries', () => {
  const leopard = classify({
    name: 'Living with Leopards', nameFa: 'زندگی با پلنگ ها', genres: ['Documentary'],
    isDocumentary: true, tmdbValidationVersion: 7,
    overview: 'A wildlife documentary following leopards in their natural habitat.',
  });
  assert.ok(leopard.categoryKeys.includes('wildlife'));
  assert.ok(!leopard.categoryKeys.includes('documentaries'));

  for (const nameFa of ['آخرین قرار', 'موتورسواران', 'آفریده']) {
    const unrelated = classify({
      nameFa, genres: ['مستند'], overview: 'روایتی اجتماعی درباره زندگی انسان ها و طبیعت پیرامونشان.',
    });
    assert.ok(unrelated.categoryKeys.includes('documentaries'));
    assert.ok(!unrelated.categoryKeys.includes('wildlife'));
  }

  const unrelatedTitle = classify({
    name: 'A Hidden World', nameFa: 'دنیای پنهان', genres: ['Documentary'],
    overview: 'این مستند رفتار، مهاجرت و زیستگاه طبیعی پرندگان و پستانداران یک جنگل دورافتاده را بررسی می‌کند.',
  });
  assert.ok(unrelatedTitle.categoryKeys.includes('wildlife'));
  assert.ok(!unrelatedTitle.categoryKeys.includes('documentaries'));

  const narrativeInNature = classify({
    name: 'Lost in the Forest', nameFa: 'گمشده در جنگل', genres: ['Documentary'],
    overview: 'داستان زندگی یک خانواده و حیوان خانگی آن‌ها در طبیعت و تلاششان برای بازگشت به خانه.',
  });
  assert.ok(narrativeInNature.categoryKeys.includes('documentaries'));
  assert.ok(!narrativeInNature.categoryKeys.includes('wildlife'));
});

test('specialized episodic content stays out of generic series shelves', () => {
  const competition = classify({ type: 'series', nameFa: 'سیزده شمالی', originalLanguage: 'fa', countryCodes: ['IR'] });
  assert.ok(competition.categoryKeys.includes('programs'));
  assert.ok(!competition.categoryKeys.includes('series'));
  assert.ok(!competition.categoryKeys.includes('iranian-series'));

  const kids = classify({ type: 'series', nameFa: 'هشتگ خاله سوسکه', originalLanguage: 'fa', countryCodes: ['IR'] });
  assert.ok(kids.categoryKeys.includes('kids'));
  assert.ok(!kids.categoryKeys.includes('programs'));
  assert.ok(!kids.categoryKeys.includes('series'));

  const documentary = classify({ type: 'series', nameFa: 'از به', genres: ['درام'], originalLanguage: 'fa', countryCodes: ['IR'] });
  assert.ok(documentary.categoryKeys.includes('documentaries'));
  assert.ok(!documentary.categoryKeys.includes('series'));
});

test('known narrative and wildlife samples use exclusive correct shelves', () => {
  const narrative = classify({ nameFa: 'مزار شریف', genres: ['مستند', 'درام'], originalLanguage: 'fa', countryCodes: ['IR'] });
  assert.equal(narrative.isDocumentary, false);
  assert.ok(narrative.categoryKeys.includes('iranian-movies'));

  const wildlife = classify({ nameFa: 'آخرین زنبور عسل', name: 'The Last Bumblebee', genres: ['Documentary'], isDocumentary: true, tmdbValidationVersion: 7 });
  assert.ok(wildlife.categoryKeys.includes('wildlife'));
  assert.ok(!wildlife.categoryKeys.includes('documentaries'));
});

test('reality competitions are programs, not cinema, even when source type says movie', () => {
  const result = classify({
    name: 'Don Mafia Contest', nameFa: 'آموزش مسابقه مافیا دن',
    genres: ['Reality Show', 'خانوادگی'], originalLanguage: 'fa', countryCodes: ['IR'],
  });
  assert.ok(result.categoryKeys.includes('programs'));
  assert.ok(result.categoryKeys.includes('reality'));
  assert.ok(!result.categoryKeys.includes('iranian-movies'));
});

test('narrative films do not become reality programs because their synopsis mentions a TV contest', () => {
  const result = classify({
    name: 'Slumdog Millionaire',
    nameFa: 'میلیونر زاغه نشین',
    genres: ['درام', 'عاشقانه', 'جنایی'],
    originalLanguage: 'hi',
    countryCodes: ['IN'],
    overview: 'پس از متهم شدن به تقلب در مسابقه تلویزیونی، جوانی داستان زندگی خود را بازگو می‌کند.',
    contentKind: 'reality-competition',
    categoryKeys: ['programs', 'reality'],
    tmdbValidationVersion: 7,
  });
  assert.equal(result.isRealityCompetition, false);
  assert.ok(result.categoryKeys.includes('indian-movies'));
  assert.ok(!result.categoryKeys.includes('programs'));
  assert.ok(!result.categoryKeys.includes('reality'));
});

test('religious matching uses whole terms and does not match imam inside Sita Ramam', () => {
  const result = classify({
    name: 'Sita Ramam',
    nameFa: 'سیتا رامام',
    genres: ['درام', 'عاشقانه'],
    originalLanguage: 'te',
    countryCodes: ['IN'],
    contentKind: 'religious-movie',
    categoryKeys: ['religious'],
    tmdbValidationVersion: 7,
  });
  assert.ok(result.categoryKeys.includes('indian-movies'));
  assert.ok(!result.categoryKeys.includes('religious'));
});

test('known genuine religious films stay in religious while also remaining films', () => {
  const result = classify({
    name: 'The Kingdom of Solomon',
    nameFa: 'ملک سلیمان',
    genres: ['درام', 'تاریخی'],
    originalLanguage: 'fa',
    countryCodes: ['IR'],
  });
  assert.ok(result.categoryKeys.includes('religious'));
  assert.ok(result.categoryKeys.includes('iranian-movies'));
  assert.equal(result.contentKind, 'religious-movie');
});


test('animated child-song titles stay in Kids instead of generic Animation', () => {
  const result = classify({
    name: "Aunt Nasrin's Children's Songs 5",
    nameFa: 'ترانه‌های کودکانه خاله نسرین ۵',
    genres: ['سایر'],
    originalLanguage: 'fa',
    countryCodes: ['IR'],
    isAnimation: true,
  });
  assert.equal(result.isChildrenProgram, true);
  assert.equal(result.contentKind, 'children-program');
  assert.ok(result.categoryKeys.includes('kids'));
  assert.ok(!result.categoryKeys.includes('animation-movies'));
  assert.ok(!result.categoryKeys.includes('iranian-movies'));
});

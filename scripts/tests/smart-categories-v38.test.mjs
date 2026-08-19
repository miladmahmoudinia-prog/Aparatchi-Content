import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { classifyCatalogItem } from '../classification.mjs';

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

test('operator sync searches TMDB classification before final publish', () => {
  const source = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');
  assert.ok(source.includes('await enrichOperatorClassificationMetadata();'));
  assert.ok(source.includes("item.operatorClassificationSource = 'tmdb'"));
  assert.ok(source.includes('operatorClassificationNeedsVerification(item)'));
});

test('client bootstrap carries short film category', () => {
  const source = fs.readFileSync('scripts/client-catalog.mjs', 'utf8');
  assert.ok(source.includes("'documentaries', 'short-films', 'wildlife'"));
});

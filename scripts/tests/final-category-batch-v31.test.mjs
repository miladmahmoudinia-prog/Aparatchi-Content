import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCatalogItem } from '../classification.mjs';

const classify = (value) => classifyCatalogItem({
  type: 'movie',
  ir: true,
  nameFa: '',
  name: '',
  overview: '',
  genres: [],
  categoryKeys: [],
  categoryLabels: [],
  ...value,
});

test('verified operator child programs remain in Kids even without a synopsis', () => {
  for (const nameFa of [
    'فیل کوچولوی کم طاقت',
    'نجات فیلی از گودال',
    'راه جنگل',
    'دروغ کوچک',
    'سالی و آواز درخت',
    'لبخند کروکودیل',
    'موزیکال دوستی و مهربونی',
  ]) {
    const result = classify({ nameFa, operatorOnly: true, access: 'operator' });
    assert.ok(result.categoryKeys.includes('kids'), nameFa);
    assert.ok(!result.categoryKeys.includes('programs'), nameFa);
    assert.ok(!result.categoryKeys.includes('iranian-movies'), nameFa);
  }
});

test('ordinary family narrative movies do not become Kids', () => {
  const result = classify({ nameFa: 'قصه یک خانواده', genres: ['درام', 'خانوادگی'] });
  assert.ok(!result.categoryKeys.includes('kids'));
  assert.ok(result.categoryKeys.includes('iranian-movies'));
});

test('Nasser Hejazi documentary is documentary while Parviz Khan remains a narrative film', () => {
  const hejazi = classify({ nameFa: 'من ناصر حجازی هستم', name: 'I Am Nasser Hejazi' });
  assert.ok(hejazi.categoryKeys.includes('documentaries'));
  assert.ok(!hejazi.categoryKeys.includes('iranian-movies'));

  const parviz = classify({ nameFa: 'پرویزخان', name: 'Parviz Khan', genres: ['درام', 'ورزشی'] });
  assert.ok(!parviz.categoryKeys.includes('documentaries'));
  assert.ok(parviz.categoryKeys.includes('iranian-movies'));
});

test('Deep Sea 3D is exclusively Wildlife instead of generic Documentaries', () => {
  const result = classify({ nameFa: 'دریای عمیق', name: 'Deep Sea 3D', isDocumentary: true, genres: ['مستند'] });
  assert.ok(result.categoryKeys.includes('wildlife'));
  assert.ok(!result.categoryKeys.includes('documentaries'));
});

test('Nowruz specials are Programs rather than ordinary movies', () => {
  const result = classify({ nameFa: 'ویژه برنامه نوروز ۱۴۰۱' });
  assert.ok(result.categoryKeys.includes('programs'));
  assert.ok(!result.categoryKeys.includes('movies'));
  assert.ok(!result.categoryKeys.includes('iranian-movies'));
  assert.equal(result.contentKind, 'program');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyVerifiedPersianTitleOverrides,
  isLikelySyntheticPersianDisplayTitle,
} from '../persian-title-overrides.mjs';

test('foreign phonetic Persian labels remain Persian instead of falling back to English', () => {
  const item = {
    id: 'surviving-paradise',
    type: 'movie',
    name: 'Surviving Paradise: A Family Tale',
    nameFa: 'سرویوینگ پارادایس: ا فامیلی تاله',
    countryCodes: ['US'],
    nameFaSource: 'authoritative-metadata',
  };
  assert.equal(isLikelySyntheticPersianDisplayTitle(item), true);
  const catalog = { items: [item] };
  applyVerifiedPersianTitleOverrides(catalog);
  assert.equal(item.nameFa, 'سرویوینگ پارادایس: ا فامیلی تاله');
  assert.equal(item.nameFaSource, 'authoritative-metadata');
});

test('real Persian translations and verified Persian titles are preserved', () => {
  const translated = {
    id: 'example', type: 'movie', name: 'A Family Tale', nameFa: 'داستان یک خانواده', countryCodes: ['US'],
  };
  const verified = {
    id: 'passage', type: 'movie', name: 'The Passage', nameFa: 'گذرگاه', countryCodes: ['US'],
  };
  const iranian = {
    id: 'mastane', type: 'movie', name: 'Mastane', nameFa: 'مستانه', countryCodes: ['IR'],
  };
  assert.equal(isLikelySyntheticPersianDisplayTitle(translated), false);
  assert.equal(isLikelySyntheticPersianDisplayTitle(verified), false);
  assert.equal(isLikelySyntheticPersianDisplayTitle(iranian), false);
  const catalog = { items: [translated, verified, iranian] };
  applyVerifiedPersianTitleOverrides(catalog);
  assert.equal(translated.nameFa, 'داستان یک خانواده');
  assert.equal(verified.nameFa, 'گذرگاه');
  assert.equal(iranian.nameFa, 'مستانه');
});

test('legacy generated Persian markers remain Persian', () => {
  const item = {
    id: 'legacy', type: 'series', name: 'Unknown Original', nameFa: 'عنوان ساختگی',
    nameFaGenerated: true, nameFaSource: 'generated-transliteration', countryCodes: ['US'],
  };
  const catalog = { items: [item] };
  applyVerifiedPersianTitleOverrides(catalog);
  assert.equal(item.nameFa, 'عنوان ساختگی');
  assert.equal(item.nameFaGenerated, true);
  assert.equal(item.nameFaSource, 'generated-transliteration');
});

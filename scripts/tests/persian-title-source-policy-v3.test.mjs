import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyVerifiedPersianTitleOverrides,
  isLikelySyntheticPersianDisplayTitle,
} from '../persian-title-overrides.mjs';

test('full foreign phrase transliteration remains Persian instead of falling back to English', () => {
  const item = {
    id: 'surviving-paradise',
    type: 'movie',
    name: 'Surviving Paradise: A Family Tale',
    nameFa: 'سرویوینگ پارادایس: ا فامیلی تاله',
    countryCodes: ['US'],
    nameFaSource: 'authoritative-metadata',
  };
  assert.equal(isLikelySyntheticPersianDisplayTitle(item), true);
  applyVerifiedPersianTitleOverrides({ items: [item] });
  assert.equal(item.nameFa, 'سرویوینگ پارادایس: ا فامیلی تاله');
  assert.equal(item.nameFaSource, 'authoritative-metadata');
});

test('short proper-name Persian titles are never rejected by phonetic similarity alone', () => {
  const items = [
    { id: 'oppenheimer', type: 'movie', name: 'Oppenheimer', nameFa: 'اوپنهایمر', countryCodes: ['US'] },
    { id: 'john-wick', type: 'movie', name: 'John Wick', nameFa: 'جان ویک', countryCodes: ['US'] },
    { id: 'sita-ramam', type: 'movie', name: 'Sita Ramam', nameFa: 'سیتا رامام', countryCodes: ['IN'] },
    { id: 'pinocchio', type: 'movie', name: 'Pinocchio', nameFa: 'پینوکیو', countryCodes: ['US'] },
  ];
  for (const item of items) assert.equal(isLikelySyntheticPersianDisplayTitle(item), false, item.name);
  applyVerifiedPersianTitleOverrides({ items });
  assert.deepEqual(items.map((item) => item.nameFa), ['اوپنهایمر', 'جان ویک', 'سیتا رامام', 'پینوکیو']);
});

test('real translations, verified titles and Persian-origin titles are preserved', () => {
  const items = [
    { id: 'family', type: 'movie', name: 'A Family Tale', nameFa: 'داستان یک خانواده', countryCodes: ['US'] },
    { id: 'passage', type: 'movie', name: 'The Passage', nameFa: 'گذرگاه', countryCodes: ['US'] },
    { id: 'mastane', type: 'movie', name: 'Mastane', nameFa: 'مستانه', countryCodes: ['IR'] },
  ];
  for (const item of items) assert.equal(isLikelySyntheticPersianDisplayTitle(item), false, item.name);
  applyVerifiedPersianTitleOverrides({ items });
  assert.deepEqual(items.map((item) => item.nameFa), ['داستان یک خانواده', 'گذرگاه', 'مستانه']);
});

test('legacy explicit generated markers remain Persian regardless of phrase length', () => {
  const item = {
    id: 'legacy', type: 'series', name: 'Unknown Original', nameFa: 'عنوان ساختگی',
    nameFaGenerated: true, nameFaSource: 'generated-transliteration', countryCodes: ['US'],
  };
  applyVerifiedPersianTitleOverrides({ items: [item] });
  assert.equal(item.nameFa, 'عنوان ساختگی');
  assert.equal(item.nameFaGenerated, true);
  assert.equal(item.nameFaSource, 'generated-transliteration');
});

test('legacy English fallback is repaired back to Persian script', () => {
  const item = {
    id: 'elfkins', type: 'movie', name: 'The Elfkins: Baking a Difference',
    nameFa: 'The Elfkins: Baking a Difference', nameFaSource: 'original-title-fallback',
    countryCodes: ['DE'],
  };
  applyVerifiedPersianTitleOverrides({ items: [item] });
  assert.match(item.nameFa, /[\u0600-\u06ff]/u);
  assert.doesNotMatch(item.nameFa, /\p{Script=Latin}/u);
  assert.equal(item.nameFaGenerated, true);
  assert.equal(item.nameFaSource, 'generated-transliteration');
});

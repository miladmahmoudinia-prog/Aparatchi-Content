import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyVerifiedPersianTitleOverrides,
  isLikelySyntheticPersianDisplayTitle,
} from '../persian-title-overrides.mjs';

test('full foreign phrase transliteration falls back to the original title', () => {
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
  assert.equal(item.nameFa, 'Surviving Paradise: A Family Tale');
  assert.equal(item.nameFaSource, 'original-title-fallback');
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

test('legacy explicit generated markers still fall back regardless of phrase length', () => {
  const item = {
    id: 'legacy', type: 'series', name: 'Unknown Original', nameFa: 'عنوان ساختگی',
    nameFaGenerated: true, nameFaSource: 'generated-transliteration', countryCodes: ['US'],
  };
  applyVerifiedPersianTitleOverrides({ items: [item] });
  assert.equal(item.nameFa, 'Unknown Original');
  assert.equal(item.nameFaGenerated, undefined);
  assert.equal(item.nameFaSource, 'original-title-fallback');
});

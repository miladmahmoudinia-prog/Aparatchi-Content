import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyVerifiedPersianTitleOverrides,
  generatedPersianDisplayTitle,
} from '../persian-title-overrides.mjs';
import { repairCatalogTitleCollectionTruth } from '../title-collection-truth-v18.mjs';

test('an existing unmarked Persian movie title is never replaced by heuristic transliteration cleanup', () => {
  const original = 'The Future Story of Love';
  const providerPersian = generatedPersianDisplayTitle(original);
  assert.ok(providerPersian && providerPersian !== original);
  const catalog = {
    items: [{ id: 'future-movie', type: 'movie', name: original, nameFa: providerPersian }],
  };
  applyVerifiedPersianTitleOverrides(catalog);
  assert.equal(catalog.items[0].nameFa, providerPersian);
});

test('an explicitly Aparatchi-generated Persian title may still fall back to the original source title', () => {
  const original = 'The Future Story of Love';
  const catalog = {
    items: [{
      id: 'future-generated',
      type: 'movie',
      name: original,
      nameFa: generatedPersianDisplayTitle(original),
      nameFaGenerated: true,
    }],
  };
  applyVerifiedPersianTitleOverrides(catalog);
  assert.equal(catalog.items[0].nameFa, original);
});

test('a valid shared Persian franchise base is preserved for future collections', () => {
  const catalog = {
    items: [
      {
        id: 'future-1', type: 'movie', name: 'Future Saga', nameFa: 'حماسه آینده',
        collectionId: 'future', collectionName: 'Future Saga Collection', collectionNameFa: 'مجموعه حماسه آینده',
      },
      {
        id: 'future-2', type: 'movie', name: 'Future Saga 2', nameFa: 'حماسه آینده ۲',
        collectionId: 'future', collectionName: 'Future Saga Collection', collectionNameFa: 'مجموعه حماسه آینده',
      },
    ],
  };
  applyVerifiedPersianTitleOverrides(catalog);
  assert.deepEqual(catalog.items.map((item) => item.collectionNameFa), ['کالکشن حماسه آینده', 'کالکشن حماسه آینده']);
});

test('a future collection still rejects a one-installment title as the collection label', () => {
  const catalog = {
    items: [
      {
        id: 'future-1', type: 'movie', name: 'Future Saga: Chapter One', nameFa: 'حماسه آینده: بخش اول',
        collectionId: 'future', collectionName: 'Future Saga Collection', collectionNameFa: 'مجموعه حماسه آینده: بخش اول',
      },
      {
        id: 'future-2', type: 'movie', name: 'Future Saga: Chapter Two', nameFa: 'حماسه آینده: بخش دوم',
        collectionId: 'future', collectionName: 'Future Saga Collection', collectionNameFa: 'مجموعه حماسه آینده: بخش اول',
      },
    ],
  };
  applyVerifiedPersianTitleOverrides(catalog);
  assert.deepEqual(catalog.items.map((item) => item.collectionNameFa), ['کالکشن Future Saga', 'کالکشن Future Saga']);
});

test('title truth never overwrites an existing Persian movie title just because it contains Latin fragments', async () => {
  const catalog = {
    items: [{
      id: 'mixed-2',
      type: 'movie',
      name: 'Sample 2',
      nameFa: 'نمونه G.R.I.T.',
      collectionId: 'sample',
      collectionName: 'Sample Collection',
      collectionNameFa: 'کالکشن نمونه',
      collectionOrder: 2,
    }],
  };
  await repairCatalogTitleCollectionTruth(catalog, { maxApiRepairs: 0 });
  assert.equal(catalog.items[0].nameFa, 'نمونه G.R.I.T.');
});

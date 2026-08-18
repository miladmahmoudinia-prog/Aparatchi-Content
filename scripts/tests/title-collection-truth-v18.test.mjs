import assert from 'node:assert/strict';
import test from 'node:test';
import { repairCatalogTitleCollectionTruth } from '../title-collection-truth-v18.mjs';

test('movie title is never replaced by its collection label', async () => {
  const catalog = {
    items: [
      {
        id: 'enola-2', type: 'movie', name: 'Enola Holmes 2', nameFa: 'مجموعه انولا هولمز',
        collectionId: 123, collectionName: 'Enola Holmes Collection', collectionNameFa: 'مجموعه انولا هولمز', collectionOrder: 2,
      },
      {
        id: 'enola-3', type: 'movie', name: 'Enola Holmes 3', nameFa: 'انولا هولمز 3',
        collectionId: 123, collectionName: 'Enola Holmes Collection', collectionNameFa: 'مجموعه انولا هولمز', collectionOrder: 3,
      },
    ],
  };
  const result = await repairCatalogTitleCollectionTruth(catalog, { maxApiRepairs: 0 });
  assert.equal(catalog.items[0].nameFa, 'انولا هولمز ۲');
  assert.equal(catalog.items[1].nameFa, 'انولا هولمز ۳');
  assert.equal(catalog.items[0].collectionNameFa, 'کالکشن انولا هولمز');
  assert.equal(result.remainingCollectionLeaks.length, 0);
});

test('known bad Jack in the Box display title is repaired without changing an already usable sequel title', async () => {
  const catalog = {
    items: [
      { id: 'jack-1', type: 'movie', name: 'The Jack in the Box', nameFa: 'شیطونک ورجه‌ای' },
      { id: 'jack-rises', type: 'movie', name: 'The Jack in the Box Rises', nameFa: 'جعبه جهنمی' },
    ],
  };
  await repairCatalogTitleCollectionTruth(catalog, { maxApiRepairs: 0 });
  assert.equal(catalog.items[0].nameFa, 'جعبه اسباب‌بازی');
  assert.equal(catalog.items[1].nameFa, 'جعبه جهنمی');
});

test('unknown collection falls back to its own source name instead of a member title', async () => {
  const catalog = {
    items: [
      {
        id: 'sample-1', type: 'movie', name: 'Sample: Part One', nameFa: 'نمونه: بخش اول',
        collectionId: 'sample', collectionName: 'Sample Collection', collectionNameFa: 'مجموعه نمونه: بخش اول', collectionOrder: 1,
      },
      {
        id: 'sample-2', type: 'movie', name: 'Sample: Part Two', nameFa: 'نمونه: بخش دوم',
        collectionId: 'sample', collectionName: 'Sample Collection', collectionNameFa: 'مجموعه نمونه: بخش اول', collectionOrder: 2,
      },
    ],
  };
  await repairCatalogTitleCollectionTruth(catalog, { maxApiRepairs: 0 });
  assert.deepEqual(catalog.items.map((item) => item.collectionNameFa), ['کالکشن Sample', 'کالکشن Sample']);
  assert.deepEqual(catalog.items.map((item) => item.nameFa), ['نمونه: بخش اول', 'نمونه: بخش دوم']);
});

test('known collection examples never inherit one installment subtitle', async () => {
  const catalog = {
    items: [
      {
        id: 'sponge-1', type: 'movie', name: 'The SpongeBob Movie: Sponge on the Run', nameFa: 'باب اسفنجی: اسفنج در حال فرار',
        collectionId: 99, collectionName: 'SpongeBob Collection', collectionNameFa: 'مجموعه باب اسفنجی: اسفنج در حال فرار',
      },
      {
        id: 'sponge-2', type: 'movie', name: 'The SpongeBob Movie: Search for SquarePants', nameFa: 'فیلم باب اسفنجی: جستجوی شلوار مکعبی',
        collectionId: 99, collectionName: 'SpongeBob Collection', collectionNameFa: 'مجموعه باب اسفنجی: اسفنج در حال فرار',
      },
    ],
  };
  await repairCatalogTitleCollectionTruth(catalog, { maxApiRepairs: 0 });
  assert.deepEqual(catalog.items.map((item) => item.collectionNameFa), ['کالکشن باب اسفنجی', 'کالکشن باب اسفنجی']);
});

test('legitimate franchise first title can equal the collection base', async () => {
  const catalog = {
    items: [
      {
        id: 'batman', type: 'movie', name: 'Batman', nameFa: 'بتمن',
        collectionId: 268, collectionName: 'Batman Collection', collectionNameFa: 'مجموعه بتمن', collectionOrder: 1,
      },
      {
        id: 'batman-returns', type: 'movie', name: 'Batman Returns', nameFa: 'بازگشت بتمن',
        collectionId: 268, collectionName: 'Batman Collection', collectionNameFa: 'مجموعه بتمن', collectionOrder: 2,
      },
    ],
  };
  const result = await repairCatalogTitleCollectionTruth(catalog, { maxApiRepairs: 0 });
  assert.equal(catalog.items[0].nameFa, 'بتمن');
  assert.equal(catalog.items[0].collectionNameFa, 'کالکشن بتمن');
  assert.equal(catalog.items[1].nameFa, 'بازگشت بتمن');
  assert.equal(result.remainingCollectionLeaks.length, 0);
});
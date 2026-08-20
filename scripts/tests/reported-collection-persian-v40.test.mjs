import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyVerifiedPersianTitleOverrides,
  persianCollectionLabelForMembers,
} from '../persian-title-overrides.mjs';

const reportedCollections = [
  ['V/H/S Collection', 'کالکشن وی/اچ/اس'],
  ['The Trolls Collection', 'کالکشن ترول‌ها'],
  ['Taare Zameen Par Collection', 'کالکشن ستاره‌ها روی زمین'],
  ['The Big Trip Collection', 'کالکشن سفر بزرگ'],
  ['The Strangers (Remake) Collection', 'کالکشن غریبه‌ها'],
  ['Greenland Collection', 'کالکشن گرینلند'],
  ['Christmas Thieves Collection', 'کالکشن دزدان کریسمس'],
  ['Bāhubali Collection', 'کالکشن باهوبالی'],
  ['Army of the Dead Collection', 'کالکشن ارتش مردگان'],
  ['The Grudge Collection', 'کالکشن کینه'],
  ['How to Train Your Dragon Collection', 'کالکشن مربی اژدها'],
  ['Breakout Brothers The Collection', 'کالکشن برادران فراری'],
];

test('reported collection headers stay correct and Persian on future syncs', () => {
  const items = reportedCollections.flatMap(([collectionName], index) => [1, 2].map((order) => ({
    id: `${index}-${order}`,
    type: 'movie',
    name: `${collectionName} ${order}`,
    nameFa: `فیلم نمونه ${order}`,
    collectionId: `collection-${index}`,
    collectionName,
    collectionNameFa: collectionName,
    collectionOrder: order,
  })));
  const catalog = { items };

  applyVerifiedPersianTitleOverrides(catalog);

  for (let index = 0; index < reportedCollections.length; index += 1) {
    const expected = reportedCollections[index][1];
    const members = catalog.items.filter((item) => item.collectionId === `collection-${index}`);
    assert.deepEqual(members.map((item) => item.collectionNameFa), [expected, expected]);
    assert.doesNotMatch(expected, /\p{Script=Latin}/u);
  }
});

test('reported bad movie titles are repaired together with their collection', () => {
  const catalog = {
    items: [
      { id: 'trolls', type: 'movie', name: 'Trolls', nameFa: 'ریزغولک ها ۱' },
      { id: 'trolls-3', type: 'movie', name: 'Trolls Band Together', nameFa: 'ترول ها ۳' },
      { id: 'strangers-1', type: 'movie', name: 'The Strangers: Chapter 1', nameFa: 'غریبه ها: فصل 1' },
      { id: 'strangers-2', type: 'movie', name: 'The Strangers: Chapter 2', nameFa: 'غریبه ها : بخش دوم' },
      { id: 'breakout-3', type: 'movie', name: 'Breakout Brothers 3', nameFa: 'برادران بریکوت ۳' },
    ],
  };

  applyVerifiedPersianTitleOverrides(catalog);

  assert.deepEqual(catalog.items.map((item) => item.nameFa), [
    'ترول‌ها',
    'ترول‌ها ۳: متحد با هم',
    'غریبه‌ها: فصل اول',
    'غریبه‌ها: فصل دوم',
    'برادران فراری ۳',
  ]);
});

test('future collections derive a stable shared Persian base and never create an English Persian line', () => {
  const members = [
    {
      id: 'future-1', type: 'movie', name: 'Future Journey: Chapter One', nameFa: 'سفر آینده: بخش اول',
      collectionId: 'future', collectionName: 'Future Journey Collection', collectionNameFa: '', collectionOrder: 1,
    },
    {
      id: 'future-2', type: 'movie', name: 'Future Journey: Chapter Two', nameFa: 'سفر آینده: بخش دوم',
      collectionId: 'future', collectionName: 'Future Journey Collection', collectionNameFa: '', collectionOrder: 2,
    },
  ];

  assert.equal(persianCollectionLabelForMembers(members), 'کالکشن سفر آینده');
  applyVerifiedPersianTitleOverrides({ items: members });
  assert.deepEqual(members.map((item) => item.collectionNameFa), ['کالکشن سفر آینده', 'کالکشن سفر آینده']);
  assert.ok(members.every((item) => !/\p{Script=Latin}/u.test(item.collectionNameFa)));
});

test('a lone late installment is quarantined instead of naming the collection incorrectly', () => {
  const item = {
    id: 'late-sequel',
    type: 'movie',
    name: 'Example Saga: Final Chapter',
    nameFa: 'پایان ماجرا',
    collectionId: 'example-saga',
    collectionName: 'Example Saga Collection',
    collectionNameFa: 'کالکشن Example Saga',
    collectionOrder: 4,
  };

  applyVerifiedPersianTitleOverrides({ items: [item] });

  assert.equal(item.collectionNameFa, undefined);
});

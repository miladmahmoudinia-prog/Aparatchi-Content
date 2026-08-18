import assert from 'node:assert/strict';
import test from 'node:test';
import { applyVerifiedPersianTitleOverrides } from '../persian-title-overrides.mjs';

const COLLECTION_EN = '28 Days/Weeks/Years Later Collection';
const COLLECTION_FA = 'کالکشن ۲۸ روز بعد';
const EXPECTED = new Map([
  ['28 Days Later', '۲۸ روز بعد'],
  ['28 Weeks Later', '۲۸ هفته بعد'],
  ['28 Years Later', '۲۸ سال بعد'],
  ['28 Years Later: The Bone Temple', '۲۸ سال بعد: معبد استخوان'],
]);

test('verified 28 Later titles and collection stay Persian across future sync repairs', () => {
  const catalog = {
    items: [...EXPECTED].map(([name], index) => ({
      id: `later-${index + 1}`,
      type: 'movie',
      name,
      nameFa: index === 1 ? '28 أسبوعا لاحقاً' : `bad-${index}`,
      collectionId: '28-later-fixture',
      collectionName: COLLECTION_EN,
      collectionNameFa: '28 روز بعد',
      collectionOrder: index + 1,
    })),
  };

  const result = applyVerifiedPersianTitleOverrides(catalog);
  assert.ok(result.titleChanges >= 4);
  assert.ok(result.collectionChanges >= 4);
  for (const item of catalog.items) {
    assert.equal(item.nameFa, EXPECTED.get(item.name));
    assert.equal(item.collectionNameFa, COLLECTION_FA);
  }
});
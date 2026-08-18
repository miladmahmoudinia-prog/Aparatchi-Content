import assert from 'node:assert/strict';
import test from 'node:test';
import { applyVerifiedPersianTitleOverrides } from '../persian-title-overrides.mjs';

const COLLECTION_EN = 'The Jester Collection';
const COLLECTION_FA = 'کالکشن دلقک';
const EXPECTED = new Map([
  ['The Jester', 'دلقک'],
  ['The Jester 2', 'دلقک ۲'],
]);

test('verified Jester titles and collection stay Persian across future sync repairs', () => {
  const catalog = {
    items: [...EXPECTED].map(([name], index) => ({
      id: `jester-${index + 1}`,
      type: 'movie',
      name,
      nameFa: index === 0 ? 'The Jester' : 'د جهمستر ۲',
      collectionId: 'jester-fixture',
      collectionName: COLLECTION_EN,
      collectionNameFa: 'د جهمستر',
      collectionOrder: index + 1,
    })),
  };

  const result = applyVerifiedPersianTitleOverrides(catalog);
  assert.ok(result.titleChanges >= 2);
  assert.ok(result.collectionChanges >= 2);
  for (const item of catalog.items) {
    assert.equal(item.nameFa, EXPECTED.get(item.name));
    assert.equal(item.collectionNameFa, COLLECTION_FA);
  }
});
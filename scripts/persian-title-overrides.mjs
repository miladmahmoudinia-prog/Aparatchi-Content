export const VERIFIED_PERSIAN_TITLE_OVERRIDES = new Map([
  ['dance with the jackals 4', 'رقص با شغال‌ها ۴'],
  ['the passage', 'گذرگاه'],
  ['the bloody hundredth', 'صدمین گروه خونین'],
  ['music by john williams', 'موسیقی از جان ویلیامز'],
  ["the devil's climb", 'صعود شیطان'],
  ['the lionheart', 'شیردل'],
  ['our father', 'پدر ما'],
  ['aunt nasrin and heavenly children', 'خاله نسرین و کودکان آسمانی'],
  ["aunt nasrin's songs for kids 4", 'ترانه‌های کودکانه خاله نسرین ۴'],
  ["aunt nasrin's songs for kids 5", 'ترانه‌های کودکانه خاله نسرین ۵'],
  ["aunt nasrin's songs for kids 7", 'ترانه‌های کودکانه خاله نسرین ۷'],
]);

export const VERIFIED_PERSIAN_COLLECTION_OVERRIDES = new Map([
  ['dance with the jackals collection', 'مجموعه رقص با شغال‌ها'],
]);

export function normalizePersianOverrideKey(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function applyVerifiedPersianTitleOverrides(catalog) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  let titleChanges = 0;
  let collectionChanges = 0;

  for (const item of items) {
    const titleOverride = VERIFIED_PERSIAN_TITLE_OVERRIDES.get(
      normalizePersianOverrideKey(item?.name),
    );
    if (titleOverride && item.nameFa !== titleOverride) {
      item.nameFa = titleOverride;
      titleChanges += 1;
    }

    const collectionOverride = VERIFIED_PERSIAN_COLLECTION_OVERRIDES.get(
      normalizePersianOverrideKey(item?.collectionName),
    );
    if (collectionOverride && item.collectionNameFa !== collectionOverride) {
      item.collectionNameFa = collectionOverride;
      collectionChanges += 1;
    }
  }

  return { titleChanges, collectionChanges };
}

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

const VERIFIED_PERSIAN_TITLE_ENTRIES = [
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
];

const VERIFIED_PERSIAN_COLLECTION_ENTRIES = [
  ['dance with the jackals collection', 'مجموعه رقص با شغال‌ها'],
];

export const VERIFIED_PERSIAN_TITLE_OVERRIDES = new Map(
  VERIFIED_PERSIAN_TITLE_ENTRIES.map(([key, value]) => [normalizePersianOverrideKey(key), value]),
);

export const VERIFIED_PERSIAN_COLLECTION_OVERRIDES = new Map(
  VERIFIED_PERSIAN_COLLECTION_ENTRIES.map(([key, value]) => [normalizePersianOverrideKey(key), value]),
);

const hasPersianScript = (value) => /[\u0600-\u06FF]/.test(String(value || ''));
const cleanDisplayText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function collectionMemberOrder(a, b) {
  const aOrder = Number(a?.collectionOrder || 0);
  const bOrder = Number(b?.collectionOrder || 0);
  if (aOrder > 0 && bOrder > 0 && aOrder !== bOrder) return aOrder - bOrder;
  const aYear = Number(a?.year || 0);
  const bYear = Number(b?.year || 0);
  if (aYear !== bYear) return aYear - bYear;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

export function persianCollectionBaseFromTitle(value) {
  let title = cleanDisplayText(value)
    .replace(/\.mp4$/i, '')
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim();
  if (!hasPersianScript(title)) return '';

  // A collection label should be the franchise base, never the numbered
  // installment that happened to be the first item currently in the catalog.
  const separator = title.search(/\s*(?:[:：؛]|\s[-–—]\s)/u);
  if (separator > 1) title = title.slice(0, separator).trim();
  title = title
    .replace(/\s+(?:قسمت|بخش|فصل)\s+(?:[۰-۹0-9]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\s*$/u, '')
    .replace(/\s+[۰-۹0-9]+\s*$/u, '')
    .trim();
  return hasPersianScript(title) ? title : '';
}

function collectionNameLooksLikeInstallment(value, members) {
  const current = cleanDisplayText(value);
  if (!current || !hasPersianScript(current)) return false;
  const normalizedCurrent = normalizePersianOverrideKey(current.replace(/^مجموعه\s+/u, ''));
  const equalsMember = members.some((item) =>
    normalizePersianOverrideKey(item?.nameFa) === normalizedCurrent
  );
  const numbered = /(?:^|\s)(?:قسمت|بخش|فصل)\s+(?:[۰-۹0-9]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\s*$/u.test(current) ||
    /\s[۰-۹0-9]+\s*$/u.test(current);
  return equalsMember || numbered;
}

function deriveMissingPersianCollectionNames(items) {
  const groups = new Map();
  for (const item of items) {
    if (!item?.collectionId) continue;
    const id = String(item.collectionId);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(item);
  }

  let changes = 0;
  for (const members of groups.values()) {
    const hasVerifiedOverride = members.some((item) =>
      VERIFIED_PERSIAN_COLLECTION_OVERRIDES.has(normalizePersianOverrideKey(item?.collectionName))
    );
    if (hasVerifiedOverride) continue;

    const ordered = [...members].sort(collectionMemberOrder);
    const currentPersian = members
      .map((item) => cleanDisplayText(item?.collectionNameFa))
      .find(hasPersianScript) || '';
    if (currentPersian && !collectionNameLooksLikeInstallment(currentPersian, members)) continue;

    const source = ordered.find((item) => hasPersianScript(item?.nameFa));
    if (!source) continue;
    const base = persianCollectionBaseFromTitle(source.nameFa);
    if (!base) continue;
    for (const item of members) {
      if (item.collectionNameFa !== base) {
        item.collectionNameFa = base;
        changes += 1;
      }
    }
  }
  return changes;
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

  collectionChanges += deriveMissingPersianCollectionNames(items);
  return { titleChanges, collectionChanges };
}

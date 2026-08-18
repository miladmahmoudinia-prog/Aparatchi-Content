import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const PRE_V28 = '00f4309f8ab169f74901bb9ed81e9578f6e2b9fd';
const OVERRIDES_PATH = 'scripts/persian-title-overrides.mjs';
const TRUTH_PATH = 'scripts/title-collection-truth-v18.mjs';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const hasPersian = (value) => /[\u0600-\u06FF]/.test(clean(value));
const norm = (value) => clean(value)
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\u064B-\u065F\u0670]/g, '')
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();
const stripPrefix = (value) => clean(value).replace(/^(?:مجموعه|کالکشن)\s+/u, '').trim();
const normalizeCollectionLabel = (value) => {
  const text = stripPrefix(value);
  return text ? `کالکشن ${text}` : '';
};
const persianBase = (value) => {
  let title = clean(value).replace(/\.mp4$/i, '').replace(/\s*\([^)]*\)\s*$/u, '').trim();
  if (!hasPersian(title)) return '';
  const separator = title.search(/\s*(?:[:：؛]|\s[-–—]\s)/u);
  if (separator > 1) title = title.slice(0, separator).trim();
  title = title
    .replace(/\s+(?:قسمت|بخش|فصل)\s+(?:[۰-۹0-9]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\s*$/u, '')
    .replace(/\s+[۰-۹0-9]+\s*$/u, '')
    .trim();
  return title;
};
const englishCollectionBase = (value) => clean(value)
  .replace(/\([^)]*\)/g, ' ')
  .replace(/\b(?:films?|movies?)\b/gi, ' ')
  .replace(/\bcollection\b/gi, ' ')
  .replace(/\btrilogy\b/gi, ' ')
  .replace(/\bkoleksiyonu\b/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const englishTitleBase = (value) => clean(value)
  .replace(/\s*(?:[:：؛]|\s[-–—]\s).*$/u, '')
  .replace(/\s+(?:part|chapter|episode)\s+(?:[0-9]+|[ivx]+)\s*$/iu, '')
  .replace(/\s+(?:[0-9]+|[ivx]+)\s*$/iu, '')
  .trim();

function priorCollectionLabelIsSafe(value, members, collectionName) {
  const current = clean(value);
  if (!current || !hasPersian(current)) return false;
  const stripped = stripPrefix(current);
  const normalized = norm(stripped);
  if (!normalized) return false;

  const exact = members.filter((item) => hasPersian(item?.nameFa) && norm(stripPrefix(item.nameFa)) === normalized);
  const baseMatches = members.filter((item) => hasPersian(item?.nameFa) && norm(persianBase(item.nameFa)) === normalized);
  if (baseMatches.length >= 2) return true;

  const hasPartSuffix = /(?:^|\s)(?:قسمت|بخش|فصل)\s+(?:[۰-۹0-9]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\s*$/u.test(stripped);
  const hasNumericSuffix = /\s[۰-۹0-9]+(?:[٫.][۰-۹0-9]+)?\s*$/u.test(stripped);
  const collectionBase = norm(englishCollectionBase(collectionName));
  const legitimateFirstTitle = exact.some((item) => norm(englishTitleBase(item?.name)) === collectionBase);
  if (legitimateFirstTitle) return true;
  if (exact.length || hasPartSuffix || hasNumericSuffix) return false;
  return true;
}

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`patch target not found: ${label}`);
  return next;
}

let overrides = fs.readFileSync(OVERRIDES_PATH, 'utf8');
const titleBlock = `
  ['Justice League: Crisis on Infinite Earths Part One', 'لیگ عدالت: بحران در زمین‌های بی‌نهایت – قسمت اول'],
  ['Justice League: Crisis on Infinite Earths Part Two', 'لیگ عدالت: بحران در زمین‌های بی‌نهایت – قسمت دوم'],
  ['Justice League: Crisis on Infinite Earths Part Three', 'لیگ عدالت: بحران در زمین‌های بی‌نهایت – قسمت سوم'],
  ['Miraculous World: New York, United HeroeZ', 'دنیای دختر کفشدوزکی: ماجراجویی در نیویورک'],
  ['Miraculous World: Shanghai – The Legend of Ladydragon', 'دنیای دختر کفشدوزکی: ماجراجویی در شانگهای'],
  ['Aurora Teagarden Mysteries: How to Con a Con', 'رازهای آرورا تیگاردن: چگونه یک شیاد را فریب دهیم'],
  ['Aurora Teagarden Mysteries: A Lesson in Murder', 'رازهای آرورا تیگاردن: درسی در قتل'],
  ['Two Buddies and a Badger', 'زبر و زرنگ'],
  ['Two Buddies and a Badger 2 - The Great Big Beast', 'زبر و زرنگ ۲: هیولای عظیم'],
  ['A Madea Homecoming', 'بازگشت مادیا به خانه'],
  ["Madea's Destination Wedding", 'مادیا راهی عروسی می‌شود'],
  ['PAW Patrol: The Movie', 'سگ‌های نگهبان'],
  ['PAW Patrol: The Mighty Movie', 'سگ‌های نگهبان: فیلم بزرگ'],
  ['Troll', 'غول'],
  ['Troll 2', 'غول ۲'],`;
if (!overrides.includes("['Justice League: Crisis on Infinite Earths Part Two'")) {
  overrides = replaceRequired(
    overrides,
    /\n\];\n\nconst VERIFIED_PERSIAN_COLLECTION_ENTRIES = \[/,
    `${titleBlock}\n];\n\nconst VERIFIED_PERSIAN_COLLECTION_ENTRIES = [`,
    'title override array end',
  );
}

const collectionBlock = `
  ['Justice League (Tomorrowverse) Collection', 'کالکشن لیگ عدالت (تومارورس)'],
  ['Miraculous World', 'کالکشن دنیای دختر کفشدوزکی'],
  ['Aurora Teagarden Mystery Collection', 'کالکشن رازهای آرورا تیگاردن'],
  ['Knutsen & Ludvigsen Collection', 'کالکشن زبر و زرنگ'],
  ['Madea Collection', 'کالکشن مادیا'],
  ['PAW Patrol (Theatrical) Collection', 'کالکشن سگ‌های نگهبان'],
  ['Troll (2022) Collection', 'کالکشن غول'],`;
if (!overrides.includes("['Aurora Teagarden Mystery Collection', 'کالکشن رازهای آرورا تیگاردن']")) {
  overrides = replaceRequired(
    overrides,
    /\n\];\n\nexport const VERIFIED_PERSIAN_TITLE_OVERRIDES/,
    `${collectionBlock}\n];\n\nexport const VERIFIED_PERSIAN_TITLE_OVERRIDES`,
    'collection override array end',
  );
}

overrides = replaceRequired(
  overrides,
  /function applyGeneratedPersianDisplayTitles\(items\) \{[\s\S]*?\n\}\n\nfunction collectionMemberOrder/,
  `function applyGeneratedPersianDisplayTitles(items) {
  let changes = 0;
  for (const item of items) {
    if (!item || !['movie', 'series'].includes(item.type)) continue;
    const wasGenerated = item.nameFaGenerated === true || item.nameFaSource === GENERATED_TITLE_SOURCE;
    // Existing Persian provider/editor titles are authoritative. Never replace
    // them merely because a phonetic heuristic thinks they look synthetic.
    // Only titles explicitly marked as generated by Aparatchi may fall back.
    if (!wasGenerated) continue;

    const original = cleanDisplayText(item.name);
    if (original && item.nameFa !== original) {
      item.nameFa = original;
      changes += 1;
    }
    delete item.nameFaGenerated;
    item.nameFaSource = 'original-title-fallback';
  }
  return changes;
}

function collectionMemberOrder`,
  'generated Persian title preservation guard',
);

overrides = replaceRequired(
  overrides,
  /function currentPersianCollectionIsSafe\(value, members, collectionName\) \{[\s\S]*?\n\}\nfunction safeFallbackCollectionLabel/,
  `function currentPersianCollectionIsSafe(value, members, collectionName) {
  const current = cleanDisplayText(value);
  if (!current || !hasPersianScript(current)) return false;
  const stripped = current.replace(/^(?:مجموعه|کالکشن)\\s+/u, '').trim();
  const normalizedPersianBase = normalizePersianOverrideKey(stripped);
  if (!normalizedPersianBase) return false;

  const exactMemberTitles = members.filter((item) => {
    const memberFa = cleanDisplayText(item?.nameFa).replace(/^(?:مجموعه|کالکشن)\\s+/u, '').trim();
    return hasPersianScript(memberFa) && normalizePersianOverrideKey(memberFa) === normalizedPersianBase;
  });
  const matchingBases = members.filter((item) =>
    normalizePersianOverrideKey(persianCollectionBaseFromTitle(item?.nameFa)) === normalizedPersianBase
  );

  // A shared Persian base across two or more installments is strong evidence
  // that this is a real franchise label (PAW Patrol, Troll, Miraculous, ...).
  if (matchingBases.length >= 2) return true;

  const hasPartSuffix = /(?:^|\\s)(?:قسمت|بخش|فصل)\\s+(?:[۰-۹0-9]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\\s*$/u.test(stripped);
  const hasNumericSuffix = /\\s[۰-۹0-9]+(?:[٫.][۰-۹0-9]+)?\\s*$/u.test(stripped);
  const collectionBase = normalizePersianOverrideKey(originalCollectionBase(collectionName));
  const legitimateFirstTitle = exactMemberTitles.some((item) =>
    normalizePersianOverrideKey(originalTitleBase(item?.name)) === collectionBase
  );
  if (legitimateFirstTitle) return true;

  // Exact one-installment labels and explicit part/number suffixes are leaks.
  // A distinct simple Persian franchise label is preserved, even if its words
  // are not a literal transliteration of the English collection name.
  if (exactMemberTitles.length || hasPartSuffix || hasNumericSuffix) return false;
  return true;
}
function safeFallbackCollectionLabel`,
  'safe Persian collection preservation guard',
);
fs.writeFileSync(OVERRIDES_PATH, overrides);

let truth = fs.readFileSync(TRUTH_PATH, 'utf8');
truth = replaceRequired(
  truth,
  /function collectionNameLooksLikeMemberLeak\(value, members\) \{[\s\S]*?\n\}\n\nfunction bestLocalCollectionTitle/,
  `function collectionNameLooksLikeMemberLeak(value, members) {
  const current = clean(value);
  if (!current || !hasPersian(current)) return true;
  const stripped = stripCollectionPrefix(current);
  const normalized = key(stripped);
  if (!normalized) return true;

  const exactMemberTitles = members.filter((item) => {
    const memberFa = clean(item?.nameFa);
    return hasPersian(memberFa) && key(stripCollectionPrefix(memberFa)) === normalized;
  });
  const matchingBases = members.filter((item) =>
    hasPersian(item?.nameFa) && key(persianCollectionBaseFromTitle(item?.nameFa)) === normalized
  );
  if (matchingBases.length >= 2) return false;

  const hasPartSuffix = /(?:^|\\s)(?:قسمت|بخش|فصل)\\s+(?:[۰-۹0-9]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\\s*$/u.test(stripped);
  const hasNumericSuffix = /\\s[۰-۹0-9]+(?:[٫.][۰-۹0-9]+)?\\s*$/u.test(stripped);
  if (exactMemberTitles.length) {
    const collectionBase = key(englishCollectionBase(members[0]?.collectionName));
    const legitimateFirstTitle = exactMemberTitles.some((item) =>
      key(englishCollectionBase(item?.name)) === collectionBase
    );
    if (legitimateFirstTitle) return false;
    return true;
  }
  return hasPartSuffix || hasNumericSuffix;
}

function bestLocalCollectionTitle`,
  'title truth collection leak guard',
);
truth = truth.replace(
  "if (/^مجموعه\\s+/u.test(localized) && !/\\bcollection\\b/i.test(clean(item?.name))) return '';",
  "if (/^(?:مجموعه|کالکشن)\\s+/u.test(localized) && !/\\bcollection\\b/i.test(clean(item?.name))) return '';",
);
truth = replaceRequired(
  truth,
  '    const missingPersian = !hasPersian(item.nameFa) || hasLatin(item.nameFa);',
  '    const missingPersian = !hasPersian(item.nameFa);',
  'never overwrite an existing Persian movie title merely for Latin fragments',
);
fs.writeFileSync(TRUTH_PATH, truth);

// Restore every safe Persian title/collection label that v28 changed globally,
// then let verified overrides and the hardened truth pass make final decisions.
const catalog = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));
const before = JSON.parse(execFileSync('git', ['show', `${PRE_V28}:catalog.json`], {
  encoding: 'utf8',
  maxBuffer: 512 * 1024 * 1024,
}));
const oldById = new Map((before.items || []).map((item) => [String(item.id), item]));
let restoredTitles = 0;
for (const item of catalog.items || []) {
  const old = oldById.get(String(item.id));
  if (!old) continue;
  const oldFa = clean(old.nameFa);
  if (!hasPersian(oldFa) || /^(?:مجموعه|کالکشن)\s+/u.test(oldFa)) continue;
  if (clean(item.nameFa) !== oldFa) {
    item.nameFa = oldFa;
    if (old.nameFaSource) item.nameFaSource = old.nameFaSource;
    else delete item.nameFaSource;
    delete item.nameFaGenerated;
    restoredTitles += 1;
  }
}

const oldGroups = new Map();
for (const item of before.items || []) {
  const collectionName = clean(item.collectionName);
  if (!collectionName) continue;
  const key = norm(collectionName);
  if (!oldGroups.has(key)) oldGroups.set(key, []);
  oldGroups.get(key).push(item);
}
const currentGroups = new Map();
for (const item of catalog.items || []) {
  const collectionName = clean(item.collectionName);
  if (!collectionName) continue;
  const key = norm(collectionName);
  if (!currentGroups.has(key)) currentGroups.set(key, []);
  currentGroups.get(key).push(item);
}
let restoredCollections = 0;
for (const [key, members] of currentGroups) {
  const oldMembers = oldGroups.get(key) || [];
  if (!oldMembers.length) continue;
  const labels = [...new Set(oldMembers.map((item) => clean(item.collectionNameFa)).filter(Boolean))];
  if (labels.length !== 1) continue;
  const prior = labels[0];
  const collectionName = clean(oldMembers[0]?.collectionName);
  if (!priorCollectionLabelIsSafe(prior, oldMembers, collectionName)) continue;
  const restored = normalizeCollectionLabel(prior);
  for (const item of members) {
    if (item.collectionNameFa !== restored) {
      item.collectionNameFa = restored;
      restoredCollections += 1;
    }
  }
}
fs.writeFileSync('catalog.json', `${JSON.stringify(catalog, null, 2)}\n`);
console.log(JSON.stringify({ restoredTitles, restoredCollections }, null, 2));

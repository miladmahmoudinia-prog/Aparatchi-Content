import fs from 'node:fs';

const OVERRIDES_PATH = 'scripts/persian-title-overrides.mjs';
const TRUTH_PATH = 'scripts/title-collection-truth-v18.mjs';

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`patch target not found: ${label}`);
  return next;
}

let overrides = fs.readFileSync(OVERRIDES_PATH, 'utf8');

overrides = replaceRequired(
  overrides,
  /function applyGeneratedPersianDisplayTitles\(items\) \{[\s\S]*?\n\}\n\nfunction collectionMemberOrder/,
  `function applyGeneratedPersianDisplayTitles(items) {
  let changes = 0;
  for (const item of items) {
    if (!item || !['movie', 'series'].includes(item.type)) continue;
    const wasGenerated = item.nameFaGenerated === true || item.nameFaSource === GENERATED_TITLE_SOURCE;
    const looksSynthetic = isLikelySyntheticPersianDisplayTitle(item);
    if (!wasGenerated && !looksSynthetic) continue;

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
  'restore established synthetic-title policy',
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

  const hasSeparator = /[:：؛]/u.test(stripped) || /\\s[-–—]\\s/u.test(stripped);
  const hasPartSuffix = /(?:^|\\s)(?:قسمت|بخش|فصل)\\s+(?:[۰-۹0-9]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\\s*$/u.test(stripped);
  const hasNumericSuffix = /\\s[۰-۹0-9]+(?:[٫.][۰-۹0-9]+)?\\s*$/u.test(stripped);

  // A collection label must be a franchise/base label, never an installment
  // subtitle such as «...: بخش اول». Reject that shape before any first-film
  // equivalence check can accidentally bless it.
  if (hasSeparator || hasPartSuffix || hasNumericSuffix) return false;

  const exactMemberTitles = members.filter((item) => {
    const memberFa = cleanDisplayText(item?.nameFa).replace(/^(?:مجموعه|کالکشن)\\s+/u, '').trim();
    return hasPersianScript(memberFa) && normalizePersianOverrideKey(memberFa) === normalizedPersianBase;
  });
  const matchingBases = members.filter((item) =>
    normalizePersianOverrideKey(persianCollectionBaseFromTitle(item?.nameFa)) === normalizedPersianBase
  );

  // A simple shared Persian franchise base is trustworthy and should survive
  // future syncs. It may legitimately equal the first film title (بتمن، غول، ...).
  if (matchingBases.length >= 2) return true;

  const collectionBase = normalizePersianOverrideKey(originalCollectionBase(collectionName));
  const legitimateFirstTitle = exactMemberTitles.some((item) =>
    normalizePersianOverrideKey(originalTitleBase(item?.name)) === collectionBase
  );
  if (legitimateFirstTitle) return true;

  // A distinct simple Persian label is safer than guessing from a member. If
  // it is exactly one unrelated installment title, force the source-collection
  // fallback instead.
  if (exactMemberTitles.length) return false;
  return true;
}
function safeFallbackCollectionLabel`,
  'reject installment-shaped collection labels first',
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

  const hasSeparator = /[:：؛]/u.test(stripped) || /\\s[-–—]\\s/u.test(stripped);
  const hasPartSuffix = /(?:^|\\s)(?:قسمت|بخش|فصل)\\s+(?:[۰-۹0-9]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\\s*$/u.test(stripped);
  const hasNumericSuffix = /\\s[۰-۹0-9]+(?:[٫.][۰-۹0-9]+)?\\s*$/u.test(stripped);
  if (hasSeparator || hasPartSuffix || hasNumericSuffix) return true;

  const exactMemberTitles = members.filter((item) => {
    const memberFa = clean(item?.nameFa);
    return hasPersian(memberFa) && key(stripCollectionPrefix(memberFa)) === normalized;
  });
  const matchingBases = members.filter((item) =>
    hasPersian(item?.nameFa) && key(persianCollectionBaseFromTitle(item?.nameFa)) === normalized
  );
  if (matchingBases.length >= 2) return false;

  if (exactMemberTitles.length) {
    const collectionBase = key(englishCollectionBase(members[0]?.collectionName));
    const legitimateFirstTitle = exactMemberTitles.some((item) =>
      key(englishCollectionBase(item?.name)) === collectionBase
    );
    if (legitimateFirstTitle) return false;
    return true;
  }
  return false;
}

function bestLocalCollectionTitle`,
  'title truth rejects installment-shaped collection names',
);
fs.writeFileSync(TRUTH_PATH, truth);

console.log(JSON.stringify({ restoredSyntheticPolicy: true, hardenedCollectionShapeGuard: true }, null, 2));

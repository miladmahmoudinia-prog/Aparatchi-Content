import fs from 'node:fs/promises';

const overridePath = 'scripts/persian-title-overrides.mjs';
const catalogPath = 'catalog.json';

let source = await fs.readFile(overridePath, 'utf8');

const titleEntries = [
  ['Mission: Impossible - Dead Reckoning Part One', 'مأموریت غیرممکن – روزشمار مرگ قسمت اول'],
  ['Mission: Impossible - The Final Reckoning', 'مأموریت غیرممکن – روزشمار نهایی'],
  ["Rosemary's Baby", 'بچه رزماری'],
  ['Apartment 7A', 'آپارتمان ۷A'],
  ['Erdal and Ece', 'اردال و اجه'],
  ['Erdal ile Ece', 'اردال و اجه'],
  ['Erdal and Ece 2', 'اردال و اجه ۲'],
  ['Erdal ile Ece 2', 'اردال و اجه ۲'],
  ['Enola Holmes', 'انولا هولمز'],
  ['Enola Holmes 2', 'انولا هولمز ۲'],
  ['Enola Holmes 3', 'انولا هولمز ۳'],
  ['One Mile: Chapter One', 'یک مایل: بخش اول'],
  ['One Mile: Chapter Two', 'یک مایل: بخش دوم'],
  ['The Souvenir', 'یادگاری'],
  ['The Souvenir: Part II', 'یادگاری: قسمت دوم'],
  ['The Eternal Daughter', 'دختر ابدی'],
  ['Pushpa: The Rise - Part 1', 'پوشپا: ظهور – قسمت ۱'],
  ['Pushpa 2: The Rule', 'پوشپا ۲: قانون'],
  ['Super Monsters: The New Class', 'ابرهیولاها: کلاس جدید'],
  ["Super Monsters: Santa's Super Monster Helpers", 'ابرهیولاها: دستیاران بابانوئل'],
  ['The SpongeBob Movie: Search for SquarePants', 'فیلم باب اسفنجی: جست‌وجوی شلوار مکعبی'],
  ['The SpongeBob Movie: Sponge on the Run', 'فیلم باب اسفنجی: اسفنج در حال فرار'],
  ['The Jack in the Box', 'جعبه اسباب‌بازی'],
  ['The Jack in the Box Rises', 'جعبه جهنمی'],
  ['Sniper: G.R.I.T. - Global Response & Intelligence Team', 'تک‌تیرانداز: G.R.I.T. – تیم واکنش و اطلاعات جهانی'],
  ['Sniper: The Last Stand', 'تک‌تیرانداز: آخرین سنگر'],
  ['Sniper No Nation', 'تک‌تیرانداز: بی‌وطن'],
];

const collectionEntries = [
  ['dance with the jackals collection', 'کالکشن رقص با شغال‌ها'],
  ['28 Days/Weeks/Years Later Collection', 'کالکشن ۲۸ روز بعد'],
  ['Terrifier Collection', 'کالکشن ترساننده'],
  ['The Jester Collection', 'کالکشن دلقک'],
  ['Mission: Impossible Collection', 'کالکشن مأموریت غیرممکن'],
  ["Rosemary's Baby Collection", 'کالکشن بچه رزماری'],
  ['Erdal ile Ece Koleksiyonu', 'کالکشن اردال و اجه'],
  ['Enola Holmes Collection', 'کالکشن انولا هولمز'],
  ['Admiral Yi Trilogy', 'کالکشن دریاسالار یی سون شین'],
  ['One Mile Collection', 'کالکشن یک مایل'],
  ['The Souvenir Collection', 'کالکشن یادگاری'],
  ['Pushpa Collection', 'کالکشن پوشپا'],
  ['Downton Abbey (Films) Collection', 'کالکشن دانتون ابی'],
  ['Batman Collection', 'کالکشن بتمن'],
  ['Jurassic Park Collection', 'کالکشن پارک ژوراسیک'],
  ['Scream Collection', 'کالکشن جیغ'],
  ['Knives Out Collection', 'کالکشن چاقوکشی'],
  ['Superman Collection', 'کالکشن سوپرمن'],
  ['The Lion King (Reboot) Collection', 'کالکشن شیر شاه'],
  ['Miraculous World', 'کالکشن دنیای میراکلس'],
  ['Miraculous World Collection', 'کالکشن دنیای میراکلس'],
  ['Rurouni Kenshin Collection', 'کالکشن شمشیرزن دوره‌گرد'],
  ['Super Monsters Collection', 'کالکشن ابرهیولاها'],
  ['SpongeBob Collection', 'کالکشن باب اسفنجی'],
  ['The SpongeBob Collection', 'کالکشن باب اسفنجی'],
  ['Jack in the Box Collection', 'کالکشن جعبه اسباب‌بازی'],
  ['Sniper Collection', 'کالکشن تک‌تیرانداز'],
];

function appendEntries(arrayMarker, entries) {
  const start = source.indexOf(arrayMarker);
  if (start < 0) throw new Error(`missing array marker: ${arrayMarker}`);
  const end = source.indexOf('\n];', start);
  if (end < 0) throw new Error(`missing array terminator: ${arrayMarker}`);
  const lines = entries.map(([key, value]) => `  [${JSON.stringify(key)}, ${JSON.stringify(value)}],`).join('\n');
  source = `${source.slice(0, end)}\n${lines}${source.slice(end)}`;
}

appendEntries('const VERIFIED_PERSIAN_TITLE_ENTRIES = [', titleEntries);
appendEntries('const VERIFIED_PERSIAN_COLLECTION_ENTRIES = [', collectionEntries);

const guardStart = source.indexOf('function collectionNameLooksLikeInstallment');
const guardEnd = source.indexOf('\nexport function applyVerifiedPersianTitleOverrides', guardStart);
if (guardStart < 0 || guardEnd < 0) throw new Error('collection derivation block not found');

const safeCollectionGuard = String.raw`function collectionNameLooksLikeInstallment(value) {
  const stripped = cleanDisplayText(value).replace(/^(?:مجموعه|کالکشن)\s+/u, '').trim();
  if (!stripped) return true;
  return /[:：؛]/u.test(stripped)
    || /\s[-–—]\s/u.test(stripped)
    || /(?:^|\s)(?:قسمت|بخش|فصل)\s+(?:[۰-۹0-9]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\s*$/u.test(stripped)
    || /\s[۰-۹0-9]+(?:[٫.][۰-۹0-9]+)?\s*$/u.test(stripped);
}

function originalCollectionBase(value) {
  let text = cleanDisplayText(value);
  if (!text) return '';
  text = text
    .replace(/\s*\((?:films?|movies?)\)\s*collection\s*$/iu, '')
    .replace(/\s+(?:collection|collections|trilogy|film\s+series|movie\s+series|koleksiyonu)\s*$/iu, '')
    .trim();
  return text || cleanDisplayText(value);
}

function originalTitleBase(value) {
  let text = cleanDisplayText(value);
  if (!text) return '';
  const separator = text.search(/\s*(?:[:：؛]|\s[-–—]\s)/u);
  if (separator > 0) text = text.slice(0, separator).trim();
  text = text
    .replace(/\s+(?:part|chapter|episode)\s+(?:[0-9]+|[ivx]+)\s*$/iu, '')
    .replace(/\s+(?:[0-9]+|[ivx]+)\s*$/iu, '')
    .trim();
  return text;
}

function normalizeCollectionLabel(value) {
  const stripped = cleanDisplayText(value).replace(/^(?:مجموعه|کالکشن)\s+/u, '').trim();
  return stripped ? `کالکشن ${stripped}` : '';
}

function currentPersianCollectionIsSafe(value, members, collectionName) {
  const current = cleanDisplayText(value);
  if (!current || !hasPersianScript(current) || collectionNameLooksLikeInstallment(current)) return false;
  const stripped = current.replace(/^(?:مجموعه|کالکشن)\s+/u, '').trim();
  const normalizedPersianBase = normalizePersianOverrideKey(stripped);
  if (!normalizedPersianBase) return false;

  const matchingMemberBases = members.filter((item) =>
    normalizePersianOverrideKey(persianCollectionBaseFromTitle(item?.nameFa)) === normalizedPersianBase
  );
  if (!matchingMemberBases.length) return true;

  // A Persian collection base may legitimately equal the franchise's first
  // film (Batman, Scream, Superman...). Trust it only when the ORIGINAL
  // collection base also equals that member's original-title base. This is
  // what prevents Hansan <- Admiral Yi Trilogy and similar member leaks.
  const collectionBase = normalizePersianOverrideKey(originalCollectionBase(collectionName));
  return matchingMemberBases.some((item) =>
    normalizePersianOverrideKey(originalTitleBase(item?.name)) === collectionBase
  );
}

function safeFallbackCollectionLabel(collectionName) {
  const base = originalCollectionBase(collectionName);
  return base ? `کالکشن ${base}` : '';
}

function deriveMissingPersianCollectionNames(items) {
  const groups = new Map();
  for (const item of items) {
    const identity = cleanDisplayText(item?.collectionId) || cleanDisplayText(item?.collectionName);
    if (!identity) continue;
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(item);
  }

  let changes = 0;
  for (const members of groups.values()) {
    const collectionName = members.map((item) => cleanDisplayText(item?.collectionName)).find(Boolean) || '';
    const verified = VERIFIED_PERSIAN_COLLECTION_OVERRIDES.get(normalizePersianOverrideKey(collectionName));
    let label = cleanDisplayText(verified);

    if (!label) {
      const current = members
        .map((item) => cleanDisplayText(item?.collectionNameFa))
        .find((value) => currentPersianCollectionIsSafe(value, members, collectionName)) || '';
      label = current ? normalizeCollectionLabel(current) : safeFallbackCollectionLabel(collectionName);
    }

    if (!label) continue;
    label = normalizeCollectionLabel(label);
    for (const item of members) {
      if (item.collectionNameFa !== label) {
        item.collectionNameFa = label;
        changes += 1;
      }
    }
  }
  return changes;
}
`;

source = `${source.slice(0, guardStart)}${safeCollectionGuard}${source.slice(guardEnd)}`;
await fs.writeFile(overridePath, source);

const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const items = Array.isArray(catalog.items) ? catalog.items : [];
const normalize = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const findTitle = (name) => items.find((item) => normalize(item?.name) === normalize(name));

function copyCollectionIdentity(target, anchor, order) {
  if (!target || !anchor?.collectionId || !anchor?.collectionName) return false;
  target.collectionId = anchor.collectionId;
  target.collectionName = anchor.collectionName;
  if (order) target.collectionOrder = order;
  delete target.collectionNameFa;
  return true;
}

// The Eternal Daughter is related to The Souvenir characters, but it is not
// The Souvenir Part III. Keep it out of the formal collection. If The Souvenir
// Part I exists locally, restore it next to Part II.
const souvenir = findTitle('The Souvenir');
const souvenir2 = findTitle('The Souvenir: Part II');
const eternal = findTitle('The Eternal Daughter');
if (souvenir2) {
  if (souvenir) copyCollectionIdentity(souvenir, souvenir2, 1);
  souvenir2.collectionOrder = 2;
}
if (eternal && (
  normalize(eternal.collectionName) === normalize('The Souvenir Collection')
  || (souvenir2?.collectionId && eternal.collectionId === souvenir2.collectionId)
)) {
  delete eternal.collectionId;
  delete eternal.collectionName;
  delete eternal.collectionNameFa;
  delete eternal.collectionOrder;
}

// Jack in the Box is a trilogy. If Awakening is already present in Aparatchi,
// make sure it is not omitted from the collection. Never invent the title.
const jack1 = findTitle('The Jack in the Box');
const jack2 = findTitle('The Jack in the Box: Awakening');
const jack3 = findTitle('The Jack in the Box Rises');
const jackAnchor = [jack1, jack3].find((item) => item?.collectionId && item?.collectionName);
if (jackAnchor) {
  if (jack1) copyCollectionIdentity(jack1, jackAnchor, 1);
  if (jack2) copyCollectionIdentity(jack2, jackAnchor, 2);
  if (jack3) copyCollectionIdentity(jack3, jackAnchor, 3);
}

await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(JSON.stringify({ stagedTitleOverrides: titleEntries.length, stagedCollectionOverrides: collectionEntries.length, souvenirPart1Present: Boolean(souvenir), jackAwakeningPresent: Boolean(jack2) }, null, 2));

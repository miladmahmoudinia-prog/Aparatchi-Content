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
  ['twisted metal', 'فلز درهم‌تنیده'],
  ['last appointment', 'آخرین قرار'],
  ['dance with the jackals 4', 'رقص با شغال‌ها ۴'],
  ['the passage', 'گذرگاه'],
  ['the bloody hundredth', 'صدمین گروه خونین'],
  ['music by john williams', 'موسیقی از جان ویلیامز'],
  ["the devil's climb", 'صعود شیطان'],
  ['the lionheart', 'شیردل'],
  ['our father', 'پدر ما'],
  // Upera currently exposes this Korean title in Arabic (حديقة الربيع).
  // Keep the display language consistently Persian.
  ['spring garden', 'باغ بهاری'],
  ['28 Days Later', '۲۸ روز بعد'],
  ['28 Weeks Later', '۲۸ هفته بعد'],
  ['28 Years Later', '۲۸ سال بعد'],
  ['28 Years Later: The Bone Temple', '۲۸ سال بعد: معبد استخوان'],
  ['The Jester', 'دلقک'],
  ['The Jester 2', 'دلقک ۲'],
  ['aunt nasrin and heavenly children', 'خاله نسرین و کودکان آسمانی'],
  ["aunt nasrin's songs for kids 4", 'ترانه‌های کودکانه خاله نسرین ۴'],
  ["aunt nasrin's songs for kids 5", 'ترانه‌های کودکانه خاله نسرین ۵'],
  ["aunt nasrin's songs for kids 7", 'ترانه‌های کودکانه خاله نسرین ۷'],
];

const VERIFIED_PERSIAN_COLLECTION_ENTRIES = [
  ['dance with the jackals collection', 'مجموعه رقص با شغال‌ها'],
  ['28 Days/Weeks/Years Later Collection', 'مجموعه ۲۸ روز بعد'],
  ['The Jester Collection', 'مجموعه دلقک'],
];

export const VERIFIED_PERSIAN_TITLE_OVERRIDES = new Map(
  VERIFIED_PERSIAN_TITLE_ENTRIES.map(([key, value]) => [normalizePersianOverrideKey(key), value]),
);

export const VERIFIED_PERSIAN_COLLECTION_OVERRIDES = new Map(
  VERIFIED_PERSIAN_COLLECTION_ENTRIES.map(([key, value]) => [normalizePersianOverrideKey(key), value]),
);

const hasPersianScript = (value) => /[\u0600-\u06FF]/.test(String(value || ''));
const cleanDisplayText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const GENERATED_TITLE_SOURCE = 'generated-transliteration';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const LATIN_SCRIPT_RE = /\p{Script=Latin}/u;

const TITLE_WORD_OVERRIDES = new Map([
  ['the', 'دِ'], ['a', 'اِ'], ['an', 'اَن'], ['and', 'اَند'], ['or', 'اور'],
  ['of', 'آو'], ['to', 'تو'], ['in', 'این'], ['on', 'آن'], ['at', 'اَت'], ['for', 'فور'],
  ['from', 'فرام'], ['with', 'وید'], ['without', 'ویداوت'], ['into', 'اینتو'], ['beyond', 'بیاند'],
  ['home', 'هوم'], ['run', 'ران'], ['first', 'فرست'], ['last', 'لست'], ['new', 'نیو'], ['old', 'اولد'],
  ['movie', 'مووی'], ['story', 'استوری'], ['legend', 'لجند'], ['love', 'لاو'], ['life', 'لایف'],
  ['death', 'دث'], ['race', 'ریس'], ['baby', 'بیبی'], ['king', 'کینگ'], ['queen', 'کوئین'],
  ['boy', 'بوی'], ['girl', 'گرل'], ['man', 'من'], ['woman', 'وومن'], ['world', 'ورلد'], ['day', 'دی'],
  ['night', 'نایت'], ['summer', 'سامر'], ['winter', 'وینتر'], ['fire', 'فایر'], ['black', 'بلک'],
  ['white', 'وایت'], ['red', 'رد'], ['blue', 'بلو'], ['green', 'گرین'], ['gold', 'گلد'],
]);

const ROMAN_NUMERALS = new Map([
  ['i', '۱'], ['ii', '۲'], ['iii', '۳'], ['iv', '۴'], ['v', '۵'], ['vi', '۶'],
  ['vii', '۷'], ['viii', '۸'], ['ix', '۹'], ['x', '۱۰'],
]);

const VERIFIED_ROMANIZED_IRANIAN_TITLES = new Map([
  ['rejime talaei', 'رژیم طلایی'],
  ['mastane', 'مستانه'],
  ['gerogan', 'گروگان'],
  ['haker', 'هکر'],
  ['tooba', 'طوبی'],
  ['parinaaz', 'پریناز'],
  ['oxidan', 'اکسیدان'],
  ['hattrick', 'هت‌تریک'],
  ['astigmatism', 'آستیگماتیسم'],
  ['nabat', 'نبات'],
]);

const LATIN_PATTERNS = [
  ['tion', 'شن'], ['sion', 'ژن'], ['tch', 'چ'], ['sch', 'ش'], ['sh', 'ش'], ['ch', 'چ'],
  ['zh', 'ژ'], ['kh', 'خ'], ['gh', 'غ'], ['ph', 'ف'], ['th', 'ث'], ['wh', 'و'], ['qu', 'کو'],
  ['ck', 'ک'], ['ng', 'نگ'], ['oo', 'و'], ['ee', 'ی'], ['ea', 'ی'], ['ai', 'ای'], ['ay', 'ای'],
  ['oy', 'اوی'], ['ou', 'او'], ['ow', 'او'], ['au', 'آو'], ['aw', 'آو'], ['ie', 'ی'], ['ei', 'ای'],
  ['er', 'ر'], ['ar', 'ار'], ['or', 'ور'], ['ir', 'یر'], ['ur', 'ر'],
];

const LATIN_CHAR_MAP = {
  a: 'ا', b: 'ب', c: 'ک', d: 'د', e: 'ه', f: 'ف', g: 'گ', h: 'ه', i: 'ی',
  j: 'ج', k: 'ک', l: 'ل', m: 'م', n: 'ن', o: 'و', p: 'پ', q: 'ک', r: 'ر',
  s: 'س', t: 'ت', u: 'و', v: 'و', w: 'و', x: 'کس', y: 'ی', z: 'ز',
};

function toPersianDigits(value) {
  return String(value ?? '').replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

function foldLatin(value) {
  return String(value || '')
    .replace(/ı/g, 'i').replace(/Ł|ł/g, 'l').replace(/Đ|đ/g, 'd')
    .replace(/Ð|ð/g, 'th').replace(/Þ|þ/g, 'th').replace(/Æ|æ/g, 'ae')
    .replace(/Œ|œ/g, 'oe').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function transliterateLatinWord(value) {
  const raw = String(value || '');
  const ascii = foldLatin(raw);
  if (!/[a-z]/.test(ascii)) return toPersianDigits(raw);
  const roman = ROMAN_NUMERALS.get(ascii);
  if (roman && /^[ivx]+$/i.test(raw)) return roman;
  const known = TITLE_WORD_OVERRIDES.get(ascii);
  if (known) return known;

  let rest = ascii;
  let result = '';
  while (rest) {
    let matched = false;
    for (const [latin, persian] of LATIN_PATTERNS) {
      if (rest.startsWith(latin)) {
        result += persian;
        rest = rest.slice(latin.length);
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const char = rest[0];
    result += LATIN_CHAR_MAP[char] || char;
    rest = rest.slice(1);
  }
  return result;
}

export function generatedPersianDisplayTitle(value) {
  const source = cleanDisplayText(value).replace(/\.mp4$/i, '');
  if (!source) return '';
  const normalized = normalizePersianOverrideKey(source);
  const iranianKnown = VERIFIED_ROMANIZED_IRANIAN_TITLES.get(normalized);
  if (iranianKnown) return iranianKnown;

  const folded = source
    .replace(/ı/g, 'i').replace(/Ł|ł/g, 'l').replace(/Đ|đ/g, 'd')
    .replace(/Ð|ð/g, 'th').replace(/Þ|þ/g, 'th').replace(/Æ|æ/g, 'ae')
    .replace(/Œ|œ/g, 'oe').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const converted = folded
    .split(/(\p{Script=Latin}+|\d+|[^\p{Script=Latin}\d]+)/gu)
    .filter((part) => part !== '')
    .map((part) => {
      if (/^\p{Script=Latin}+$/u.test(part)) return transliterateLatinWord(part);
      if (/^\d+$/.test(part)) return toPersianDigits(part);
      return part;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return LATIN_SCRIPT_RE.test(converted) ? '' : converted;
}

function normalizePersianPhonetic(value) {
  return cleanDisplayText(value)
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640\u200C\u200D]/g, '')
    .replace(/[يىئ]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإٱآ]/g, 'ا')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ۀة]/g, 'ه')
    .replace(/[^\u0600-\u06FF0-9]+/g, '')
    .trim();
}

function editDistance(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function titleWordCount(value) {
  return cleanDisplayText(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function itemHasPersianOrigin(item) {
  if (item?.ir === true || item?.isIranian === true) return true;
  const values = [
    item?.country, item?.countryName, item?.countryCode,
    item?.countryCodes, item?.countryLabels, item?.countryNames,
    item?.originalLanguage, item?.original_language, item?.originalLang,
  ];
  const tokens = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (value && typeof value === 'object') {
      for (const key of ['code', 'name', 'iso_3166_1', 'iso_639_1']) visit(value[key]);
      return;
    }
    const text = cleanDisplayText(value).toLowerCase();
    if (text) tokens.push(text);
  };
  for (const value of values) visit(value);
  return tokens.some((token) =>
    token === 'ir' || token === 'iran' || token === 'iranian' || token === 'ایران' ||
    token === 'fa' || token === 'fas' || token === 'per' || token === 'persian' || token === 'فارسی'
  );
}

export function isLikelySyntheticPersianDisplayTitle(item) {
  if (!item || !['movie', 'series'].includes(item.type)) return false;
  const original = cleanDisplayText(item.name);
  const candidate = cleanDisplayText(item.nameFa);
  if (!original || !candidate || !LATIN_SCRIPT_RE.test(original) || !hasPersianScript(candidate)) return false;

  const key = normalizePersianOverrideKey(original);
  const verified = VERIFIED_PERSIAN_TITLE_OVERRIDES.get(key);
  if (verified && normalizePersianOverrideKey(candidate) === normalizePersianOverrideKey(verified)) return false;
  const verifiedIranian = VERIFIED_ROMANIZED_IRANIAN_TITLES.get(key);
  if (verifiedIranian && normalizePersianOverrideKey(candidate) === normalizePersianOverrideKey(verifiedIranian)) return false;
  if (itemHasPersianOrigin(item)) return false;

  // A phonetic Persian spelling can be a legitimate display title for a
  // proper name (Oppenheimer, John Wick, Sita Ramam, ...). Never classify
  // short proper-name titles only because they sound like the Latin source.
  // The bad data we are repairing is full phrase transliteration: three or
  // more Latin words copied phonetically into Persian instead of a real
  // Persian title/translation.
  const originalWordCount = titleWordCount(original);
  const candidateWordCount = titleWordCount(candidate);
  if (originalWordCount < 3 || candidateWordCount < 3) return false;
  if (Math.abs(originalWordCount - candidateWordCount) > 1) return false;

  const generated = generatedPersianDisplayTitle(original);
  const generatedCompact = normalizePersianPhonetic(generated);
  const candidateCompact = normalizePersianPhonetic(candidate);
  if (!generatedCompact || !candidateCompact) return false;
  if (generatedCompact === candidateCompact) return true;

  const longest = Math.max(generatedCompact.length, candidateCompact.length);
  if (longest < 10) return false;
  const similarity = 1 - editDistance(generatedCompact, candidateCompact) / longest;
  const wordGap = Math.abs(titleWordCount(generated) - candidateWordCount);
  return similarity >= 0.72 || (longest >= 14 && similarity >= 0.64 && wordGap <= 1);
}

function applyGeneratedPersianDisplayTitles(items) {
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
  const stripped = current.replace(/^مجموعه\s+/u, '').trim();
  const normalizedCurrent = normalizePersianOverrideKey(stripped);
  if (!normalizedCurrent) return false;

  const hasSeparator = /[:：؛]/u.test(stripped) || /\s[-–—]\s/u.test(stripped);
  const hasPartSuffix = /(?:^|\s)(?:قسمت|بخش|فصل)\s+(?:[۰-۹0-9]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\s*$/u.test(stripped);
  const hasNumericSuffix = /\s[۰-۹0-9]+(?:[٫.][۰-۹0-9]+)?\s*$/u.test(stripped);

  // A franchise base may legitimately equal its first movie title (Batman,
  // Scream, Superman, ...). Only installment-shaped folder labels are bad.
  if (!hasSeparator && !hasPartSuffix && !hasNumericSuffix) return false;

  const equalsMember = members.some((item) =>
    normalizePersianOverrideKey(item?.nameFa) === normalizedCurrent
  );
  if (equalsMember) return true;

  if (hasSeparator) {
    const prefix = stripped.split(/\s*(?:[:：؛]|\s[-–—]\s)\s*/u)[0]?.trim();
    if (prefix && members.some((item) =>
      normalizePersianOverrideKey(persianCollectionBaseFromTitle(item?.nameFa)) === normalizePersianOverrideKey(prefix)
    )) return true;
  }
  return hasPartSuffix || hasNumericSuffix;
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
    const collectionLabel = /^مجموعه\s+/u.test(base) ? base : `مجموعه ${base}`;
    for (const item of members) {
      if (item.collectionNameFa !== collectionLabel) {
        item.collectionNameFa = collectionLabel;
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
    if (titleOverride && (item.nameFa !== titleOverride || item.nameFaGenerated === true)) {
      item.nameFa = titleOverride;
      delete item.nameFaGenerated;
      item.nameFaSource = 'verified-override';
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

  titleChanges += applyGeneratedPersianDisplayTitles(items);
  collectionChanges += deriveMissingPersianCollectionNames(items);
  return { titleChanges, collectionChanges };
}

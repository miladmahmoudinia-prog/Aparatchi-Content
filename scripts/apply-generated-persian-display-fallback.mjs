import fs from 'node:fs/promises';

const sharedPath = 'scripts/persian-title-overrides.mjs';
let shared = await fs.readFile(sharedPath, 'utf8');

const helperAnchor = "const cleanDisplayText = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();\n";
const helperBlock = `${helperAnchor}
const GENERATED_TITLE_SOURCE = 'generated-transliteration';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const LATIN_SCRIPT_RE = /\\p{Script=Latin}/u;

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
  return String(value ?? '').replace(/\\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

function foldLatin(value) {
  return String(value || '')
    .replace(/ı/g, 'i').replace(/Ł|ł/g, 'l').replace(/Đ|đ/g, 'd')
    .replace(/Ð|ð/g, 'th').replace(/Þ|þ/g, 'th').replace(/Æ|æ/g, 'ae')
    .replace(/Œ|œ/g, 'oe').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
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
  const source = cleanDisplayText(value).replace(/\\.mp4$/i, '');
  if (!source) return '';
  const normalized = normalizePersianOverrideKey(source);
  const iranianKnown = VERIFIED_ROMANIZED_IRANIAN_TITLES.get(normalized);
  if (iranianKnown) return iranianKnown;

  const folded = source
    .replace(/ı/g, 'i').replace(/Ł|ł/g, 'l').replace(/Đ|đ/g, 'd')
    .replace(/Ð|ð/g, 'th').replace(/Þ|þ/g, 'th').replace(/Æ|æ/g, 'ae')
    .replace(/Œ|œ/g, 'oe').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  const converted = folded
    .split(/(\\p{Script=Latin}+|\\d+|[^\\p{Script=Latin}\\d]+)/gu)
    .filter((part) => part !== '')
    .map((part) => {
      if (/^\\p{Script=Latin}+$/u.test(part)) return transliterateLatinWord(part);
      if (/^\\d+$/.test(part)) return toPersianDigits(part);
      return part;
    })
    .join('')
    .replace(/\\s+/g, ' ')
    .trim();
  return LATIN_SCRIPT_RE.test(converted) ? '' : converted;
}

function applyGeneratedPersianDisplayTitles(items) {
  let changes = 0;
  for (const item of items) {
    if (!item || !['movie', 'series'].includes(item.type)) continue;
    const current = cleanDisplayText(item.nameFa);
    const currentHasLatin = LATIN_SCRIPT_RE.test(current);
    const needsGenerated = !current || currentHasLatin || item.nameFaGenerated === true;
    if (!needsGenerated) continue;
    if (item.nameFaGenerated === true && current && !currentHasLatin) continue;
    const generated = generatedPersianDisplayTitle(item.name || current);
    if (!generated || LATIN_SCRIPT_RE.test(generated)) continue;
    if (item.nameFa !== generated || item.nameFaGenerated !== true || item.nameFaSource !== GENERATED_TITLE_SOURCE) {
      item.nameFa = generated;
      item.nameFaGenerated = true;
      item.nameFaSource = GENERATED_TITLE_SOURCE;
      changes += 1;
    }
  }
  return changes;
}
`;

if (!shared.includes("const GENERATED_TITLE_SOURCE = 'generated-transliteration';")) {
  if (!shared.includes(helperAnchor)) throw new Error('Shared title helper anchor not found.');
  shared = shared.replace(helperAnchor, helperBlock);
}

const verifiedBefore = `    if (titleOverride && item.nameFa !== titleOverride) {\n      item.nameFa = titleOverride;\n      titleChanges += 1;\n    }`;
const verifiedAfter = `    if (titleOverride && (item.nameFa !== titleOverride || item.nameFaGenerated === true)) {\n      item.nameFa = titleOverride;\n      delete item.nameFaGenerated;\n      item.nameFaSource = 'verified-override';\n      titleChanges += 1;\n    }`;
if (!shared.includes(verifiedAfter)) {
  if (!shared.includes(verifiedBefore)) throw new Error('Verified title override anchor not found.');
  shared = shared.replace(verifiedBefore, verifiedAfter);
}

const returnBefore = `  collectionChanges += deriveMissingPersianCollectionNames(items);\n  return { titleChanges, collectionChanges };`;
const returnAfter = `  titleChanges += applyGeneratedPersianDisplayTitles(items);\n  collectionChanges += deriveMissingPersianCollectionNames(items);\n  return { titleChanges, collectionChanges };`;
if (!shared.includes(returnAfter)) {
  if (!shared.includes(returnBefore)) throw new Error('Shared title return anchor not found.');
  shared = shared.replace(returnBefore, returnAfter);
}
await fs.writeFile(sharedPath, shared, 'utf8');

const enrichPath = 'scripts/enrich-persian-titles.mjs';
let enrich = await fs.readFile(enrichPath, 'utf8');
const needsBefore = `function needsPersianTitle(item) {\n  const value = cleanText(item?.nameFa);\n  return !value || !containsPersian(value) || normalizeTitle(value) === normalizeTitle(item?.name);\n}`;
const needsAfter = `function needsPersianTitle(item) {\n  const value = cleanText(item?.nameFa);\n  return item?.nameFaGenerated === true || !value || !containsPersian(value) || normalizeTitle(value) === normalizeTitle(item?.name);\n}`;
if (!enrich.includes(needsAfter)) {
  if (!enrich.includes(needsBefore)) throw new Error('needsPersianTitle anchor not found.');
  enrich = enrich.replace(needsBefore, needsAfter);
}

const applyBefore = `  if (needsPersianTitle(item) && containsPersian(titleFa)) {\n    item.nameFa = titleFa;\n    titleFilled = 1;\n    didChange = true;\n  }`;
const applyAfter = `  if (needsPersianTitle(item) && containsPersian(titleFa)) {\n    item.nameFa = titleFa;\n    delete item.nameFaGenerated;\n    item.nameFaSource = 'authoritative-metadata';\n    titleFilled = 1;\n    didChange = true;\n  }`;
if (!enrich.includes(applyAfter)) {
  if (!enrich.includes(applyBefore)) throw new Error('Authoritative title apply anchor not found.');
  enrich = enrich.replace(applyBefore, applyAfter);
}
await fs.writeFile(enrichPath, enrich, 'utf8');

console.log('Applied upgradeable generated Persian display-title fallback.');

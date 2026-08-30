const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalize = (value) => clean(value)
  .toLowerCase()
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/ة/g, 'ه')
  .replace(/[أإآ]/g, 'ا')
  .replace(/[‐‑‒–—]/g, '-')
  .replace(/[\u200c\u200f\u202a-\u202e]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const searchable = (value) => normalize(value)
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const includesAny = (textValue, terms) => {
  const text = normalize(textValue);
  return terms.some((termValue) => {
    const term = normalize(termValue);
    if (!term) return false;
    if (/^[a-z0-9 ]+$/i.test(term)) {
      const latinText = text.replace(/[^a-z0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
      return (` ${latinText} `).includes(` ${term} `);
    }
    return text.includes(term);
  });
};

// Some short Persian identity terms (notably «امام») can occur by accident
// inside an unrelated title such as «رامام». Use token boundaries only where
// classification identity depends on those terms, without making all of the
// older Persian keyword matching more restrictive.
const includesWholeTerms = (textValue, terms) => {
  const text = ` ${searchable(textValue)} `;
  return terms.some((termValue) => {
    const term = searchable(termValue);
    return Boolean(term) && text.includes(` ${term} `);
  });
};

const unique = (values) => [...new Set(values.filter(Boolean))];

const MANAGED_KEYS = new Set([
  'movies', 'series', 'iranian-movies', 'foreign-movies', 'iranian-series', 'foreign-series',
  'animation-movies', 'animation-series', 'anime-movies', 'anime-series',
  'korean-movies', 'korean-series', 'indian-movies', 'indian-series', 'japanese-movies',
  'kids', 'religious', 'quran', 'programs', 'talk-shows', 'reality',
  'documentaries', 'short-films', 'wildlife', 'collections',
]);

const MANAGED_LABELS = new Set([
  'فیلم‌ها', 'مجموعه‌ها', 'فیلم ایرانی', 'فیلم خارجی', 'سریال ایرانی', 'سریال خارجی',
  'انیمیشن سینمایی', 'انیمیشن سریالی', 'انیمه سینمایی', 'انیمه سریالی',
  'فیلم کره‌ای', 'سریال کره‌ای', 'فیلم هندی', 'سریال هندی', 'فیلم ژاپنی',
  'کودکان', 'مذهبی و مناسبتی', 'قرآن و ادعیه', 'برنامه‌ها و مسابقه‌ها',
  'تاک‌شو', 'مسابقه و رئالیتی‌شو', 'مستند', 'فیلم کوتاه', 'حیات وحش', 'کالکشن',
]);

export const isManagedCategoryKey = (value) => MANAGED_KEYS.has(clean(value));
export const isManagedCategoryLabel = (value) => MANAGED_LABELS.has(clean(value));

const narrativeTerms = [
  'درام', 'ترسناک', 'وحشت', 'هیجان انگیز', 'هیجان‌انگیز', 'اکشن', 'کمدی', 'عاشقانه',
  'خانوادگی', 'جنایی', 'ماجراجویی', 'علمی تخیلی', 'فانتزی',
  'drama', 'horror', 'thriller', 'action', 'comedy', 'romance', 'family', 'crime',
  'adventure', 'science fiction', 'sci-fi', 'fantasy',
];

const documentaryTerms = ['مستند', 'documentary'];
const documentaryOverviewTerms = [
  'این مستند', 'مستندی درباره', 'مستندی از', 'فیلم مستند', 'روایت مستند', 'مستند درباره',
  'documentary film', 'this documentary',
];
const shortFilmTerms = [
  'فیلم کوتاه', 'فیلم‌کوتاه', 'کوتاه داستانی', 'اثر کوتاه', 'آثار کوتاه',
  'short film', 'short-film', 'short movie',
];
const promotionalTitleTerms = [
  'تیزر جشنواره', 'تیزر رویداد', 'تیزر رسمی', 'تریلر رسمی', 'آنونس',
  'festival teaser', 'official teaser', 'official trailer',
];
const verifiedArghavanShortTitles = new Set([
  'دنیای شیرین', 'لمس جهان', 'محبت بی واژه', 'ملودی چوب', 'معلم معلول',
  'داستان زندگی دو خواهر ناشنوا', 'همنشین آبی', 'داستانی از تلاش و امید', 'دستان گچی',
  'دغدغه', 'یک روز معمولی', 'دورون بی وزنی', 'دورون بی‌وزنی', 'من هم هستم',
  'رنگ زندگی', 'روبیک بی برجسته', 'رقص برگ های بی قرار', 'رقص برگ‌های بی‌قرار',
  'کمیک', 'دنیای تفاوت ها', 'دنیای تفاوت‌ها', 'دنیای شادی', 'دیجیتال',
  'من و موشموشک عمه', 'مسیر دلدادگی', 'مسیر دزدها',
  'من میبینام بدنی ساکت دلی پر از عشق', 'من می‌بینم بدنی ساکت دلی پر از عشق',
].map(normalize));

const childrenProgramTerms = [
  'برنامه کودک', 'برنامه کودکان', 'برنامه کودکانه', 'ترانه کودک', 'ترانه های کودک',
  'ترانه‌های کودک', 'ترانه کودکانه', 'سرود کودک', 'قصه کودک', 'خاله نسرین', 'aunt nasrin',
  'songs for kids', "children's songs", 'childrens songs', 'nursery rhyme', 'nursery rhymes',
  'kids show', "children's program", 'childrens program', 'preschool show',
  'هشتگ خاله سوسکه', 'خاله سوسکه', 'عمو پورنگ', 'کلاه قرمزی', 'فیتیله',
  // Verified operator-only child programs that frequently arrive without a synopsis.
  // Exact title identity keeps ordinary narrative films out of Kids.
  'فیل کوچولوی کم طاقت', 'فیل کوچولوی کم‌طاقت', 'نجات فیلی از گودال',
  'راه جنگل', 'دروغ کوچک', 'فینبار و کرم شبتاب', 'فینیارو و کرم شبتاب',
  'سالی و آواز درخت', 'لبخند کروکودیل', 'موزیکال دوستی و مهربونی',
  'موزیکال دوستی و مهربانی',
];

const generalProgramTerms = [
  // Keep this identity narrow: generic "special" is also used by real movies
  // and animation films (for example a Christmas special). Only established
  // Nowruz-program wording is strong enough to override movie identity.
  'ویژه برنامه نوروز', 'ویژه‌برنامه نوروز', 'برنامه نوروزی', 'برنامه نوروز',
  'nowruz special',
];
const talkShowTerms = ['تاک شو', 'تاک‌شو', 'talk show'];
const realityTerms = [
  'رئالیتی شو', 'رئالیتی‌شو', 'مسابقه تلویزیونی', 'مسابقه واقع نما', 'مسابقه واقع‌نما',
  'reality show', 'reality tv', 'game show', 'talent show', 'competition show',
  'مسابقه مافیا', 'شب های مافیا', 'شب‌های مافیا', 'سیزده شمالی', '13 shomali',
  'مسابقه بین دو گروه', 'رقابت بین دو گروه', 'شرکت کنندگان با هم رقابت',
];

const quranTerms = ['قرآن', 'قرآنی', 'ترتیل', 'تلاوت', 'quran', 'recitation'];
const religiousProgramTerms = ['ادعیه', 'دعای', 'دعا', 'مداحی', 'نوحه', 'زیارت', 'ترتیل', 'تلاوت'];
const religiousTerms = [...religiousProgramTerms, 'مذهبی', 'عاشورا', 'کربلا', 'پیامبر', 'نبی', 'امام', 'religious'];
const knownReligiousTitleTerms = [
  'ملک سلیمان', 'the kingdom of solomon',
  'یوسف پیامبر', 'prophet joseph',
  'مختارنامه', 'mokhtarnameh',
  'محمد رسول الله', 'muhammad the messenger of god',
  'مریم مقدس', 'saint mary',
  'ولایت عشق',
];

const wildlifeStrongTerms = [
  'حیات وحش', 'حیات‌وحش', 'جانوران وحشی', 'حیوانات وحشی', 'دنیای حیوانات', 'دنیای جانوران',
  'حیات جانوری', 'گونه های جانوری', 'گونه‌های جانوری', 'زیستگاه حیوانات', 'زیستگاه جانوران',
  'wildlife', 'wild animals', 'animal kingdom', 'natural history', 'nature documentary',
  'marine life', 'ocean life', 'underwater wildlife', 'planet earth', 'our planet',
  'deep sea 3d', 'دریای عمیق',
];
const wildlifeSubjectTerms = [
  'leopard', 'leopards', 'cheetah', 'cheetahs', 'lion', 'lions', 'tiger', 'tigers',
  'wolf', 'wolves', 'bear', 'bears', 'shark', 'sharks', 'whale', 'whales', 'dolphin', 'dolphins',
  'elephant', 'elephants', 'gorilla', 'gorillas', 'penguin', 'penguins', 'birdlife',
  'bee', 'bees', 'bumblebee', 'insect', 'insects', 'bird', 'birds', 'fish', 'reptile', 'reptiles',
  'mammal', 'mammals', 'amphibian', 'amphibians', 'coral', 'octopus', 'turtle', 'turtles',
  'squirrel', 'squirrels', 'otter', 'otters', 'rodent', 'rodents',
  'snake', 'snakes', 'crocodile', 'crocodiles', 'alligator', 'alligators',
  'پلنگ', 'یوزپلنگ', 'شیرها', 'ببرها', 'گرگ ها', 'گرگ‌ها', 'خرس ها', 'خرس‌ها',
  'مار', 'مارها', 'تمساح', 'تمساح‌ها', 'کروکودیل', 'کروکودیل‌ها',
  'کوسه', 'نهنگ', 'دلفین', 'فیل ها', 'فیل‌ها', 'گوریل', 'پنگوئن', 'پرندگان وحشی',
  'زنبور', 'زنبورها', 'حشرات', 'پرنده', 'پرندگان', 'ماهی', 'ماهیان', 'خزندگان', 'پستانداران',
  'دوزیستان', 'لاک پشت', 'لاک‌پشت', 'مرجان', 'اختاپوس',
  'سنجاب', 'سنجاب ها', 'سنجاب‌ها', 'سمور', 'سمورها', 'موش صحرایی', 'جوندگان',
];
const wildlifeWeakHabitatTerms = [
  'طبیعت', 'جنگل', 'اقیانوس', 'دریا', 'ساوانا', 'زیست بوم', 'زیست‌بوم',
  'nature', 'forest', 'ocean', 'sea', 'savanna', 'ecosystem', 'habitat',
];
const wildlifeAnimalContextTerms = [
  'حیوان', 'حیوانات', 'جانور', 'جانوران', 'گونه', 'شکارچی', 'حیات جانوری',
  'animal', 'animals', 'species', 'predator', 'fauna', 'creature',
];
const wildlifeEcologyTerms = [
  'زیستگاه', 'اکوسیستم', 'زیست بوم', 'زیست‌بوم', 'انقراض', 'در معرض انقراض', 'حفاظت از گونه',
  'جمعیت جانوری', 'رفتار جانوران', 'مهاجرت جانوران', 'چرخه زندگی', 'چرخهٔ زندگی', 'تولید مثل',
  'شکار و بقا', 'زنجیره غذایی', 'تنوع زیستی', 'محیط طبیعی',
  'habitat', 'ecosystem', 'endangered', 'extinction', 'conservation', 'biodiversity',
  'animal behavior', 'animal behaviour', 'migration', 'breeding', 'life cycle', 'food chain',
  'natural environment', 'survival in the wild',
];

const indianLanguages = new Set(['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu', 'ur']);

const CLASSIC_COMEDY_COLLECTIONS = [
  {
    id: 'classic:laurel-and-hardy',
    name: 'Laurel and Hardy Collection',
    nameFa: 'کالکشن لورل و هاردی',
    people: [
      ['stan laurel', 'استن لورل'],
      ['oliver hardy', 'اولیور هاردی'],
    ],
  },
  {
    id: 'classic:charlie-chaplin',
    name: 'Charlie Chaplin Collection',
    nameFa: 'کالکشن چارلی چاپلین',
    people: [
      ['charlie chaplin', 'چارلی چاپلین'],
    ],
  },
];

export function classicComedyCollectionFor(input = {}) {
  if (input?.type !== 'movie') return null;
  const genres = Array.isArray(input?.genres) ? input.genres.join(' ') : '';
  if (input?.isDocumentary === true || includesAny(genres, documentaryTerms)) return null;
  const people = (Array.isArray(input?.people) ? input.people : [])
    .filter((person) => person && ['actor', 'director'].includes(clean(person.role)))
    .map((person) => searchable(`${person.name || ''} ${person.nameFa || ''}`));
  for (const collection of CLASSIC_COMEDY_COLLECTIONS) {
    const matchesEveryPerson = collection.people.every((aliases) =>
      people.some((person) => aliases.some((alias) => person.includes(searchable(alias))))
    );
    if (matchesEveryPerson) return { ...collection };
  }
  return null;
}

export function isWildlifeDocumentaryText({ title = '', genres = [], overview = '' } = {}) {
  const normalizedTitle = normalize(title);
  const normalizedOverview = normalize(overview);
  const text = normalize(`${normalizedTitle} ${(genres || []).join(' ')} ${normalizedOverview}`);
  if (includesAny(text, wildlifeStrongTerms)) return true;

  const subjectInTitle = includesAny(normalizedTitle, wildlifeSubjectTerms);
  const specificSubjectInOverview = includesAny(normalizedOverview, wildlifeSubjectTerms);
  const genericAnimalContext = includesAny(normalizedOverview, wildlifeAnimalContextTerms);
  const ecologyContext = includesAny(normalizedOverview, wildlifeEcologyTerms);
  const habitatContext = includesAny(normalizedOverview, wildlifeWeakHabitatTerms);

  // A species in the title of a documentary is a strong signal. When the
  // title is unrelated, the synopsis must contain both an animal subject and
  // ecological/behavioural context. A lone word such as forest, nature,
  // animal or ocean can never move a social/narrative film into Wildlife.
  return subjectInTitle ||
    (specificSubjectInOverview && (ecologyContext || habitatContext)) ||
    (genericAnimalContext && ecologyContext);
}

export function classifyCatalogItem(input = {}) {
  const type = input.type === 'series' ? 'series' : 'movie';
  const forcedForeignTitle = includesAny(`${input.nameFa || ''} ${input.name || ''}`, ['the westies', 'وستی ها', 'وستی‌ها']);
  const genres = Array.isArray(input.genres) ? input.genres.map(clean).filter(Boolean) : [];
  const genreText = normalize(genres.join(' '));
  const titleText = normalize(`${input.nameFa || ''} ${input.name || ''}`);
  const overview = clean(input.overview);
  const existingKind = normalize(input.contentKind);
  const existingKeys = Array.isArray(input.categoryKeys) ? input.categoryKeys.map(clean) : [];
  const validationVersion = Number(input.tmdbValidationVersion || input.validationVersion || 0);
  const trustedTmdb = validationVersion >= 7;
  const operatorClassificationPending = input.operatorClassificationPending === true;
  // The Westies was imported with a stale `ir` flag in an older source row.
  // A known foreign identity must beat that legacy flag everywhere.
  if (forcedForeignTitle) input = { ...input, ir: false, isIranian: false, is_iranian: false };

  const genreSaysAnimation = includesAny(genreText, ['انیمیشن', 'animation']);
  const isAnimation = trustedTmdb ? Boolean(input.isAnimation) : Boolean(genreSaysAnimation || input.isAnimation === true);
  const isAnime = Boolean(isAnimation && input.isAnime === true);

  const narrativeGenre = includesAny(genreText, narrativeTerms);
  const documentaryGenre = includesAny(genreText, documentaryTerms);
  const knownNarrativeMovie = includesAny(titleText, ['مزار شریف', 'mazar sharif']);
  const exactTitleNames = [normalize(input.nameFa), normalize(input.name)].filter(Boolean);
  const verifiedDocumentaryTitleYear = [
    [2023, ['شاهد']],
    [2025, ['عبای سوخته']],
    [2026, ['زنگ میناب']],
    [2024, ['شه بانو']],
    [2025, ['فرزانه جلیسی']],
    [2021, ['فاطمیه در کلیسا']],
    [2024, ['غدیر از کانت تا وایسکه']],
    [2024, ['نجیب زادگی', 'نجیب‌زادگی']],
    [2025, ['سلطان ناصر']],
    [2025, ['اشغال جزایر']],
    [2004, ['اتو استاپ']],
    [2007, ['آزادی در مه']],
    [2006, ['امپراتور و ما']],
    [1967, ['فروغ فرخزاد ۱۳۱۳ ۱۳۴۵', 'فروغ فرخزاد: ۱۳۱۳-۱۳۴۵']],
    [2006, ['پا به پای آزادی']],
  ].some(([year, names]) =>
    Number(input.year || 0) === Number(year) &&
    names.some((name) => exactTitleNames.includes(normalize(name)))
  );
  const documentaryOverviewSignal = includesAny(overview, documentaryOverviewTerms);
  const knownDocumentary = verifiedDocumentaryTitleYear || includesAny(titleText, [
    'از بی', 'از به', 'az be',
    'من ناصر حجازی هستم', 'i am nasser hejazi',
    'deep sea 3d', 'دریای عمیق',
  ]);
  const explicitDocumentary = Boolean(
    input.isDocumentary === true ||
    existingKind === 'documentary' ||
    existingKeys.includes('documentaries')
  );
  // Once TMDB has positively validated a narrative/animation identity, stale
  // legacy documentary flags must not keep the title trapped in Documentaries.
  // Genuine documentaries still stay documentary when TMDB itself says so.
  const trustedNonDocumentary = Boolean(
    trustedTmdb &&
    !documentaryGenre &&
    (narrativeGenre || isAnimation)
  );
  const isDocumentary = knownNarrativeMovie || trustedNonDocumentary
    ? false
    : Boolean(knownDocumentary || explicitDocumentary || documentaryGenre || documentaryOverviewSignal);

  // Program/reality identity must come from the title/genre, not from plot text.
  // A narrative film can be *about* a TV contest without being a game show.
  const programIdentityText = `${titleText} ${genreText}`;
  const trustedSpecializedKind = trustedTmdb && !narrativeGenre;
  const isChildrenProgram = Boolean(
    includesAny(programIdentityText, childrenProgramTerms) ||
    (trustedSpecializedKind && existingKind === 'children-program')
  );
  const isTalkShow = Boolean(
    includesAny(programIdentityText, talkShowTerms) ||
    (trustedSpecializedKind && existingKind === 'talk-show')
  );
  const isRealityCompetition = Boolean(
    includesAny(programIdentityText, realityTerms) ||
    (trustedSpecializedKind && existingKind === 'reality-competition') ||
    (trustedSpecializedKind && existingKeys.includes('reality'))
  );
  const isGeneralProgram = includesAny(programIdentityText, generalProgramTerms) || includesAny(titleText, promotionalTitleTerms);
  const isProgram = !isAnimation && (
    isChildrenProgram || isTalkShow || isRealityCompetition || isGeneralProgram ||
    (trustedSpecializedKind && existingKind === 'program')
  );
  const verifiedArghavanShort = Boolean(
    type === 'movie' &&
    Number(input.year || 0) === 2025 &&
    exactTitleNames.some((name) => verifiedArghavanShortTitles.has(name))
  );
  const verifiedFeatureLengthTitle = Boolean(
    type === 'movie' &&
    Number(input.year || 0) === 2024 &&
    exactTitleNames.includes('2073')
  );
  const runtimeMinutes = Number(input.runtime || input.runtimeMinutes || input.durationMinutes || 0);
  const verifiedFeatureLengthRuntime = Number.isFinite(runtimeMinutes) && runtimeMinutes >= 40;
  const classicComedyCollection = /^classic:(?:laurel-and-hardy|charlie-chaplin)$/i.test(clean(input.collectionId));
  const shortFilmSignal = includesAny(
    `${titleText} ${genreText}`,
    shortFilmTerms,
  );
  const isShortFilm = Boolean(
    type === 'movie' &&
    !isAnimation && !isDocumentary && !isProgram &&
    !verifiedFeatureLengthTitle && !verifiedFeatureLengthRuntime && !classicComedyCollection &&
    (verifiedArghavanShort || shortFilmSignal || existingKind === 'short-film' || existingKeys.includes('short-films'))
  );

  const isQuran = includesAny(titleText, quranTerms);
  const explicitReligiousTitle = includesAny(titleText, knownReligiousTitleTerms);
  const isReligiousProgram = Boolean(
    isQuran ||
    includesAny(titleText, religiousProgramTerms) ||
    (trustedSpecializedKind && existingKind === 'religious-program')
  );
  const isReligious = Boolean(
    isReligiousProgram ||
    explicitReligiousTitle ||
    includesWholeTerms(`${titleText} ${genreText}`, religiousTerms)
  );

  const originalLanguage = normalize(input.originalLanguage);
  const countryCodes = (Array.isArray(input.countryCodes) ? input.countryCodes : [])
    .map((code) => clean(code).toUpperCase()).filter(Boolean);
  // Country arrays include co-production partners. A title must not enter a
  // nationality shelf merely because KR/IN appears somewhere in that array
  // (for example Jexi, Past Lives or The Medium). Original language is the
  // strongest identity signal for Korean/Indian shelves; primary country is
  // only a fallback when language metadata is missing.
  const hasCountryIdentity = countryCodes.length > 0;
  const iranianIdentity = hasCountryIdentity
    ? countryCodes.includes('IR')
    : (originalLanguage === 'fa' || input.ir === true);
  const primaryCountry = countryCodes[0] || '';
  const koreanIdentity = originalLanguage
    ? originalLanguage === 'ko'
    : primaryCountry === 'KR';
  const indianIdentity = originalLanguage
    ? indianLanguages.has(originalLanguage)
    : primaryCountry === 'IN';

  const isWildlife = Boolean(isDocumentary && isWildlifeDocumentaryText({
    title: titleText,
    genres,
    overview,
  }));

  const specialized = isAnimation || isDocumentary || isShortFilm || isProgram || isReligiousProgram;
  const categoryKeys = specialized ? [] : [type === 'movie' ? 'movies' : 'series'];
  const categoryLabels = specialized ? [] : [type === 'movie' ? 'فیلم‌ها' : 'مجموعه‌ها'];

  const regionalEligible = !isAnimation && !isDocumentary && !isShortFilm && !isProgram && !isReligiousProgram && !operatorClassificationPending;
  if (regionalEligible) {
    if (iranianIdentity) {
      categoryKeys.push(type === 'movie' ? 'iranian-movies' : 'iranian-series');
      categoryLabels.push(type === 'movie' ? 'فیلم ایرانی' : 'سریال ایرانی');
    } else if (koreanIdentity) {
      categoryKeys.push(type === 'movie' ? 'korean-movies' : 'korean-series');
      categoryLabels.push(type === 'movie' ? 'فیلم کره‌ای' : 'سریال کره‌ای');
    } else if (indianIdentity && type === 'movie') {
      // Keep only the dedicated Indian movie shelf. Indian series remain fully
      // browsable under foreign-series, as requested by the product UI.
      categoryKeys.push('indian-movies');
      categoryLabels.push('فیلم هندی');
    } else {
      categoryKeys.push(type === 'movie' ? 'foreign-movies' : 'foreign-series');
      categoryLabels.push(type === 'movie' ? 'فیلم خارجی' : 'سریال خارجی');
    }
  }

  if (isAnimation && !isChildrenProgram) {
    if (isAnime) {
      categoryKeys.push(type === 'movie' ? 'anime-movies' : 'anime-series');
      categoryLabels.push(type === 'movie' ? 'انیمه سینمایی' : 'انیمه سریالی');
    } else {
      categoryKeys.push(type === 'movie' ? 'animation-movies' : 'animation-series');
      categoryLabels.push(type === 'movie' ? 'انیمیشن سینمایی' : 'انیمیشن سریالی');
    }
  }
  if (isChildrenProgram) {
    categoryKeys.push('kids');
    categoryLabels.push('کودکان');
  }
  if (isReligious) {
    categoryKeys.push('religious');
    categoryLabels.push('مذهبی و مناسبتی');
    if (isQuran) {
      categoryKeys.push('quran');
      categoryLabels.push('قرآن و ادعیه');
    }
  }
  // Kids already have a dedicated shelf. Do not duplicate them on Home under
  // "برنامه‌ها و مسابقه‌ها" while browse correctly excludes Kids.
  if (isProgram && !isChildrenProgram) {
    categoryKeys.push('programs');
    categoryLabels.push('برنامه‌ها و مسابقه‌ها');
    if (isTalkShow) {
      categoryKeys.push('talk-shows');
      categoryLabels.push('تاک‌شو');
    }
    if (isRealityCompetition) {
      categoryKeys.push('reality');
      categoryLabels.push('مسابقه و رئالیتی‌شو');
    }
  }
  if (isShortFilm) {
    categoryKeys.push('short-films');
    categoryLabels.push('فیلم کوتاه');
  }
  if (isDocumentary) {
    if (isWildlife) {
      categoryKeys.push('wildlife');
      categoryLabels.push('حیات وحش');
    } else {
      categoryKeys.push('documentaries');
      categoryLabels.push('مستند');
    }
  }
  if (type === 'movie' && input.collectionId) {
    categoryKeys.push('collections');
    categoryLabels.push('کالکشن');
  }

  let contentKind = type;
  if (isReligiousProgram) contentKind = 'religious-program';
  else if (isReligious) contentKind = type === 'movie' ? 'religious-movie' : 'religious-series';
  else if (isChildrenProgram) contentKind = 'children-program';
  else if (isRealityCompetition) contentKind = 'reality-competition';
  else if (isTalkShow) contentKind = 'talk-show';
  else if (isProgram) contentKind = 'program';
  else if (isAnime) contentKind = type === 'movie' ? 'anime-movie' : 'anime-series';
  else if (isAnimation) contentKind = type === 'movie' ? 'animation-movie' : 'animation-series';
  else if (isShortFilm) contentKind = 'short-film';
  else if (isDocumentary) contentKind = 'documentary';

  return {
    categoryKeys: unique(categoryKeys),
    categoryLabels: unique(categoryLabels),
    contentKind,
    isAnimation,
    isAnime,
    isDocumentary,
    isShortFilm,
    isWildlife,
    isChildrenProgram,
    isTalkShow,
    isRealityCompetition,
    isProgram,
    ir: iranianIdentity,
    koreanIdentity,
    indianIdentity,
  };
}

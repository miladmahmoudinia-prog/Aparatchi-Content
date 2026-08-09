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

const includesAny = (textValue, terms) => {
  const text = normalize(textValue);
  return terms.some((term) => text.includes(normalize(term)));
};

const unique = (values) => [...new Set(values.filter(Boolean))];

const MANAGED_KEYS = new Set([
  'movies', 'series', 'iranian-movies', 'foreign-movies', 'iranian-series', 'foreign-series',
  'animation-movies', 'animation-series', 'anime-movies', 'anime-series',
  'korean-movies', 'korean-series', 'indian-movies', 'indian-series', 'japanese-movies',
  'kids', 'religious', 'quran', 'programs', 'talk-shows', 'reality',
  'documentaries', 'wildlife', 'collections',
]);

const MANAGED_LABELS = new Set([
  'فیلم‌ها', 'مجموعه‌ها', 'فیلم ایرانی', 'فیلم خارجی', 'سریال ایرانی', 'سریال خارجی',
  'انیمیشن سینمایی', 'انیمیشن سریالی', 'انیمه سینمایی', 'انیمه سریالی',
  'فیلم کره‌ای', 'سریال کره‌ای', 'فیلم هندی', 'سریال هندی', 'فیلم ژاپنی',
  'کودکان', 'مذهبی و مناسبتی', 'قرآن و ادعیه', 'برنامه‌ها و مسابقه‌ها',
  'تاک‌شو', 'مسابقه و رئالیتی‌شو', 'مستند', 'حیات وحش', 'کالکشن',
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

const childrenProgramTerms = [
  'برنامه کودک', 'برنامه کودکان', 'برنامه کودکانه', 'ترانه کودک', 'ترانه های کودک',
  'ترانه‌های کودک', 'ترانه کودکانه', 'سرود کودک', 'قصه کودک', 'خاله نسرین', 'aunt nasrin',
  'songs for kids', "children's songs", 'childrens songs', 'nursery rhyme', 'nursery rhymes',
  'kids show', "children's program", 'childrens program', 'preschool show',
];

const talkShowTerms = ['تاک شو', 'تاک‌شو', 'talk show'];
const realityTerms = [
  'رئالیتی شو', 'رئالیتی‌شو', 'مسابقه تلویزیونی', 'مسابقه واقع نما', 'مسابقه واقع‌نما',
  'reality show', 'reality tv', 'game show', 'talent show', 'competition show',
  'مسابقه مافیا', 'شب های مافیا', 'شب‌های مافیا',
];

const quranTerms = ['قرآن', 'قرآنی', 'ترتیل', 'تلاوت', 'quran', 'recitation'];
const religiousProgramTerms = ['ادعیه', 'دعای', 'دعا', 'مداحی', 'نوحه', 'زیارت', 'ترتیل', 'تلاوت'];
const religiousTerms = [...religiousProgramTerms, 'مذهبی', 'عاشورا', 'کربلا', 'پیامبر', 'نبی', 'امام', 'religious'];

const wildlifeStrongTerms = [
  'حیات وحش', 'حیات‌وحش', 'جانوران وحشی', 'حیوانات وحشی', 'دنیای حیوانات', 'دنیای جانوران',
  'حیات جانوری', 'گونه های جانوری', 'گونه‌های جانوری', 'زیستگاه حیوانات', 'زیستگاه جانوران',
  'wildlife', 'wild animals', 'animal kingdom', 'natural history', 'nature documentary',
  'marine life', 'ocean life', 'underwater wildlife', 'planet earth', 'our planet',
  'leopard', 'leopards', 'cheetah', 'cheetahs', 'lion', 'lions', 'tiger', 'tigers',
  'wolf', 'wolves', 'bear', 'bears', 'shark', 'sharks', 'whale', 'whales', 'dolphin', 'dolphins',
  'elephant', 'elephants', 'gorilla', 'gorillas', 'penguin', 'penguins', 'birdlife',
  'پلنگ', 'یوزپلنگ', 'شیرها', 'ببرها', 'گرگ ها', 'گرگ‌ها', 'خرس ها', 'خرس‌ها',
  'کوسه', 'نهنگ', 'دلفین', 'فیل ها', 'فیل‌ها', 'گوریل', 'پنگوئن', 'پرندگان وحشی',
];
const wildlifeWeakHabitatTerms = [
  'طبیعت', 'جنگل', 'اقیانوس', 'دریا', 'ساوانا', 'زیست بوم', 'زیست‌بوم',
  'nature', 'forest', 'ocean', 'sea', 'savanna', 'ecosystem', 'habitat',
];
const wildlifeAnimalContextTerms = [
  'حیوان', 'حیوانات', 'جانور', 'جانوران', 'گونه', 'شکارچی', 'حیات جانوری',
  'animal', 'animals', 'species', 'predator', 'fauna', 'creature',
];

const indianLanguages = new Set(['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu', 'ur']);

export function isWildlifeDocumentaryText({ title = '', genres = [], overview = '' } = {}) {
  const text = normalize(`${title} ${(genres || []).join(' ')} ${overview}`);
  if (includesAny(text, wildlifeStrongTerms)) return true;
  // Generic habitat words such as "nature", "forest" or "ocean" are not enough.
  // Require an explicit animal/species context as well to avoid social/narrative false positives.
  return includesAny(text, wildlifeWeakHabitatTerms) && includesAny(text, wildlifeAnimalContextTerms);
}

export function classifyCatalogItem(input = {}) {
  const type = input.type === 'series' ? 'series' : 'movie';
  const genres = Array.isArray(input.genres) ? input.genres.map(clean).filter(Boolean) : [];
  const genreText = normalize(genres.join(' '));
  const titleText = normalize(`${input.nameFa || ''} ${input.name || ''}`);
  const overview = clean(input.overview);
  const existingKind = normalize(input.contentKind);
  const existingKeys = Array.isArray(input.categoryKeys) ? input.categoryKeys.map(clean) : [];
  const validationVersion = Number(input.tmdbValidationVersion || input.validationVersion || 0);
  const trustedTmdb = validationVersion >= 7;

  const genreSaysAnimation = includesAny(genreText, ['انیمیشن', 'animation']);
  const isAnimation = trustedTmdb ? Boolean(input.isAnimation) : Boolean(genreSaysAnimation || input.isAnimation === true);
  const isAnime = Boolean(isAnimation && input.isAnime === true);

  const narrativeGenre = includesAny(genreText, narrativeTerms);
  const documentaryGenre = includesAny(genreText, documentaryTerms);
  const isDocumentary = trustedTmdb
    ? Boolean(input.isDocumentary)
    : Boolean(documentaryGenre && !narrativeGenre);

  const programText = `${titleText} ${genreText}`;
  const isChildrenProgram = Boolean(
    !isAnimation &&
    (
      includesAny(programText, childrenProgramTerms) ||
      (trustedTmdb && existingKind === 'children-program')
    )
  );
  const isTalkShow = Boolean(includesAny(programText, talkShowTerms) || (trustedTmdb && existingKind === 'talk-show'));
  const isRealityCompetition = Boolean(
    includesAny(programText, realityTerms) ||
    (trustedTmdb && existingKind === 'reality-competition') ||
    (trustedTmdb && existingKeys.includes('reality'))
  );
  const isProgram = isChildrenProgram || isTalkShow || isRealityCompetition || (trustedTmdb && existingKind === 'program');

  const isQuran = includesAny(titleText, quranTerms);
  const isReligiousProgram = Boolean(isQuran || includesAny(titleText, religiousProgramTerms) || existingKind === 'religious-program');
  const isReligious = Boolean(
    isReligiousProgram || includesAny(`${titleText} ${genreText}`, religiousTerms) ||
    ['religious-movie', 'religious-series'].includes(existingKind)
  );

  const originalLanguage = normalize(input.originalLanguage);
  const countryCodes = (Array.isArray(input.countryCodes) ? input.countryCodes : [])
    .map((code) => clean(code).toUpperCase()).filter(Boolean);
  const primaryCountry = countryCodes[0] || '';
  const iranianIdentity = originalLanguage === 'fa' || primaryCountry === 'IR' ||
    (!originalLanguage && !primaryCountry && input.ir === true);
  const koreanIdentity = originalLanguage === 'ko' || primaryCountry === 'KR';
  const indianIdentity = indianLanguages.has(originalLanguage) || primaryCountry === 'IN';

  const isWildlife = Boolean(isDocumentary && isWildlifeDocumentaryText({
    title: titleText,
    genres,
    overview,
  }));

  const categoryKeys = [type === 'movie' ? 'movies' : 'series'];
  const categoryLabels = [type === 'movie' ? 'فیلم‌ها' : 'مجموعه‌ها'];

  const regionalEligible = !isAnimation && !isDocumentary && !isProgram && !isReligiousProgram;
  if (regionalEligible) {
    if (iranianIdentity) {
      categoryKeys.push(type === 'movie' ? 'iranian-movies' : 'iranian-series');
      categoryLabels.push(type === 'movie' ? 'فیلم ایرانی' : 'سریال ایرانی');
    } else if (koreanIdentity) {
      categoryKeys.push(type === 'movie' ? 'korean-movies' : 'korean-series');
      categoryLabels.push(type === 'movie' ? 'فیلم کره‌ای' : 'سریال کره‌ای');
    } else if (indianIdentity) {
      categoryKeys.push(type === 'movie' ? 'indian-movies' : 'indian-series');
      categoryLabels.push(type === 'movie' ? 'فیلم هندی' : 'سریال هندی');
    } else {
      categoryKeys.push(type === 'movie' ? 'foreign-movies' : 'foreign-series');
      categoryLabels.push(type === 'movie' ? 'فیلم خارجی' : 'سریال خارجی');
    }
  }

  if (isAnimation) {
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
  if (isProgram) {
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
  if (isDocumentary) {
    categoryKeys.push('documentaries');
    categoryLabels.push('مستند');
    if (isWildlife) {
      categoryKeys.push('wildlife');
      categoryLabels.push('حیات وحش');
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
  else if (isAnime) contentKind = type === 'movie' ? 'anime-movie' : 'anime-series';
  else if (isAnimation) contentKind = type === 'movie' ? 'animation-movie' : 'animation-series';
  else if (isDocumentary) contentKind = 'documentary';

  return {
    categoryKeys: unique(categoryKeys),
    categoryLabels: unique(categoryLabels),
    contentKind,
    isAnimation,
    isAnime,
    isDocumentary,
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

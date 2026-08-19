const PLACEHOLDER_OVERVIEW_RE = /^(?:توضیحی\s*ثبت\s*نشده(?:\s*است)?[.!؟]?|توضیحات?\s*ثبت\s*نشده(?:\s*است)?[.!؟]?|خلاصه(?:\s*داستان)?\s*ثبت\s*نشده(?:\s*است)?[.!؟]?|اطلاعاتی\s*ثبت\s*نشده(?:\s*است)?[.!؟]?|بدون\s*توضیح[.!؟]?|no\s+(?:description|overview)(?:\s+(?:available|provided))?[.!?]?|description\s+not\s+available[.!?]?)$/i;

const VERIFIED_OPERATOR_METADATA = [
  {
    type: 'movie',
    year: 2021,
    names: ['کن پامنار'],
    imdb: 'tt27851124',
    overview: 'فیلم «کن پامنار» به زندگی کودکان کار در محله‌های فقیرنشین تهران و بخشی از مشکلات اجتماعی آن‌ها می‌پردازد.',
    people: [
      { id: 'verified-ashkan-darvishi', nameFa: 'اشکان درویشی', role: 'director', roleLabel: 'کارگردان', order: -1, source: 'verified' },
      { id: 'verified-siamak-safari', nameFa: 'سیامک صفری', role: 'actor', roleLabel: 'بازیگر', order: 0, source: 'verified' },
      { id: 'verified-babak-noori', nameFa: 'بابک نوری', role: 'actor', roleLabel: 'بازیگر', order: 1, source: 'verified' },
      { id: 'verified-alireza-ostadi', nameFa: 'علیرضا استادی', role: 'actor', roleLabel: 'بازیگر', order: 2, source: 'verified' },
      { id: 'verified-neda-hosseini', nameFa: 'ندا حسینی', role: 'actor', roleLabel: 'بازیگر', order: 3, source: 'verified' },
      { id: 'verified-siroos-hemati', nameFa: 'سیروس همتی', role: 'actor', roleLabel: 'بازیگر', order: 4, source: 'verified' },
      { id: 'verified-mehdi-tarokh', nameFa: 'مهدی تارخ', role: 'actor', roleLabel: 'بازیگر', order: 5, source: 'verified' },
      { id: 'verified-fariba-kowsari', nameFa: 'فریبا کوثری', role: 'actor', roleLabel: 'بازیگر', order: 6, source: 'verified' },
      { id: 'verified-hossein-sharifi', nameFa: 'حسین شریفی', role: 'actor', roleLabel: 'بازیگر', order: 7, source: 'verified' },
    ],
  },
];

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalizeTitle = (value) => clean(value)
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[\u064B-\u065F\u0670\u0640\u200C\u200D]/g, '')
  .replace(/[يىئ]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/[أإٱآ]/g, 'ا')
  .replace(/[ۀة]/g, 'ه')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const titleNames = (item) => [...new Set([
  normalizeTitle(item?.nameFa),
  normalizeTitle(item?.name),
].filter(Boolean))];

const validImdb = (value) => clean(value).match(/tt\d{6,12}/i)?.[0]?.toLowerCase() || '';
const baseIdentityId = (item) => clean(item?.id).replace(/--operator$/i, '');
const clonePeople = (people) => (Array.isArray(people) ? people : []).map((person) => ({ ...person }));
const cloneArray = (value) => Array.isArray(value) ? value.map((entry) =>
  entry && typeof entry === 'object' ? { ...entry } : entry
) : [];
const hasArrayValue = (value) => Array.isArray(value) && value.some((entry) => clean(entry));

export function isMissingOperatorOverview(value) {
  const text = clean(value);
  return !text || PLACEHOLDER_OVERVIEW_RE.test(text);
}

export function isOperatorMetadataItem(item) {
  return Boolean(
    item?.contentVariant === 'operator' ||
    item?.contentVariant === 'operator-exclusive' ||
    item?.catalogVariant === 'operator' ||
    item?.catalogVariant === 'operator-exclusive' ||
    item?.operatorOnly === true ||
    clean(item?.operatorAccess) ||
    (Array.isArray(item?.categoryKeys) && item.categoryKeys.includes('mobile-operator')) ||
    /--operator$/i.test(clean(item?.id))
  );
}

const meaningfulPeople = (item) => (Array.isArray(item?.people) ? item.people : []).filter((person) =>
  person && ['actor', 'director'].includes(clean(person.role)) && clean(person.nameFa || person.name)
);

const classificationMetadataScore = (item) =>
  (hasArrayValue(item?.genres) ? 3 : 0) +
  (hasArrayValue(item?.countryCodes) ? 2 : 0) +
  (clean(item?.originalLanguage) ? 1 : 0) +
  (item?.isDocumentary === true || item?.contentKind === 'documentary' ? 3 : 0);

const donorQuality = (item) =>
  (isMissingOperatorOverview(item?.overview) ? 0 : 4) +
  Math.min(4, meaningfulPeople(item).length) +
  (validImdb(item?.imdb) ? 2 : 0) +
  classificationMetadataScore(item);

const overrideFor = (item) => {
  const type = clean(item?.type);
  const year = Number(item?.year || 0);
  const names = titleNames(item);
  return VERIFIED_OPERATOR_METADATA.find((entry) =>
    entry.type === type && Number(entry.year) === year &&
    entry.names.some((name) => names.includes(normalizeTitle(name)))
  ) || null;
};

function applyMetadataFrom(item, donor, source, stats) {
  if (!donor) return false;
  let changed = false;
  if (isMissingOperatorOverview(item?.overview) && !isMissingOperatorOverview(donor?.overview)) {
    item.overview = clean(donor.overview);
    stats.overviewFilled += 1;
    changed = true;
  }
  if (meaningfulPeople(item).length === 0 && meaningfulPeople(donor).length > 0) {
    item.people = clonePeople(donor.people);
    stats.peopleFilled += 1;
    changed = true;
  }
  if (!validImdb(item?.imdb) && validImdb(donor?.imdb)) {
    item.imdb = validImdb(donor.imdb);
    stats.imdbFilled += 1;
    changed = true;
  }

  // Operator-only owner-panel rows are frequently only transport shells. Copy
  // descriptive identity from a matched non-operator copy before the global
  // reclassification pass. Media/access fields are intentionally never copied:
  // the operator variant must keep its verified mobile-only links and badge.
  for (const field of ['genres', 'countryCodes', 'countryLabels', 'countryNames']) {
    if (!hasArrayValue(item?.[field]) && hasArrayValue(donor?.[field])) {
      item[field] = cloneArray(donor[field]);
      stats.classificationFieldsFilled += 1;
      changed = true;
    }
  }
  for (const field of ['originalLanguage', 'name']) {
    if (!clean(item?.[field]) && clean(donor?.[field])) {
      item[field] = donor[field];
      stats.classificationFieldsFilled += 1;
      changed = true;
    }
  }
  if (typeof item?.ir !== 'boolean' && typeof donor?.ir === 'boolean') {
    item.ir = donor.ir;
    stats.classificationFieldsFilled += 1;
    changed = true;
  }
  for (const field of ['isDocumentary', 'isAnimation', 'isAnime', 'isWildlife', 'isTalkShow']) {
    if (item?.[field] !== true && donor?.[field] === true) {
      item[field] = true;
      stats.classificationFieldsFilled += 1;
      changed = true;
    }
  }
  if (
    (!clean(item?.contentKind) || ['movie', 'series'].includes(clean(item?.contentKind))) &&
    clean(donor?.contentKind) && !['movie', 'series'].includes(clean(donor?.contentKind))
  ) {
    item.contentKind = donor.contentKind;
    stats.classificationFieldsFilled += 1;
    changed = true;
  }

  if (changed) {
    item.operatorMetadataRepairSource = source;
    item.operatorMetadataRepairVersion = 2;
    stats.changed += 1;
  }
  return changed;
}

export function applyOperatorMetadataRepair(items) {
  const list = Array.isArray(items) ? items : [];
  const stats = {
    operatorItems: 0, changed: 0, overrideMatches: 0, donorMatches: 0,
    overviewFilled: 0, peopleFilled: 0, imdbFilled: 0, classificationFieldsFilled: 0,
  };
  const donorById = new Map();
  const donorByImdb = new Map();
  const donorByTitleYear = new Map();
  const donorByUniqueTitle = new Map();
  const ambiguousTitles = new Set();

  const prefer = (map, key, candidate) => {
    if (!key) return;
    const existing = map.get(key);
    if (!existing || donorQuality(candidate) > donorQuality(existing)) map.set(key, candidate);
  };

  for (const candidate of list) {
    if (!candidate || isOperatorMetadataItem(candidate) || !['movie', 'series'].includes(candidate.type)) continue;
    prefer(donorById, `${candidate.type}|${baseIdentityId(candidate)}`, candidate);
    prefer(donorByImdb, `${candidate.type}|${validImdb(candidate.imdb)}`, candidate);
    const year = Number(candidate.year || 0);
    for (const name of titleNames(candidate)) {
      if (year) prefer(donorByTitleYear, `${candidate.type}|${year}|${name}`, candidate);
      const key = `${candidate.type}|${name}`;
      const existing = donorByUniqueTitle.get(key);
      if (!existing) donorByUniqueTitle.set(key, candidate);
      else if (baseIdentityId(existing) !== baseIdentityId(candidate)) ambiguousTitles.add(key);
      if (donorQuality(candidate) > donorQuality(existing || {})) donorByUniqueTitle.set(key, candidate);
    }
  }
  for (const key of ambiguousTitles) donorByUniqueTitle.delete(key);

  for (const item of list) {
    if (!item || !isOperatorMetadataItem(item) || !['movie', 'series'].includes(item.type)) continue;
    stats.operatorItems += 1;
    const verified = overrideFor(item);
    if (verified) {
      stats.overrideMatches += 1;
      applyMetadataFrom(item, verified, 'verified-override', stats);
    }

    const candidates = [];
    const baseId = baseIdentityId(item);
    if (baseId) candidates.push(['base-id-donor', donorById.get(`${item.type}|${baseId}`)]);
    const imdb = validImdb(item.imdb);
    if (imdb) candidates.push(['imdb-donor', donorByImdb.get(`${item.type}|${imdb}`)]);
    const year = Number(item.year || 0);
    for (const name of titleNames(item)) {
      if (year) candidates.push(['exact-title-year-donor', donorByTitleYear.get(`${item.type}|${year}|${name}`)]);
      candidates.push(['unique-title-donor', donorByUniqueTitle.get(`${item.type}|${name}`)]);
    }
    const donorEntry = candidates
      .filter(([, donor]) => donor)
      .sort((a, b) => donorQuality(b[1]) - donorQuality(a[1]))[0];
    if (!donorEntry) continue;
    stats.donorMatches += 1;
    applyMetadataFrom(item, donorEntry[1], donorEntry[0], stats);
  }
  return stats;
}
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

export function isMissingOperatorOverview(value) {
  const text = clean(value);
  return !text || PLACEHOLDER_OVERVIEW_RE.test(text);
}

export function isOperatorMetadataItem(item) {
  return Boolean(
    item?.contentVariant === 'operator' ||
    item?.catalogVariant === 'operator' ||
    item?.operatorOnly === true ||
    clean(item?.operatorAccess) ||
    (Array.isArray(item?.categoryKeys) && item.categoryKeys.includes('mobile-operator')) ||
    /--operator$/i.test(clean(item?.id))
  );
}

const meaningfulPeople = (item) => (Array.isArray(item?.people) ? item.people : []).filter((person) =>
  person && ['actor', 'director'].includes(clean(person.role)) && clean(person.nameFa || person.name)
);

const clonePeople = (people) => (Array.isArray(people) ? people : []).map((person) => ({ ...person }));

const donorQuality = (item) =>
  (isMissingOperatorOverview(item?.overview) ? 0 : 4) +
  Math.min(4, meaningfulPeople(item).length) +
  (validImdb(item?.imdb) ? 2 : 0);

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
  let changed = false;
  if (isMissingOperatorOverview(item?.overview) && donor && !isMissingOperatorOverview(donor?.overview)) {
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
  if (changed) {
    item.operatorMetadataRepairSource = source;
    item.operatorMetadataRepairVersion = 1;
    stats.changed += 1;
  }
  return changed;
}

export function applyOperatorMetadataRepair(items) {
  const list = Array.isArray(items) ? items : [];
  const stats = { operatorItems:0, changed:0, overrideMatches:0, donorMatches:0, overviewFilled:0, peopleFilled:0, imdbFilled:0 };
  const donorIndex = new Map();
  for (const candidate of list) {
    if (!candidate || isOperatorMetadataItem(candidate) || !['movie', 'series'].includes(candidate.type)) continue;
    const year = Number(candidate.year || 0);
    if (!year) continue;
    for (const name of titleNames(candidate)) {
      const key = `${candidate.type}|${year}|${name}`;
      const existing = donorIndex.get(key);
      if (!existing || donorQuality(candidate) > donorQuality(existing)) donorIndex.set(key, candidate);
    }
  }
  for (const item of list) {
    if (!item || !isOperatorMetadataItem(item) || !['movie', 'series'].includes(item.type)) continue;
    stats.operatorItems += 1;
    const verified = overrideFor(item);
    if (verified) {
      stats.overrideMatches += 1;
      applyMetadataFrom(item, verified, 'verified-override', stats);
    }
    const year = Number(item.year || 0);
    if (!year) continue;
    let donor = null;
    for (const name of titleNames(item)) {
      const candidate = donorIndex.get(`${item.type}|${year}|${name}`);
      if (candidate && (!donor || donorQuality(candidate) > donorQuality(donor))) donor = candidate;
    }
    if (!donor) continue;
    stats.donorMatches += 1;
    applyMetadataFrom(item, donor, 'exact-title-year-donor', stats);
  }
  return stats;
}

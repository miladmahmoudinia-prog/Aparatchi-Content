import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const items = Array.isArray(catalog?.items) ? catalog.items : [];

const text = (value) => String(value || '').trim();
const normalized = (value) => text(value).toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');
const hasPlaceholderOverview = (value) => {
  const v = normalized(value);
  return !v || /توضیحی\s*ثبت\s*نشده|توضیحات?\s*ثبت\s*نشده|خلاصه(?:\s*داستان)?\s*ثبت\s*نشده|اطلاعاتی\s*ثبت\s*نشده|بدون\s*توضیح|no\s+(?:description|overview)|description\s+not\s+available/.test(v);
};

const isIranian = (item) => {
  if (item?.isIranian === true || normalized(item?.region) === 'iranian') return true;
  if ((item?.countryCodes || []).some((code) => String(code).toUpperCase() === 'IR')) return true;
  const haystack = [
    item?.country,
    ...(item?.countries || []),
    ...(item?.categories || []),
    ...(item?.categoryKeys || []),
  ].map(normalized).join(' ');
  return /(^|\s)(ایران|iran|iranian)(\s|$)/.test(haystack) || /iranian-(?:movies|series)/.test(haystack);
};

const isOperatorFile = (file) => /operator-(?:play|download)/.test(String(file?.mode || ''));
const isOperator = (item) => Boolean(
  item?.operatorOnly ||
  item?.operatorAccess ||
  (item?.supportedOperators || []).length ||
  (item?.downloads || []).some((group) => (group?.files || []).some(isOperatorFile))
);

const meaningfulPeople = (item) => (item?.people || []).filter((person) => {
  if (!person || typeof person !== 'object') return false;
  if (!['actor', 'director'].includes(String(person.role || ''))) return false;
  return Boolean(text(person.name) || text(person.nameFa));
});

const targets = items.filter((item) => isIranian(item) || isOperator(item));
const failures = targets.flatMap((item) => {
  const missing = [];
  if (hasPlaceholderOverview(item?.overview)) missing.push('overview');
  if (!meaningfulPeople(item).length) missing.push('people');
  if (!missing.length) return [];
  return [{
    id: String(item?.id || ''),
    type: item?.type,
    nameFa: item?.nameFa,
    name: item?.name,
    year: item?.year,
    iranian: isIranian(item),
    operator: isOperator(item),
    missing,
    overview: text(item?.overview).slice(0, 120),
    peopleCount: meaningfulPeople(item).length,
    tmdb: item?.tmdb || null,
  }];
});

console.log(`AUDIT_TARGETS=${targets.length}`);
console.log(`AUDIT_FAILURES=${failures.length}`);
console.log(JSON.stringify(failures, null, 2));

if (failures.length) {
  throw new Error(`${failures.length} Iranian/operator titles still have missing overview or cast/crew metadata.`);
}

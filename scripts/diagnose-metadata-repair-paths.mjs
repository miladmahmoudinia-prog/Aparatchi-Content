import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const items = Array.isArray(catalog?.items) ? catalog.items : [];
const text = (value) => String(value || '').trim();
const normalize = (value) => text(value)
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/\.mp4$/i, '')
  .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
  .trim();
const hasPersian = (value) => /[\u0600-\u06FF]/.test(text(value));
const placeholderOverview = (value) => {
  const v = normalize(value);
  return !v || /توضیحی ثبت نشده|توضیحات ثبت نشده|خلاصه داستان ثبت نشده|اطلاعاتی ثبت نشده|بدون توضیح|no description|no overview|description not available/.test(v);
};
const meaningfulPeople = (item) => (item?.people || []).filter((person) =>
  person && ['actor','director'].includes(String(person.role || '')) && (text(person.name) || text(person.nameFa))
);
const operator = (item) => Boolean(
  item?.operatorOnly || item?.operatorAccess || (item?.supportedOperators || []).length ||
  (item?.downloads || []).some((g) => (g?.files || []).some((f) => /operator-(?:play|download)/.test(String(f?.mode || ''))))
);
const iranian = (item) => {
  if (item?.isIranian === true || normalize(item?.region) === 'iranian') return true;
  if ((item?.countryCodes || []).some((code) => String(code).toUpperCase() === 'IR')) return true;
  return (item?.categoryKeys || []).some((key) => /^iranian-(?:movies|series)$/.test(String(key)));
};
const incomplete = (item) => placeholderOverview(item?.overview) || !meaningfulPeople(item).length || (iranian(item) && !hasPersian(item?.nameFa));

const byId = new Map(items.map((item) => [String(item?.id || ''), item]));
const bySignature = new Map();
for (const item of items) {
  const names = [normalize(item?.nameFa), normalize(item?.name)].filter(Boolean);
  for (const name of new Set(names)) {
    const key = `${item?.type || ''}|${Number(item?.year || 0)}|${name}`;
    if (!bySignature.has(key)) bySignature.set(key, []);
    bySignature.get(key).push(item);
  }
}

const targets = items.filter((item) => (iranian(item) || operator(item)) && incomplete(item));
let operatorBaseTwin = 0;
let sameTitleTwin = 0;
let twinCanSupplyOverview = 0;
let twinCanSupplyPeople = 0;
let twinCanSupplyPersianTitle = 0;
let cachedTmdbNull = 0;
let tmdbMatchedNoPeople = 0;
let suspiciousIranian = 0;
const samples = {
  operatorBaseTwin: [],
  sameTitleTwin: [],
  noTwin: [],
  suspiciousIranian: [],
};

const obviousForeignPattern = /\b(the westies|genis aile|assignment|stranger|wilderness|knock out|the scorpion)\b/i;

for (const item of targets) {
  const id = String(item?.id || '');
  let twin = null;
  if (id.endsWith('--operator')) {
    const base = byId.get(id.slice(0, -'--operator'.length));
    if (base && base !== item) {
      twin = base;
      operatorBaseTwin += 1;
      if (samples.operatorBaseTwin.length < 12) samples.operatorBaseTwin.push({ id, nameFa: item.nameFa, baseId: base.id, baseNameFa: base.nameFa });
    }
  }
  if (!twin) {
    for (const name of new Set([normalize(item?.nameFa), normalize(item?.name)].filter(Boolean))) {
      const key = `${item?.type || ''}|${Number(item?.year || 0)}|${name}`;
      const candidates = (bySignature.get(key) || []).filter((candidate) => candidate !== item);
      const best = candidates.find((candidate) => !incomplete(candidate)) || candidates[0];
      if (best) { twin = best; break; }
    }
    if (twin) {
      sameTitleTwin += 1;
      if (samples.sameTitleTwin.length < 12) samples.sameTitleTwin.push({ id, nameFa: item.nameFa, twinId: twin.id, twinNameFa: twin.nameFa });
    }
  }

  if (twin) {
    if (placeholderOverview(item?.overview) && !placeholderOverview(twin?.overview)) twinCanSupplyOverview += 1;
    if (!meaningfulPeople(item).length && meaningfulPeople(twin).length) twinCanSupplyPeople += 1;
    if (iranian(item) && !hasPersian(item?.nameFa) && hasPersian(twin?.nameFa)) twinCanSupplyPersianTitle += 1;
  } else if (samples.noTwin.length < 20) {
    samples.noTwin.push({ id, nameFa: item.nameFa, name: item.name, year: item.year, operator: operator(item), tmdb: item.tmdb || null });
  }

  if (item?.tmdb && !meaningfulPeople(item).length) tmdbMatchedNoPeople += 1;
  if (!item?.tmdb) cachedTmdbNull += 1;
  if (iranian(item) && obviousForeignPattern.test(`${item?.nameFa || ''} ${item?.name || ''}`)) {
    suspiciousIranian += 1;
    if (samples.suspiciousIranian.length < 20) samples.suspiciousIranian.push({ id, nameFa: item.nameFa, name: item.name, year: item.year, countryCodes: item.countryCodes, categoryKeys: item.categoryKeys });
  }
}

const result = {
  totalItems: items.length,
  targets: targets.length,
  operatorTargets: targets.filter(operator).length,
  iranianTargets: targets.filter(iranian).length,
  missingOverview: targets.filter((item) => placeholderOverview(item?.overview)).length,
  missingPeople: targets.filter((item) => !meaningfulPeople(item).length).length,
  missingPersianTitle: targets.filter((item) => iranian(item) && !hasPersian(item?.nameFa)).length,
  operatorBaseTwin,
  sameTitleTwin,
  twinCanSupplyOverview,
  twinCanSupplyPeople,
  twinCanSupplyPersianTitle,
  cachedTmdbNull,
  tmdbMatchedNoPeople,
  suspiciousIranian,
  samples,
};
console.log(JSON.stringify(result, null, 2));

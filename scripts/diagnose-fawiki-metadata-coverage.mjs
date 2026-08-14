import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const items = Array.isArray(catalog?.items) ? catalog.items : [];
const IRAN_QID = 'Q794';
const FILM_TYPES = new Set(['Q11424','Q24869','Q24862','Q506240','Q93204','Q202866','Q208569']);
const SERIES_TYPES = new Set(['Q5398426','Q526877','Q1259759','Q581714']);

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (v) => clean(v).toLowerCase().normalize('NFKC')
  .replace(/[\u064B-\u065F\u0670]/g, '')
  .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
  .replace(/\s*\((?:فیلم|مجموعه تلویزیونی|سریال|برنامه تلویزیونی)[^)]*\)\s*$/u, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const hasPersian = (v) => /[\u0600-\u06FF]/.test(clean(v));
const placeholderOverview = (v) => {
  const s = norm(v);
  return !s || /توضیحی ثبت نشده|توضیحات ثبت نشده|خلاصه داستان ثبت نشده|اطلاعاتی ثبت نشده|بدون توضیح|no description|no overview|description not available/.test(s);
};
const people = (item) => (item?.people || []).filter((p) =>
  p && ['actor','director'].includes(String(p.role || '')) && (clean(p.name) || clean(p.nameFa))
);
const operator = (item) => Boolean(item?.operatorOnly || item?.operatorAccess || (item?.supportedOperators || []).length);
const iranian = (item) => Boolean(
  item?.ir === true || item?.isIranian === true ||
  (item?.countryCodes || []).some((c) => String(c).toUpperCase() === 'IR') ||
  (item?.categoryKeys || []).some((k) => /^iranian-(?:movies|series)$/i.test(String(k)))
);
const target = (item) => (iranian(item) || operator(item)) && (placeholderOverview(item?.overview) || !people(item).length);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function faWikiSearch(query) {
  const url = new URL('https://fa.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', `intitle:"${query.replace(/"/g, '')}"`);
  url.searchParams.set('gsrnamespace', '0');
  url.searchParams.set('gsrlimit', '8');
  url.searchParams.set('prop', 'pageprops');
  url.searchParams.set('ppprop', 'wikibase_item');
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Aparatchi-Metadata/1.0 (strict Persian Wikipedia lookup)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`faWiki HTTP ${response.status}`);
  const payload = await response.json();
  return Object.values(payload?.query?.pages || {});
}

async function wikidataEntity(id) {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.searchParams.set('action', 'wbgetentities');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  url.searchParams.set('ids', id);
  url.searchParams.set('props', 'labels|claims|sitelinks');
  url.searchParams.set('languages', 'fa|en');
  url.searchParams.set('sitefilter', 'fawiki|enwiki');
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Aparatchi-Metadata/1.0 (strict Persian Wikipedia lookup)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  return (await response.json())?.entities?.[id] || null;
}

function claimIds(entity, property) {
  return (entity?.claims?.[property] || []).map((claim) => claim?.mainsnak?.datavalue?.value?.id).filter(Boolean);
}
function releaseYears(entity) {
  const years = [];
  for (const claim of entity?.claims?.P577 || []) {
    const time = clean(claim?.mainsnak?.datavalue?.value?.time);
    const match = time.match(/^[+-](\d{4,})-/);
    if (match) years.push(Number(match[1]));
  }
  return [...new Set(years.filter(Number.isFinite))];
}
function entityTitleCandidates(entity, pageTitle) {
  return [...new Set([
    clean(pageTitle),
    clean(entity?.labels?.fa?.value),
    clean(entity?.sitelinks?.fawiki?.title),
    clean(entity?.labels?.en?.value),
    clean(entity?.sitelinks?.enwiki?.title),
  ].filter(Boolean))];
}
function validate(item, entity, pageTitle) {
  if (!entity) return null;
  const expectedTypes = item.type === 'series' ? SERIES_TYPES : FILM_TYPES;
  const types = claimIds(entity, 'P31');
  if (types.length && !types.some((qid) => expectedTypes.has(qid))) return null;
  const years = releaseYears(entity);
  const year = Number(item.year || 0);
  if (!year || !years.length || !years.some((value) => Math.abs(value - year) <= 1)) return null;
  const countries = claimIds(entity, 'P495');
  if (countries.length && !countries.includes(IRAN_QID)) return null;
  const expectedTitles = [item.nameFaGenerated === true ? '' : item.nameFa, item.name].map(norm).filter(Boolean);
  const actualTitles = entityTitleCandidates(entity, pageTitle).map(norm).filter(Boolean);
  if (!expectedTitles.some((title) => actualTitles.includes(title))) return null;
  return {
    years,
    countries,
    directors: claimIds(entity, 'P57'),
    cast: claimIds(entity, 'P161'),
    pageTitle: clean(pageTitle),
    faWikiTitle: clean(entity?.sitelinks?.fawiki?.title),
  };
}

const targets = items.filter(target);
const eligible = targets.filter((item) => item.nameFaGenerated !== true && hasPersian(item.nameFa));
const matches = [];
let errors = 0;

for (let index = 0; index < eligible.length; index += 1) {
  const item = eligible[index];
  let pages = [];
  try { pages = await faWikiSearch(clean(item.nameFa)); }
  catch { errors += 1; continue; }
  await sleep(25);

  let found = null;
  for (const page of pages) {
    const qid = clean(page?.pageprops?.wikibase_item);
    if (!/^Q\d+$/i.test(qid)) continue;
    let entity = null;
    try { entity = await wikidataEntity(qid); }
    catch { errors += 1; continue; }
    await sleep(25);
    const verdict = validate(item, entity, page?.title);
    if (verdict) { found = { qid, ...verdict }; break; }
  }
  if (found) {
    matches.push({
      id: item.id,
      nameFa: item.nameFa,
      name: item.name,
      year: item.year,
      operator: operator(item),
      missingOverview: placeholderOverview(item.overview),
      missingPeople: !people(item).length,
      wikidata: found.qid,
      pageTitle: found.pageTitle,
      years: found.years,
      countries: found.countries,
      directors: found.directors.length,
      cast: found.cast.length,
    });
  }
  if ((index + 1) % 25 === 0) console.log(`PROGRESS=${index + 1}/${eligible.length} MATCHED=${matches.length}`);
}

console.log(JSON.stringify({
  currentTargets: targets.length,
  eligiblePersianTargets: eligible.length,
  strictFaWikiMatches: matches.length,
  matchesWithPeople: matches.filter((m) => m.directors + m.cast > 0).length,
  matchesForMissingPeople: matches.filter((m) => m.missingPeople && m.directors + m.cast > 0).length,
  matchesForMissingOverview: matches.filter((m) => m.missingOverview).length,
  errors,
}, null, 2));
console.log('--- STRICT FAWIKI MATCHES ---');
console.log(JSON.stringify(matches, null, 2));

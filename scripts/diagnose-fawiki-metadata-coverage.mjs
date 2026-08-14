import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const items = Array.isArray(catalog?.items) ? catalog.items : [];
const IRAN_QID = 'Q794';
const FILM_TYPES = new Set(['Q11424','Q24869','Q24862','Q506240','Q93204','Q202866','Q208569']);
const SERIES_TYPES = new Set(['Q5398426','Q526877','Q1259759','Q581714']);
const diagnosticLimit = Math.max(1, Math.min(500, Number(process.env.FAWIKI_DIAG_LIMIT || 500)));

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
const requestHeaders = {
  accept: 'application/json',
  'user-agent': 'Aparatchi-Metadata/1.0 (contact: github.com/miladmahmoudinia-prog/Aparatchi-Content)',
};

async function faWikiSearch(query) {
  const url = new URL('https://fa.wikipedia.org/w/rest.php/v1/search/page');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '8');
  const response = await fetch(url, { headers: requestHeaders, signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    const body = clean(await response.text()).slice(0, 240);
    throw new Error(`faWiki REST HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.pages) ? payload.pages : [];
}

async function wikidataEntityForFaTitle(title) {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.searchParams.set('action', 'wbgetentities');
  url.searchParams.set('format', 'json');
  url.searchParams.set('sites', 'fawiki');
  url.searchParams.set('titles', title);
  url.searchParams.set('props', 'labels|claims|sitelinks');
  url.searchParams.set('languages', 'fa|en');
  url.searchParams.set('sitefilter', 'fawiki|enwiki');
  const response = await fetch(url, { headers: requestHeaders, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  const entities = (await response.json())?.entities || {};
  const entity = Object.values(entities).find((value) => value && value.missing !== '');
  return entity || null;
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
    qid: clean(entity?.id),
    years,
    countries,
    directors: claimIds(entity, 'P57'),
    cast: claimIds(entity, 'P161'),
    pageTitle: clean(pageTitle),
    faWikiTitle: clean(entity?.sitelinks?.fawiki?.title),
  };
}

const targets = items.filter(target);
const allEligible = targets.filter((item) => item.nameFaGenerated !== true && hasPersian(item.nameFa));
const eligible = allEligible.slice(0, diagnosticLimit);
const matches = [];
const errorSamples = [];
let errors = 0;

for (let index = 0; index < eligible.length; index += 1) {
  const item = eligible[index];
  let pages = [];
  try { pages = await faWikiSearch(clean(item.nameFa)); }
  catch (error) {
    errors += 1;
    if (errorSamples.length < 12) errorSamples.push({ id:item.id, nameFa:item.nameFa, error:String(error?.message || error) });
    continue;
  }
  await sleep(180);

  let found = null;
  for (const page of pages) {
    const pageTitle = clean(page?.title);
    if (!pageTitle) continue;
    let entity = null;
    try { entity = await wikidataEntityForFaTitle(pageTitle); }
    catch (error) {
      errors += 1;
      if (errorSamples.length < 12) errorSamples.push({ id:item.id, nameFa:item.nameFa, pageTitle, error:String(error?.message || error) });
      continue;
    }
    await sleep(180);
    const verdict = validate(item, entity, pageTitle);
    if (verdict) { found = verdict; break; }
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
}

console.log(JSON.stringify({
  currentTargets: targets.length,
  totalEligiblePersianTargets: allEligible.length,
  attemptedEligibleTargets: eligible.length,
  strictFaWikiMatches: matches.length,
  matchesWithPeople: matches.filter((m) => m.directors + m.cast > 0).length,
  matchesForMissingPeople: matches.filter((m) => m.missingPeople && m.directors + m.cast > 0).length,
  matchesForMissingOverview: matches.filter((m) => m.missingOverview).length,
  errors,
}, null, 2));
console.log('--- ERROR SAMPLES ---');
console.log(JSON.stringify(errorSamples, null, 2));
console.log('--- STRICT FAWIKI MATCHES ---');
console.log(JSON.stringify(matches, null, 2));

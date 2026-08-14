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
  .replace(/\s*\([^)]*\)\s*$/u, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const hasPersian = (v) => /[\u0600-\u06FF]/.test(clean(v));
const placeholderOverview = (v) => {
  const s = norm(v);
  return !s || /توضیحی ثبت نشده|توضیحات ثبت نشده|خلاصه داستان ثبت نشده|اطلاعاتی ثبت نشده|بدون توضیح|no description|no overview|description not available/.test(s);
};
const meaningfulPeople = (item) => (item?.people || []).filter((p) =>
  p && ['actor','director'].includes(String(p.role || '')) && (clean(p.name) || clean(p.nameFa))
);
const isOperator = (item) => Boolean(item?.operatorOnly || item?.operatorAccess || (item?.supportedOperators || []).length);
const isIranian = (item) => Boolean(
  item?.ir === true || item?.isIranian === true ||
  (item?.countryCodes || []).some((c) => String(c).toUpperCase() === 'IR') ||
  (item?.categoryKeys || []).some((k) => /^iranian-(?:movies|series)$/i.test(String(k)))
);
const priorityTarget = (item) => (isIranian(item) || isOperator(item)) &&
  (placeholderOverview(item?.overview) || !meaningfulPeople(item).length);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function wikidataSearch(query, language) {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.searchParams.set('action', 'wbsearchentities');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  url.searchParams.set('search', query);
  url.searchParams.set('language', language);
  url.searchParams.set('uselang', 'fa');
  url.searchParams.set('type', 'item');
  url.searchParams.set('limit', '8');
  const response = await fetch(url, { headers: { 'user-agent': 'Aparatchi-Metadata/1.0' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Wikidata search HTTP ${response.status}`);
  return (await response.json())?.search || [];
}

async function wikidataEntity(id) {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.searchParams.set('action', 'wbgetentities');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  url.searchParams.set('ids', id);
  url.searchParams.set('props', 'labels|descriptions|claims|sitelinks');
  url.searchParams.set('languages', 'fa|en');
  url.searchParams.set('sitefilter', 'fawiki|enwiki');
  const response = await fetch(url, { headers: { 'user-agent': 'Aparatchi-Metadata/1.0' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Wikidata entity HTTP ${response.status}`);
  return (await response.json())?.entities?.[id] || null;
}

function claimEntityIds(entity, property) {
  return (entity?.claims?.[property] || []).map((claim) =>
    claim?.mainsnak?.datavalue?.value?.id
  ).filter(Boolean);
}

function releaseYears(entity) {
  const result = [];
  for (const claim of entity?.claims?.P577 || []) {
    const time = clean(claim?.mainsnak?.datavalue?.value?.time);
    const match = time.match(/^[+-](\d{4,})-/);
    if (match) result.push(Number(match[1]));
  }
  return [...new Set(result.filter(Number.isFinite))];
}

function candidateTitles(entity) {
  return [...new Set([
    clean(entity?.labels?.fa?.value),
    clean(entity?.sitelinks?.fawiki?.title),
    clean(entity?.labels?.en?.value),
    clean(entity?.sitelinks?.enwiki?.title),
  ].filter(Boolean))];
}

function entityMatches(item, entity) {
  if (!entity) return { ok:false, reason:'missing-entity' };
  const expectedTypes = item.type === 'series' ? SERIES_TYPES : FILM_TYPES;
  const types = claimEntityIds(entity, 'P31');
  if (types.length && !types.some((qid) => expectedTypes.has(qid))) return { ok:false, reason:'wrong-type' };

  const itemYear = Number(item.year || 0);
  const years = releaseYears(entity);
  if (!itemYear || !years.length || !years.some((year) => Math.abs(year - itemYear) <= 1)) {
    return { ok:false, reason:'year-mismatch' };
  }

  const countries = claimEntityIds(entity, 'P495');
  if (countries.length && !countries.includes(IRAN_QID)) return { ok:false, reason:'non-iran-country' };

  const itemTitles = [item.nameFaGenerated === true ? '' : item.nameFa, item.name]
    .map(norm).filter(Boolean);
  const titles = candidateTitles(entity).map(norm).filter(Boolean);
  const exactTitle = itemTitles.some((value) => titles.includes(value));
  if (!exactTitle) return { ok:false, reason:'title-mismatch' };

  return {
    ok:true,
    years,
    countries,
    titles:candidateTitles(entity),
    directors:claimEntityIds(entity, 'P57'),
    cast:claimEntityIds(entity, 'P161'),
    hasFaWiki:Boolean(clean(entity?.sitelinks?.fawiki?.title)),
    faWikiTitle:clean(entity?.sitelinks?.fawiki?.title),
  };
}

async function findStrictMatch(item) {
  const queries = [];
  if (item.nameFaGenerated !== true && hasPersian(item.nameFa)) queries.push([clean(item.nameFa), 'fa']);
  if (clean(item.name) && norm(item.name) !== norm(item.nameFa)) queries.push([clean(item.name), 'en']);
  const seen = new Set();
  for (const [query, language] of queries) {
    let hits = [];
    try { hits = await wikidataSearch(query, language); } catch { continue; }
    await sleep(35);
    for (const hit of hits) {
      if (!hit?.id || seen.has(hit.id)) continue;
      seen.add(hit.id);
      let entity = null;
      try { entity = await wikidataEntity(hit.id); } catch { continue; }
      await sleep(35);
      const verdict = entityMatches(item, entity);
      if (verdict.ok) return { id:hit.id, ...verdict };
    }
  }
  return null;
}

const targets = items.filter(priorityTarget);
const matched = [];
const unmatched = [];
let errors = 0;
for (let index = 0; index < targets.length; index += 1) {
  const item = targets[index];
  let match = null;
  try { match = await findStrictMatch(item); }
  catch { errors += 1; }
  if (match) {
    matched.push({
      id:item.id, nameFa:item.nameFa, name:item.name, year:item.year,
      operator:isOperator(item), generatedTitle:item.nameFaGenerated===true,
      missingOverview:placeholderOverview(item.overview), missingPeople:!meaningfulPeople(item).length,
      wikidata:match.id, faWikiTitle:match.faWikiTitle, years:match.years,
      countries:match.countries, directors:match.directors.length, cast:match.cast.length,
      hasFaWiki:match.hasFaWiki,
    });
  } else if (unmatched.length < 100) {
    unmatched.push({ id:item.id, nameFa:item.nameFa, name:item.name, year:item.year, operator:isOperator(item), generatedTitle:item.nameFaGenerated===true });
  }
  if ((index + 1) % 25 === 0) console.log(`PROGRESS=${index + 1}/${targets.length} MATCHED=${matched.length}`);
}

console.log(JSON.stringify({
  targets:targets.length,
  strictMatches:matched.length,
  matchesWithPeople:matched.filter((m)=>m.directors+m.cast>0).length,
  matchesWithFaWiki:matched.filter((m)=>m.hasFaWiki).length,
  matchesForMissingOverview:matched.filter((m)=>m.missingOverview && m.hasFaWiki).length,
  matchesForMissingPeople:matched.filter((m)=>m.missingPeople && m.directors+m.cast>0).length,
  errors,
}, null, 2));
console.log('--- STRICT MATCHES ---');
console.log(JSON.stringify(matched, null, 2));
console.log('--- UNMATCHED SAMPLE ---');
console.log(JSON.stringify(unmatched, null, 2));

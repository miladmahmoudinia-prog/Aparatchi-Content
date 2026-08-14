import fs from 'node:fs/promises';

const CATALOG_PATH = 'catalog.json';
const IRAN_QID = 'Q794';
const TARGETS = new Map([
  ['d4ce5000-1239-11eb-9b55-81572d8b7f9d', {
    wikidataId: 'Q14755924',
    year: 2000,
    titleFa: 'راز شب بارانی',
    minPeople: 1,
  }],
  ['d48b6550-3504-11ee-8531-8542df699297', {
    wikidataId: 'Q14756175',
    year: 1994,
    titleFa: 'روز دیدنی',
    minPeople: 5,
  }],
  ['d34d38f0-f21d-11e8-ac04-371dd81d941a', {
    wikidataId: 'Q14756449',
    year: 1988,
    titleFa: 'ردپایی بر شن',
    minPeople: 2,
  }],
]);

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalize = (value) => clean(value)
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[\u064B-\u065F\u0670]/g, '')
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/\s*\([^)]*\)\s*$/u, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

async function wikidataEntities(ids, props = 'labels|claims|sitelinks') {
  const unique = [...new Set(ids.filter((id) => /^Q\d+$/i.test(String(id || ''))))];
  if (!unique.length) return {};
  const output = {};
  for (let index = 0; index < unique.length; index += 40) {
    const batch = unique.slice(index, index + 40);
    const url = new URL('https://www.wikidata.org/w/api.php');
    url.searchParams.set('action', 'wbgetentities');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    url.searchParams.set('ids', batch.join('|'));
    url.searchParams.set('props', props);
    url.searchParams.set('languages', 'fa|en');
    url.searchParams.set('sitefilter', 'fawiki|enwiki');
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Aparatchi-Metadata/1.0 (strict Wikidata people repair)',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
    const payload = await response.json();
    Object.assign(output, payload?.entities || {});
  }
  return output;
}

function claimEntityIds(entity, property) {
  return (entity?.claims?.[property] || [])
    .map((claim) => claim?.mainsnak?.datavalue?.value?.id)
    .filter((id) => /^Q\d+$/i.test(String(id || '')));
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

function candidateTitles(entity) {
  return [...new Set([
    clean(entity?.labels?.fa?.value),
    clean(entity?.sitelinks?.fawiki?.title),
    clean(entity?.labels?.en?.value),
    clean(entity?.sitelinks?.enwiki?.title),
  ].filter(Boolean))];
}

function commonsImage(entity) {
  const filename = clean(
    entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value,
  );
  return filename
    ? `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(filename)}`
    : '';
}

function validateTitleEntity(item, expected, entity) {
  if (!entity || entity.missing === '') throw new Error(`${item.id}: Wikidata entity is missing.`);

  const years = releaseYears(entity);
  if (!years.some((year) => Math.abs(year - expected.year) <= 1)) {
    throw new Error(`${item.id}: Wikidata year mismatch (${years.join(', ') || 'none'}).`);
  }

  const countries = claimEntityIds(entity, 'P495');
  if (countries.length && !countries.includes(IRAN_QID)) {
    throw new Error(`${item.id}: Wikidata country is not Iran (${countries.join(', ')}).`);
  }

  const titles = candidateTitles(entity).map(normalize).filter(Boolean);
  const expectedTitles = [expected.titleFa, item.nameFa, item.name]
    .map(normalize)
    .filter(Boolean);
  if (!expectedTitles.some((title) => titles.includes(title))) {
    throw new Error(`${item.id}: Wikidata title mismatch.`);
  }

  const faWikiTitle = clean(entity?.sitelinks?.fawiki?.title);
  if (normalize(faWikiTitle) !== normalize(expected.titleFa)) {
    throw new Error(`${item.id}: expected exact Persian Wikipedia title ${expected.titleFa}, got ${faWikiTitle || 'none'}.`);
  }
}

function personFromEntity(qid, entity, role, order) {
  const nameFa = clean(entity?.labels?.fa?.value);
  const nameEn = clean(entity?.labels?.en?.value);
  const fallbackFa = clean(entity?.sitelinks?.fawiki?.title);
  const fallbackEn = clean(entity?.sitelinks?.enwiki?.title);
  const displayFa = nameFa || fallbackFa || nameEn || fallbackEn;
  const displayEn = nameEn || fallbackEn || nameFa || fallbackFa;
  if (!displayFa && !displayEn) return null;

  const image = commonsImage(entity);
  return {
    id: `wikidata:${qid}:${role}`,
    wikidataId: qid,
    nameFa: displayFa,
    name: displayEn,
    role,
    roleLabel: role === 'director' ? 'کارگردان' : 'بازیگر',
    order,
    source: 'wikidata',
    ...(image ? { image } : {}),
  };
}

function meaningfulPeople(item) {
  return (Array.isArray(item?.people) ? item.people : []).filter((person) =>
    person && ['actor', 'director'].includes(String(person.role || '')) &&
    Boolean(clean(person.name) || clean(person.nameFa))
  );
}

const catalog = JSON.parse(await fs.readFile(CATALOG_PATH, 'utf8'));
if (!Array.isArray(catalog?.items)) throw new Error('catalog.json has no items array.');

const byId = new Map(catalog.items.map((item) => [String(item?.id || ''), item]));
const titleEntities = await wikidataEntities([...TARGETS.values()].map((target) => target.wikidataId));
let changed = 0;
const report = [];

for (const [id, expected] of TARGETS) {
  const item = byId.get(id);
  if (!item) throw new Error(`Catalog target not found: ${id}`);
  const titleEntity = titleEntities[expected.wikidataId];
  validateTitleEntity(item, expected, titleEntity);

  const directorIds = [...new Set(claimEntityIds(titleEntity, 'P57'))];
  const castIds = [...new Set(claimEntityIds(titleEntity, 'P161'))]
    .filter((qid) => !directorIds.includes(qid));
  if (!directorIds.length) throw new Error(`${id}: strict Wikidata match has no director.`);

  const personIds = [...directorIds, ...castIds];
  const personEntities = await wikidataEntities(personIds, 'labels|claims|sitelinks');
  const repairedPeople = [];

  directorIds.forEach((qid, index) => {
    const person = personFromEntity(qid, personEntities[qid], 'director', index);
    if (person) repairedPeople.push(person);
  });
  castIds.forEach((qid, index) => {
    const person = personFromEntity(qid, personEntities[qid], 'actor', directorIds.length + index);
    if (person) repairedPeople.push(person);
  });

  if (repairedPeople.length < expected.minPeople) {
    throw new Error(`${id}: only ${repairedPeople.length} people resolved; expected at least ${expected.minPeople}.`);
  }
  if (!repairedPeople.some((person) => person.role === 'director')) {
    throw new Error(`${id}: repaired people have no director.`);
  }

  const existing = meaningfulPeople(item);
  const nonWikidataExisting = existing.filter((person) => clean(person.source).toLowerCase() !== 'wikidata');
  const merged = [];
  const identities = new Set();
  for (const person of [...nonWikidataExisting, ...repairedPeople]) {
    const identity = person.wikidataId
      ? `wikidata:${person.wikidataId}:${person.role}`
      : `${normalize(person.nameFa || person.name)}:${person.role}`;
    if (!identity || identities.has(identity)) continue;
    identities.add(identity);
    merged.push({ ...person, order: merged.length });
  }

  const before = JSON.stringify(item.people || []);
  const after = JSON.stringify(merged);
  if (before !== after) {
    item.people = merged;
    changed += 1;
  }
  item.peopleMetadataSource = 'wikidata-strict';
  item.peopleEnrichedAt = new Date().toISOString();
  item.wikidata = {
    ...(item.wikidata && typeof item.wikidata === 'object' ? item.wikidata : {}),
    id: expected.wikidataId,
    verifiedPeople: true,
  };

  report.push({
    id,
    nameFa: item.nameFa,
    wikidataId: expected.wikidataId,
    directors: merged.filter((person) => person.role === 'director').length,
    actors: merged.filter((person) => person.role === 'actor').length,
    total: merged.length,
  });
}

if (changed) {
  catalog.updatedAt = new Date().toISOString();
  await fs.writeFile(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}

console.log(`WIKIDATA_PEOPLE_TARGETS=${TARGETS.size}`);
console.log(`WIKIDATA_PEOPLE_CHANGED=${changed}`);
console.log(JSON.stringify(report, null, 2));

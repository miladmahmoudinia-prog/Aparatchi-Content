import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const items = Array.isArray(catalog?.items) ? catalog.items : [];

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (v) => clean(v).toLowerCase().normalize('NFKC')
  .replace(/[\u064B-\u065F\u0670]/g, '')
  .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
  .replace(/\b(?:dubbed|subtitle(?:d)?|persian|farsi|operator|mobile|special|version|نسخه|دوبله|زیرنویس|فارسی|ویژه|همراه)\b/giu, ' ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const hasPersian = (v) => /[\u0600-\u06FF]/.test(clean(v));
const placeholderOverview = (v) => {
  const s = norm(v);
  return !s || /توضیحی ثبت نشده|توضیحات ثبت نشده|خلاصه داستان ثبت نشده|اطلاعاتی ثبت نشده|بدون توضیح|no description|no overview|description not available/.test(s);
};
const people = (item) => (item?.people || []).filter((p) =>
  p && ['actor','director'].includes(String(p.role || '')) && (clean(p.name) || clean(p.nameFa))
);
const operator = (item) => Boolean(
  item?.operatorOnly || item?.operatorAccess || (item?.supportedOperators || []).length ||
  (item?.downloads || []).some((g) => (g?.files || []).some((f) => /^operator-(?:play|download)$/.test(String(f?.mode || ''))))
);
const iranian = (item) => Boolean(
  item?.ir === true || item?.isIranian === true ||
  (item?.countryCodes || []).some((c) => String(c).toUpperCase() === 'IR') ||
  (item?.categoryKeys || []).some((k) => /^iranian-(?:movies|series)$/i.test(String(k)))
);
const target = (item) => (iranian(item) || operator(item)) && (placeholderOverview(item?.overview) || !people(item).length);
const donorQuality = (item) => Number(!placeholderOverview(item?.overview)) + Number(people(item).length > 0) * 2;
const imdbId = (v) => clean(v).match(/tt\d{6,12}/i)?.[0]?.toLowerCase() || '';
const tmdbId = (item) => Number(item?.tmdb?.id || item?.tmdbId || 0) || 0;

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((entry) => collectStrings(entry, out));
  return out;
}
function uperaKeys(item) {
  const keys = new Set();
  for (const value of collectStrings(item)) {
    let match;
    const portal = /https?:\/\/[^/]*upera\.tv\/stream\/(movie|episode)\/([^/?#]+)/ig;
    while ((match = portal.exec(value))) keys.add(`portal:${match[1].toLowerCase()}:${decodeURIComponent(match[2]).toLowerCase()}`);
    const media = /https?:\/\/[^/]*upera\.tv\/(\d+)(?:-\d+)?-(?:hls|\d+p|hq|sd|hd)?/ig;
    while ((match = media.exec(value))) keys.add(`media:${match[1]}`);
    const numeric = /(?:^|[^0-9])(\d{5,10})(?:[^0-9]|$)/g;
    if (/upera\.tv/i.test(value)) while ((match = numeric.exec(value))) keys.add(`upera-num:${match[1]}`);
  }
  return [...keys];
}

const keyIndex = new Map();
function addKey(key, item) {
  if (!key) return;
  if (!keyIndex.has(key)) keyIndex.set(key, []);
  keyIndex.get(key).push(item);
}
for (const item of items) {
  const type = item?.type || '';
  const tmdb = tmdbId(item);
  if (tmdb) addKey(`${type}:tmdb:${tmdb}`, item);
  const imdb = imdbId(item?.imdb);
  if (imdb) addKey(`${type}:imdb:${imdb}`, item);
  const year = Number(item?.year || 0);
  for (const title of new Set([norm(item?.name), norm(item?.nameFa)].filter(Boolean))) {
    addKey(`${type}:title:${year}:${title}`, item);
    addKey(`${type}:title-any:${title}`, item);
  }
  for (const key of uperaKeys(item)) addKey(`${type}:${key}`, item);
}

const targets = items.filter(target);
const recoverable = [];
const noDonor = [];
const byReason = { tmdb:0, imdb:0, titleYear:0, titleAny:0, upera:0 };
let overviewRecoverable = 0;
let peopleRecoverable = 0;
let bothRecoverable = 0;

for (const item of targets) {
  const keys = [];
  const type = item?.type || '';
  const tmdb = tmdbId(item);
  if (tmdb) keys.push(['tmdb', `${type}:tmdb:${tmdb}`]);
  const imdb = imdbId(item?.imdb);
  if (imdb) keys.push(['imdb', `${type}:imdb:${imdb}`]);
  const year = Number(item?.year || 0);
  for (const title of new Set([norm(item?.name), norm(item?.nameFa)].filter(Boolean))) {
    keys.push(['titleYear', `${type}:title:${year}:${title}`]);
    keys.push(['titleAny', `${type}:title-any:${title}`]);
  }
  for (const key of uperaKeys(item)) keys.push(['upera', `${type}:${key}`]);

  let donor = null;
  let reason = '';
  for (const [kind, key] of keys) {
    const candidates = (keyIndex.get(key) || [])
      .filter((candidate) => candidate !== item && donorQuality(candidate) > 0)
      .sort((a,b) => donorQuality(b) - donorQuality(a));
    if (candidates[0]) { donor = candidates[0]; reason = kind; break; }
  }

  if (!donor) {
    if (noDonor.length < 80) noDonor.push({
      id:item.id,type:item.type,year:item.year,name:item.name,nameFa:item.nameFa,
      iranian:iranian(item),operator:operator(item),tmdb:tmdb||null,imdb:imdb||null,
      missingOverview:placeholderOverview(item.overview),missingPeople:!people(item).length,
      uperaKeys:uperaKeys(item).slice(0,8),
    });
    continue;
  }
  byReason[reason] += 1;
  const canOverview = placeholderOverview(item.overview) && !placeholderOverview(donor.overview);
  const canPeople = !people(item).length && people(donor).length > 0;
  if (canOverview) overviewRecoverable += 1;
  if (canPeople) peopleRecoverable += 1;
  if (canOverview && canPeople) bothRecoverable += 1;
  recoverable.push({
    id:item.id,nameFa:item.nameFa,donorId:donor.id,donorNameFa:donor.nameFa,reason,
    canOverview,canPeople,donorPeople:people(donor).length,
  });
}

console.log(JSON.stringify({
  catalogItems:items.length,
  targets:targets.length,
  missingOverview:targets.filter((i)=>placeholderOverview(i.overview)).length,
  missingPeople:targets.filter((i)=>!people(i).length).length,
  recoverableTargets:recoverable.length,
  noDonorTargets:targets.length-recoverable.length,
  overviewRecoverable,peopleRecoverable,bothRecoverable,byReason,
}, null, 2));
console.log('--- RECOVERABLE SAMPLES ---');
console.log(JSON.stringify(recoverable.slice(0,100), null, 2));
console.log('--- NO DONOR SAMPLES ---');
console.log(JSON.stringify(noDonor, null, 2));

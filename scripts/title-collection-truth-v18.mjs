import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { writeClientCatalogArtifacts } from './client-catalog.mjs';
import {
  applyVerifiedPersianTitleOverrides,
  normalizePersianOverrideKey,
  persianCollectionBaseFromTitle,
} from './persian-title-overrides.mjs';

const KNOWN_TITLE_OVERRIDES = new Map([
  ['the jack in the box', 'جعبه اسباب‌بازی'],
  ['enola holmes 2', 'انولا هولمز ۲'],
  ['enola holmes 3', 'انولا هولمز ۳'],
  ['one mile chapter one', 'یک مایل: بخش اول'],
  ['one mile chapter two', 'یک مایل: بخش دوم'],
]);

const KNOWN_COLLECTION_OVERRIDES = new Map([
  ['admiral yi trilogy', 'کالکشن دریاسالار یی سون شین'],
  ['m3gan collection', 'کالکشن مگان'],
  ['one mile collection', 'کالکشن یک مایل'],
  ['the souvenir collection', 'کالکشن یادگاری'],
  ['enola holmes collection', 'کالکشن انولا هولمز'],
  ['spongebob collection', 'کالکشن باب اسفنجی'],
  ['super monsters collection', 'کالکشن ابرهیولاها'],
  ['the jack in the box collection', 'کالکشن جعبه اسباب‌بازی'],
  ['jack in the box collection', 'کالکشن جعبه اسباب‌بازی'],
  ['downton abbey films collection', 'کالکشن دانتون ابی'],
  ['knives out collection', 'کالکشن چاقوکشی'],
  ['superman collection', 'کالکشن سوپرمن'],
  ['miraculous world', 'کالکشن دنیای میراکلس'],
  ['the lion king reboot collection', 'کالکشن شیر شاه'],
  ['rurouni kenshin collection', 'کالکشن شمشیرزن دوره‌گرد'],
  ['jurassic park collection', 'کالکشن پارک ژوراسیک'],
  ['batman collection', 'کالکشن بتمن'],
  ['scream collection', 'کالکشن جیغ'],
  ['pushpa collection', 'کالکشن پوشپا'],
  ['deportees', 'کالکشن اخراجی‌ها'],
]);

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function hasPersian(value) {
  return /[\u0600-\u06FF]/.test(clean(value));
}

function hasLatin(value) {
  return /\p{Script=Latin}/u.test(clean(value));
}

function key(value) {
  return normalizePersianOverrideKey(value);
}

function stripCollectionPrefix(value) {
  return clean(value).replace(/^(?:مجموعه|کالکشن)\s+/u, '').trim();
}

function ensureCollectionPrefix(value) {
  const text = stripCollectionPrefix(value);
  return text ? `کالکشن ${text}` : '';
}

function toPersianDigits(value) {
  return String(value ?? '').replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

function englishCollectionBase(value) {
  return clean(value)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:films?|movies?)\b/gi, ' ')
    .replace(/\bcollection\b/gi, ' ')
    .replace(/\btrilogy\b/gi, ' ')
    .replace(/\bkoleksiyonu\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Be intentionally conservative here. A legitimate first franchise movie can
// have exactly the same Persian title as the collection base (Batman/بتمن,
// Scream/جیغ, Superman/سوپرمن, ...). The unmistakable corruption we need to
// reject is a member itself being labelled «مجموعه ...».
function titleMatchesCollectionLeak(item) {
  const titleFa = clean(item?.nameFa);
  if (!titleFa || !hasPersian(titleFa) || !item?.collectionId) return false;
  const titleEn = clean(item?.name);
  return /^(?:مجموعه|کالکشن)\s+/u.test(titleFa) && !/\bcollection\b/i.test(titleEn);
}

function collectionNameLooksLikeMemberLeak(value, members) {
  const current = clean(value);
  if (!current || !hasPersian(current)) return true;
  const stripped = stripCollectionPrefix(current);
  const normalized = key(stripped);
  if (!normalized) return true;

  const hasSeparator = /[:：؛]/u.test(stripped) || /\s[-–—]\s/u.test(stripped);
  const hasPartSuffix = /(?:^|\s)(?:قسمت|بخش|فصل)\s+(?:[۰-۹0-9]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\s*$/u.test(stripped);
  const hasNumericSuffix = /\s[۰-۹0-9]+(?:[٫.][۰-۹0-9]+)?\s*$/u.test(stripped);

  // A simple base title is valid even when it is also the title of the first
  // installment. Only subtitle/part-shaped collection labels are suspicious.
  if (!hasSeparator && !hasPartSuffix && !hasNumericSuffix) return false;

  const equalsMemberTitle = members.some((item) => {
    const memberFa = clean(item?.nameFa);
    return hasPersian(memberFa) && key(stripCollectionPrefix(memberFa)) === normalized;
  });
  if (equalsMemberTitle) return true;

  if (hasSeparator) {
    const prefix = stripped.split(/\s*(?:[:：؛]|\s[-–—]\s)\s*/u)[0]?.trim();
    if (prefix && members.some((item) => key(persianCollectionBaseFromTitle(item?.nameFa)) === key(prefix))) {
      return true;
    }
  }

  return hasPartSuffix || hasNumericSuffix;
}

function bestLocalCollectionTitle(members) {
  const counts = new Map();
  for (const item of members) {
    const titleFa = clean(item?.nameFa);
    if (!hasPersian(titleFa) || titleMatchesCollectionLeak(item)) continue;
    const base = stripCollectionPrefix(persianCollectionBaseFromTitle(titleFa));
    if (!base || base.length < 2) continue;
    const normalized = key(base);
    if (!normalized) continue;
    const current = counts.get(normalized) || { value: base, count: 0 };
    current.count += 1;
    if (base.length < current.value.length) current.value = base;
    counts.set(normalized, current);
  }
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count || a.value.length - b.value.length);
  return ranked[0]?.value || '';
}

function deriveNumericMemberTitle(item, collectionFa) {
  const baseFa = stripCollectionPrefix(collectionFa);
  if (!baseFa || !hasPersian(baseFa)) return '';
  const baseEn = englishCollectionBase(item?.collectionName);
  const titleEn = clean(item?.name);
  if (!baseEn || !titleEn) return '';

  const normalizedBase = key(baseEn);
  const normalizedTitle = key(titleEn);
  if (!normalizedBase || !normalizedTitle || !normalizedTitle.startsWith(normalizedBase)) return '';

  const suffix = titleEn.slice(baseEn.length).trim().replace(/^[:\-–—]+\s*/, '');
  const numeric = suffix.match(/^(\d+(?:\.\d+)?)$/)?.[1];
  if (numeric) return `${baseFa} ${toPersianDigits(numeric)}`;

  const order = Number(item?.collectionOrder || 0);
  if (order > 1 && normalizedTitle === normalizedBase) return `${baseFa} ${toPersianDigits(order)}`;
  return '';
}

async function tmdbJson(apiBase, token, pathname) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`);
  return response.json();
}

async function fetchTmdbPersianTitle(item, token, apiBase) {
  if (!token) return '';
  const mediaType = item?.type === 'series' ? 'tv' : 'movie';
  let id = Number(item?.tmdb?.id || 0);

  if (!(id > 0)) {
    const imdb = clean(item?.imdb).match(/tt\d+/i)?.[0];
    if (imdb) {
      const found = await tmdbJson(apiBase, token, `/find/${encodeURIComponent(imdb)}?external_source=imdb_id&language=fa-IR`);
      const list = mediaType === 'tv' ? found?.tv_results : found?.movie_results;
      id = Number(Array.isArray(list) ? list[0]?.id : 0);
    }
  }

  if (!(id > 0)) return '';
  const details = await tmdbJson(apiBase, token, `/${mediaType}/${id}?language=fa-IR`);
  const localized = clean(details?.title || details?.name);
  if (!hasPersian(localized)) return '';
  if (/^مجموعه\s+/u.test(localized) && !/\bcollection\b/i.test(clean(item?.name))) return '';
  return localized;
}

async function fetchTmdbPersianCollection(collectionId, members, token, apiBase) {
  if (!token) return '';
  const id = Number(collectionId || 0);
  if (!(id > 0)) return '';
  const payload = await tmdbJson(apiBase, token, `/collection/${id}?language=fa-IR`);
  const localized = clean(payload?.name);
  if (!hasPersian(localized)) return '';
  if (collectionNameLooksLikeMemberLeak(localized, members)) return '';
  return ensureCollectionPrefix(localized);
}

export async function repairCatalogTitleCollectionTruth(catalog, options = {}) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  const token = clean(options.token);
  const apiBase = clean(options.apiBase || 'https://api.themoviedb.org/3').replace(/\/+$/, '');
  const requestDelayMs = Math.max(0, Number(options.requestDelayMs || 70));
  const maxApiRepairs = Math.max(0, Number(options.maxApiRepairs || 400));
  let apiUsed = 0;
  let titleChanges = 0;
  let collectionChanges = 0;
  let suspiciousTitles = 0;
  let suspiciousCollections = 0;
  const errors = [];

  const verifiedBase = applyVerifiedPersianTitleOverrides(catalog);
  titleChanges += verifiedBase.titleChanges;
  collectionChanges += verifiedBase.collectionChanges;

  const groups = new Map();
  for (const item of items) {
    if (!item || !['movie', 'series'].includes(item.type)) continue;
    const override = KNOWN_TITLE_OVERRIDES.get(key(item.name));
    if (override && item.nameFa !== override) {
      item.nameFa = override;
      delete item.nameFaGenerated;
      item.nameFaSource = 'verified-title-truth-v18';
      titleChanges += 1;
    }
    if (item.collectionId) {
      const id = String(item.collectionId);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(item);
    }
  }

  for (const [collectionId, members] of groups) {
    const first = members[0];
    const collectionEn = clean(first?.collectionName);
    const override = KNOWN_COLLECTION_OVERRIDES.get(key(collectionEn));
    const current = clean(first?.collectionNameFa);
    const suspicious = !current || !hasPersian(current) || collectionNameLooksLikeMemberLeak(current, members);
    if (suspicious) suspiciousCollections += 1;

    let repairedCollection = override || '';
    if (!repairedCollection && current && !suspicious) repairedCollection = ensureCollectionPrefix(current);
    if (!repairedCollection && suspicious && token && apiUsed < maxApiRepairs) {
      try {
        apiUsed += 1;
        repairedCollection = await fetchTmdbPersianCollection(collectionId, members, token, apiBase);
        if (requestDelayMs) await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
      } catch (error) {
        errors.push(`collection ${collectionId}: ${clean(error instanceof Error ? error.message : error)}`);
      }
    }
    if (!repairedCollection && suspicious) {
      const sourceBase = englishCollectionBase(collectionEn) || collectionEn;
      if (sourceBase) repairedCollection = ensureCollectionPrefix(sourceBase);
    }

    if (repairedCollection) {
      for (const item of members) {
        if (item.collectionNameFa !== repairedCollection) {
          item.collectionNameFa = repairedCollection;
          collectionChanges += 1;
        }
      }
    }
  }

  for (const item of items) {
    if (!item || !['movie', 'series'].includes(item.type)) continue;
    const missingPersian = !hasPersian(item.nameFa) || hasLatin(item.nameFa);
    const leakedCollection = titleMatchesCollectionLeak(item);
    if (!missingPersian && !leakedCollection) continue;
    suspiciousTitles += 1;

    let repaired = KNOWN_TITLE_OVERRIDES.get(key(item.name)) || '';
    if (!repaired && token && apiUsed < maxApiRepairs) {
      try {
        apiUsed += 1;
        repaired = await fetchTmdbPersianTitle(item, token, apiBase);
        if (requestDelayMs) await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
      } catch (error) {
        errors.push(`title ${clean(item.id || item.name)}: ${clean(error instanceof Error ? error.message : error)}`);
      }
    }
    if (!repaired && item.collectionId) {
      repaired = deriveNumericMemberTitle(item, item.collectionNameFa);
    }

    if (repaired && hasPersian(repaired) && repaired !== item.nameFa) {
      item.nameFa = repaired;
      delete item.nameFaGenerated;
      item.nameFaSource = 'title-truth-v18';
      titleChanges += 1;
    }
  }

  const remainingCollectionLeaks = items.filter(titleMatchesCollectionLeak);
  return {
    changed: titleChanges > 0 || collectionChanges > 0,
    titleChanges,
    collectionChanges,
    suspiciousTitles,
    suspiciousCollections,
    remainingCollectionLeaks,
    apiUsed,
    errors,
  };
}

async function writeCatalogArtifacts(catalog) {
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  await fs.writeFile('catalog.json', serialized, 'utf8');
  const artifacts = await writeClientCatalogArtifacts(process.cwd(), catalog);
  let manifest = {};
  try { manifest = JSON.parse(await fs.readFile('catalog-manifest.json', 'utf8')); } catch {}
  manifest.schemaVersion = 2;
  manifest.revision = createHash('sha256').update(serialized).digest('hex');
  manifest.clientRevision = artifacts.clientRevision;
  manifest.catalogVersion = clean(catalog.version);
  manifest.catalogUpdatedAt = clean(catalog.updatedAt);
  manifest.sizeBytes = Buffer.byteLength(serialized);
  manifest.clientSizeBytes = artifacts.clientSizeBytes;
  manifest.clientIndex = 'catalog-index.json';
  manifest.detailBase = 'catalog-items/';
  manifest.stableDetailBase = 'catalog-stable/';
  if (artifacts.bootstrapRevision) manifest.bootstrapRevision = artifacts.bootstrapRevision;
  if (artifacts.bootstrapSizeBytes) manifest.bootstrapSizeBytes = artifacts.bootstrapSizeBytes;
  manifest.bootstrapIndex = 'catalog-bootstrap.json';
  await fs.writeFile('catalog-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function main() {
  const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
  const result = await repairCatalogTitleCollectionTruth(catalog, {
    token: process.env.TMDB_READ_ACCESS_TOKEN,
    apiBase: process.env.TMDB_API_BASE,
    requestDelayMs: process.env.TITLE_TRUTH_REQUEST_DELAY_MS || 70,
    maxApiRepairs: process.env.TITLE_TRUTH_MAX_API_REPAIRS || 400,
  });

  if (result.remainingCollectionLeaks.length) {
    console.log(JSON.stringify(result.remainingCollectionLeaks.slice(0, 40).map((item) => ({
      id: item.id,
      name: item.name,
      nameFa: item.nameFa,
      collectionName: item.collectionName,
      collectionNameFa: item.collectionNameFa,
    })), null, 2));
    throw new Error(`${result.remainingCollectionLeaks.length} movie/series titles still equal their collection label.`);
  }

  if (result.changed) {
    catalog.updatedAt = new Date().toISOString();
    await writeCatalogArtifacts(catalog);
  }

  console.log(JSON.stringify({
    titleChanges: result.titleChanges,
    collectionChanges: result.collectionChanges,
    suspiciousTitles: result.suspiciousTitles,
    suspiciousCollections: result.suspiciousCollections,
    apiUsed: result.apiUsed,
    errors: result.errors.slice(0, 20),
  }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) {
  await main();
}

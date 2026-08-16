import fs from 'node:fs/promises';
import path from 'node:path';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const filenames = (await fs.readdir('catalog-items')).filter((name) => /^[a-f0-9]{12}-[a-f0-9]{12}\.json$/i.test(name));
const variantFromUrl = (value) => {
  const text = String(value || '');
  if (!/upera\.tv|upera\.link|seeko\.film/i.test(text)) return '';
  let pathname = text;
  try { pathname = new URL(text).pathname; } catch {}
  const name = pathname.split('/').pop() || '';
  const matches = [...name.matchAll(/-(\d+)-/g)];
  return matches.length ? matches[matches.length - 1][1] : '';
};
const directLanguages = (item) => {
  const set = new Set();
  for (const language of item?.availableLanguages || []) {
    if (language === 'dubbed' || language === 'subtitled') set.add(language);
  }
  for (const section of item?.downloads || []) {
    if (section?.language === 'dubbed' || section?.language === 'subtitled') set.add(section.language);
    for (const file of section?.files || []) {
      if (file?.language === 'dubbed' || file?.language === 'subtitled') set.add(file.language);
    }
  }
  return [...set];
};

const historicalByIdentity = new Map();
for (const filename of filenames) {
  const identity = filename.slice(0, 12).toLowerCase();
  let item;
  try { item = JSON.parse(await fs.readFile(path.join('catalog-items', filename), 'utf8')); } catch { continue; }
  const variantTruth = historicalByIdentity.get(identity) || new Map();
  for (const section of item?.downloads || []) {
    const sectionLanguage = section?.language === 'dubbed' || section?.language === 'subtitled' ? section.language : '';
    for (const file of section?.files || []) {
      const language = file?.language === 'dubbed' || file?.language === 'subtitled' ? file.language : sectionLanguage;
      if (!language) continue;
      const variant = variantFromUrl(file?.url);
      if (!variant) continue;
      const set = variantTruth.get(variant) || new Set();
      set.add(language);
      variantTruth.set(variant, set);
    }
  }
  historicalByIdentity.set(identity, variantTruth);
}

const recoverable = [];
const ambiguous = [];
for (const item of catalog.items || []) {
  if (item.ir === true) continue;
  const currentLanguages = directLanguages(item);
  const identity = String(item.id || '').replace(/-/g, '').slice(0, 12).toLowerCase();
  // Generated shard identity is sha-derived, not UUID-derived. Resolve it by stable pointer filename when present.
  let resolvedIdentity = '';
  try {
    const stableNames = (await fs.readdir('catalog-stable')).filter((name) => /^[a-f0-9]{12}\.json$/i.test(name));
    // This branch is intentionally not used here; stable pointer lookup below is cached outside loop.
    void stableNames;
  } catch {}
  void identity;
  const currentVariants = new Set();
  for (const section of item.downloads || []) for (const file of section.files || []) {
    const variant = variantFromUrl(file?.url);
    if (variant) currentVariants.add(variant);
  }
  if (!currentVariants.size) continue;

  // Find the stable pointer that names this exact catalog id.
  // catalog-stable is only a few thousand tiny files; map is built lazily once below.
  item.__currentLanguages = currentLanguages;
  item.__currentVariants = [...currentVariants];
}

const stableById = new Map();
try {
  for (const name of await fs.readdir('catalog-stable')) {
    if (!/^[a-f0-9]{12}\.json$/i.test(name)) continue;
    try {
      const pointer = JSON.parse(await fs.readFile(path.join('catalog-stable', name), 'utf8'));
      if (pointer?.id) stableById.set(String(pointer.id), name.slice(0, 12).toLowerCase());
    } catch {}
  }
} catch {}

for (const item of catalog.items || []) {
  if (item.ir === true) continue;
  const currentLanguages = directLanguages(item);
  const variants = new Set();
  for (const section of item.downloads || []) for (const file of section.files || []) {
    const variant = variantFromUrl(file?.url);
    if (variant) variants.add(variant);
  }
  if (!variants.size) continue;
  const identity = stableById.get(String(item.id));
  if (!identity) continue;
  const truth = historicalByIdentity.get(identity);
  if (!truth) continue;

  const inferred = new Set();
  let conflict = false;
  const evidence = {};
  for (const variant of variants) {
    const set = truth.get(variant);
    if (!set?.size) continue;
    evidence[variant] = [...set];
    if (set.size !== 1) { conflict = true; continue; }
    inferred.add([...set][0]);
  }
  if (!inferred.size) continue;
  const missing = [...inferred].filter((language) => !currentLanguages.includes(language));
  if (!missing.length) continue;
  const row = { id: item.id, nameFa: item.nameFa, name: item.name, currentLanguages, currentVariants: [...variants], historicalEvidence: evidence, missing };
  (conflict ? ambiguous : recoverable).push(row);
}

const namedTerms = ['تاج کامل','Perfect Crown','یاکشا','Yaksha','پیامبر','Prophet','بکاسین','Bécassine','تونی کروس','Toni Kroos','کیمیاگر','Tales from Earthsea','بدنم را از دست دادم','I Lost My Body'];
const named = [...recoverable, ...ambiguous].filter((row) => namedTerms.some((term) => `${row.nameFa || ''} ${row.name || ''}`.toLowerCase().includes(term.toLowerCase())));
console.log('HISTORICAL_LANGUAGE_TRUTH_METRICS=' + JSON.stringify({
  shardFiles: filenames.length,
  stablePointers: stableById.size,
  recoverableTitles: recoverable.length,
  ambiguousTitles: ambiguous.length,
  recoverableDubbed: recoverable.filter((row) => row.missing.includes('dubbed')).length,
  recoverableSubtitled: recoverable.filter((row) => row.missing.includes('subtitled')).length,
}));
console.log('HISTORICAL_LANGUAGE_NAMED=' + JSON.stringify(named));
console.log('HISTORICAL_LANGUAGE_RECOVERABLE_SAMPLE=' + JSON.stringify(recoverable.slice(0, 80)));

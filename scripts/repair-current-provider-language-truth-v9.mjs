import fs from 'node:fs/promises';

const API_BASE = 'https://seeko.film/api/v1';
const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const items = Array.isArray(catalog.items) ? catalog.items : [];

const truthy = (value) =>
  value === true || Number(value) === 1 || /^(?:1|true|yes)$/i.test(String(value || '').trim());
const unique = (values) => [...new Set(values.filter(Boolean))];
const isPrimaryUperaVariant = (value) => {
  const text = String(value || '').trim();
  if (!/upera\.tv|upera\.link|seeko\.film/i.test(text)) return false;
  let pathname = text;
  try { pathname = new URL(text).pathname; } catch {}
  const filename = pathname.split('/').pop() || '';
  return /-0-(?:[^/?#]+)$/i.test(filename);
};

const mediaFiles = (item) =>
  (Array.isArray(item?.downloads) ? item.downloads : [])
    .flatMap((section) => Array.isArray(section?.files) ? section.files : []);
const hasUnlabelledPrimary = (item) => mediaFiles(item).some((file) =>
  !file?.language && isPrimaryUperaVariant(file?.url)
);

function findProviderRecord(value, id) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findProviderRecord(child, id);
      if (found) return found;
    }
    return null;
  }
  if (String(value.id || '') === String(id) && Object.prototype.hasOwnProperty.call(value, 'dubbed')) {
    return value;
  }
  for (const child of Object.values(value)) {
    if (!child || typeof child !== 'object') continue;
    const found = findProviderRecord(child, id);
    if (found) return found;
  }
  return null;
}

async function fetchProviderRecord(item) {
  const kind = item.type === 'series' ? 'series' : 'movie';
  const url = new URL(`${API_BASE}/ghost/get/${kind}/${encodeURIComponent(String(item.id))}`);
  if (kind === 'series') url.searchParams.set('affiliate', '1');

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const record = findProviderRecord(payload, item.id);
      if (!record) throw new Error('matching provider record with dubbed field not found');
      return record;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 220));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('provider detail request failed');
}

const candidates = items.filter((item) =>
  item?.ir !== true &&
  (item?.type === 'movie' || item?.type === 'series') &&
  hasUnlabelledPrimary(item)
);

let checked = 0;
let providerFailures = 0;
let dubbedTitles = 0;
let newlyDubbedTitles = 0;
let taggedFiles = 0;
const failureSamples = [];
const changedSamples = [];

async function auditCandidate(item) {
  let provider;
  try {
    provider = await fetchProviderRecord(item);
    checked += 1;
  } catch (error) {
    providerFailures += 1;
    if (failureSamples.length < 30) {
      failureSamples.push({
        id: item.id,
        nameFa: item.nameFa,
        name: item.name,
        type: item.type,
        error: String(error?.message || error),
      });
    }
    return;
  }

  // No guessing: only Upera's explicit title-level dubbed truth may label the
  // otherwise-unlabelled primary media variant. Subtitled rows remain intact.
  if (!truthy(provider.dubbed)) return;

  let itemTaggedFiles = 0;
  for (const section of Array.isArray(item.downloads) ? item.downloads : []) {
    for (const file of Array.isArray(section?.files) ? section.files : []) {
      if (file?.language === 'dubbed' || file?.language === 'subtitled') continue;
      if (!isPrimaryUperaVariant(file?.url)) continue;
      file.language = 'dubbed';
      itemTaggedFiles += 1;
      taggedFiles += 1;
    }
  }
  if (!itemTaggedFiles) return;

  const hadDubbed = Array.isArray(item.availableLanguages) && item.availableLanguages.includes('dubbed');
  item.availableLanguages = unique([...(Array.isArray(item.availableLanguages) ? item.availableLanguages : []), 'dubbed']);
  item.categoryKeys = unique([...(Array.isArray(item.categoryKeys) ? item.categoryKeys : []), 'dubbed']);
  item.categoryLabels = unique([...(Array.isArray(item.categoryLabels) ? item.categoryLabels : []), 'دوبله فارسی']);
  dubbedTitles += 1;
  if (!hadDubbed) newlyDubbedTitles += 1;
  if (changedSamples.length < 80) {
    changedSamples.push({
      id: item.id,
      nameFa: item.nameFa,
      name: item.name,
      type: item.type,
      providerDubbed: provider.dubbed,
      providerPersian: provider.persian,
      providerSubbed: provider.subbed,
      taggedFiles: itemTaggedFiles,
    });
  }
}

const CONCURRENCY = 12;
for (let offset = 0; offset < candidates.length; offset += CONCURRENCY) {
  await Promise.all(candidates.slice(offset, offset + CONCURRENCY).map(auditCandidate));
}

const perfect = items.find((item) => String(item.id) === 'cbeacfc0-5121-11f1-a97c-a7cfc3f4e1b6');
const perfectDubbedFiles = mediaFiles(perfect).filter((file) => file?.language === 'dubbed').length;
if (!perfect?.availableLanguages?.includes('dubbed') || perfectDubbedFiles < 1) {
  throw new Error('Perfect Crown was not recovered from direct provider dubbed truth.');
}

catalog.updatedAt = new Date().toISOString();
await fs.writeFile('catalog.json', JSON.stringify(catalog, null, 2) + '\n');

console.log('PROVIDER_LANGUAGE_SWEEP=' + JSON.stringify({
  candidates: candidates.length,
  checked,
  providerFailures,
  dubbedTitles,
  newlyDubbedTitles,
  taggedFiles,
  perfectCrownDubbedFiles: perfectDubbedFiles,
}));
console.log('PROVIDER_LANGUAGE_CHANGED_SAMPLE=' + JSON.stringify(changedSamples));
console.log('PROVIDER_LANGUAGE_FAILURE_SAMPLE=' + JSON.stringify(failureSamples));

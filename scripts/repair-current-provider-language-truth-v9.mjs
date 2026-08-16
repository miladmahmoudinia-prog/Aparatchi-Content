import fs from 'node:fs/promises';

const API_BASE = 'https://seeko.film/api/v1';
const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const items = Array.isArray(catalog.items) ? catalog.items : [];
const itemById = new Map(items.map((item) => [String(item.id || ''), item]));

const truthy = (value) => value === true || Number(value) === 1 || /^(?:1|true|yes)$/i.test(String(value || '').trim());
const isPrimaryUperaVariant = (value) => {
  const text = String(value || '').trim();
  if (!/upera\.tv|upera\.link|seeko\.film/i.test(text)) return false;
  let pathname = text;
  try { pathname = new URL(text).pathname; } catch {}
  const filename = pathname.split('/').pop() || '';
  return /-0-(?:[^/?#]+)$/i.test(filename);
};
const unique = (values) => [...new Set(values.filter(Boolean))];

function collectProviderRows(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    for (const child of value) collectProviderRows(child, output);
    return output;
  }
  if (value.id != null && Object.prototype.hasOwnProperty.call(value, 'dubbed')) output.push(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') collectProviderRows(child, output);
  return output;
}

async function fetchPage(kind, page) {
  const url = new URL(`${API_BASE}/ghost/get/${kind}/sort`);
  const params = {
    trending: '1', genre: 'all', free: '1', country: '0', persian: kind === 'series' ? '0' : '',
    query: '', affiliate: '1', page: String(page),
  };
  if (kind === 'movies') params.imdb = '';
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { method: 'POST', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${kind} page ${page}: HTTP ${response.status}`);
  return await response.json();
}

const providerRowsById = new Map();
const pages = {};
for (const kind of ['movies', 'series']) {
  let consecutiveNoNew = 0;
  const signatures = new Set();
  let lastPage = 0;
  for (let page = 1; page <= 300; page += 1) {
    const payload = await fetchPage(kind, page);
    const rows = collectProviderRows(payload).filter((row) => itemById.has(String(row.id || '')));
    const ids = unique(rows.map((row) => String(row.id || ''))).sort();
    const signature = ids.join('|');
    if (!ids.length) {
      consecutiveNoNew += 1;
      if (consecutiveNoNew >= 2) break;
      continue;
    }
    if (signatures.has(signature)) break;
    signatures.add(signature);
    let newCount = 0;
    for (const row of rows) {
      const id = String(row.id || '');
      if (!providerRowsById.has(id)) newCount += 1;
      const current = providerRowsById.get(id);
      if (!current || truthy(row.dubbed)) providerRowsById.set(id, row);
    }
    consecutiveNoNew = newCount ? 0 : consecutiveNoNew + 1;
    lastPage = page;
    if (consecutiveNoNew >= 3) break;
    await new Promise((resolve) => setTimeout(resolve, 65));
  }
  pages[kind] = lastPage;
}

let changedTitles = 0;
let taggedFiles = 0;
let newlyDubbedTitles = 0;
const changedSamples = [];

for (const [id, row] of providerRowsById) {
  if (!truthy(row.dubbed)) continue;
  const item = itemById.get(id);
  if (!item || item.ir === true) continue;

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
  if (!itemTaggedFiles) continue;

  const hadDubbed = Array.isArray(item.availableLanguages) && item.availableLanguages.includes('dubbed');
  item.availableLanguages = unique([...(Array.isArray(item.availableLanguages) ? item.availableLanguages : []), 'dubbed']);
  item.categoryKeys = unique([...(Array.isArray(item.categoryKeys) ? item.categoryKeys : []), 'dubbed']);
  item.categoryLabels = unique([...(Array.isArray(item.categoryLabels) ? item.categoryLabels : []), 'دوبله فارسی']);
  changedTitles += 1;
  if (!hadDubbed) newlyDubbedTitles += 1;
  if (changedSamples.length < 80) changedSamples.push({ id, nameFa: item.nameFa, name: item.name, type: item.type, taggedFiles: itemTaggedFiles });
}

catalog.updatedAt = new Date().toISOString();
await fs.writeFile('catalog.json', JSON.stringify(catalog, null, 2) + '\n');

const perfect = items.find((item) => String(item.id) === 'cbeacfc0-5121-11f1-a97c-a7cfc3f4e1b6');
const perfectDubbedFiles = (perfect?.downloads || []).flatMap((section) => section.files || []).filter((file) => file.language === 'dubbed').length;
if (!perfect?.availableLanguages?.includes('dubbed') || perfectDubbedFiles < 1) {
  throw new Error('Perfect Crown was not recovered from current provider dubbed truth.');
}

console.log('PROVIDER_LANGUAGE_SWEEP=' + JSON.stringify({
  pages,
  providerRowsMatched: providerRowsById.size,
  changedTitles,
  newlyDubbedTitles,
  taggedFiles,
  perfectCrownDubbedFiles: perfectDubbedFiles,
}));
console.log('PROVIDER_LANGUAGE_CHANGED_SAMPLE=' + JSON.stringify(changedSamples));

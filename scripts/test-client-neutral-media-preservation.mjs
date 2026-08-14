import fs from 'node:fs/promises';
import { buildClientCatalogArtifacts } from './client-catalog.mjs';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const artifacts = buildClientCatalogArtifacts(catalog);
const clientById = new Map(artifacts.index.items.map((item) => [String(item.id), item]));
const detailsByPath = new Map(artifacts.detailFiles.map((detail) => [detail.path, JSON.parse(detail.serialized)]));

const directUsable = (file) => {
  const url = String(file?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return false;
  const mode = String(file?.mode || 'download');
  if (mode === 'purchase' || mode.startsWith('operator-')) return false;
  if (mode === 'play') return /\.(?:m3u8|mp4)(?:$|[?#])/i.test(url);
  return /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(url);
};

const sourceDirectFiles = (item) => (item.downloads || []).flatMap((section) =>
  (section.files || []).filter(directUsable).map((file) => ({ section, file }))
);

let sourceMoviesWithMedia = 0;
let lostMovies = 0;
let neutralClientFiles = 0;
let falseLanguageLabels = 0;
const lostExamples = [];

for (const item of catalog.items || []) {
  if (item?.type !== 'movie') continue;
  const sourceFiles = sourceDirectFiles(item);
  if (!sourceFiles.length) continue;
  sourceMoviesWithMedia += 1;
  const summary = clientById.get(String(item.id));
  if (!summary) {
    lostMovies += 1;
    lostExamples.push({ id: item.id, name: item.name, nameFa: item.nameFa, reason: 'missing-summary' });
    continue;
  }
  const detail = detailsByPath.get(summary.detailPath);
  const clientFiles = (detail?.downloads || []).flatMap((section) => section.files || []).filter(directUsable);
  if (!clientFiles.length) {
    lostMovies += 1;
    lostExamples.push({ id: item.id, name: item.name, nameFa: item.nameFa, reason: 'missing-client-media' });
    continue;
  }
  neutralClientFiles += clientFiles.filter((file) => !file.language).length;
  falseLanguageLabels += clientFiles.filter((file) => file.language && !['dubbed','subtitled'].includes(file.language)).length;
}

const oldHenry = (catalog.items || []).find((item) => /old\s*henry/i.test(String(item?.name || '')) || /هنری\s*پیر/.test(String(item?.nameFa || '')));
if (!oldHenry) throw new Error('Old Henry not found in source catalog.');
const oldHenrySummary = clientById.get(String(oldHenry.id));
if (!oldHenrySummary) throw new Error('Old Henry is missing from client index.');
const oldHenryDetail = detailsByPath.get(oldHenrySummary.detailPath);
const oldHenryFiles = (oldHenryDetail?.downloads || []).flatMap((section) => section.files || []).filter(directUsable);
if (oldHenryFiles.length < 1) throw new Error('Old Henry lost its download media.');
if (!oldHenryFiles.every((file) => file.language === 'subtitled')) {
  throw new Error('Old Henry real subtitled classification was damaged.');
}

if (lostMovies) {
  console.log(JSON.stringify(lostExamples.slice(0, 40), null, 2));
  throw new Error(`${lostMovies} source movies with direct media still have no client media.`);
}
if (falseLanguageLabels) throw new Error(`${falseLanguageLabels} client files received unsupported synthetic language labels.`);
if (!neutralClientFiles) throw new Error('Expected neutral/unlabelled client media was not preserved.');

console.log(JSON.stringify({
  sourceMoviesWithMedia,
  lostMovies,
  neutralClientFiles,
  falseLanguageLabels,
  oldHenryDownloads: oldHenryFiles.length,
  oldHenryLanguage: 'subtitled',
}, null, 2));

import fs from 'node:fs/promises';

const normalize = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
  .trim();

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const index = JSON.parse(await fs.readFile('catalog-index.json', 'utf8'));
const sourceById = new Map((catalog.items || []).map((item) => [String(item.id), item]));

const targetIds = new Set(['de2229d0-0b9c-11ef-be17-3fb12a88da3d']);
const queryTokens = ['درد مشترک', 'مشترک', 'dard', 'moshtarak', 'moshtarek'];

const compactFile = (file) => ({
  id: file?.id,
  mode: file?.mode,
  language: file?.language,
  quality: file?.quality,
  label: file?.label,
  url: file?.url,
  operatorOnly: file?.operatorOnly,
  panelVerified: file?.panelVerified,
  trafficOo: file?.trafficOo,
});
const compactSections = (downloads) => (downloads || []).slice(0, 8).map((section) => ({
  id: section?.id,
  title: section?.title,
  seasonNumber: section?.seasonNumber,
  episodeNumber: section?.episodeNumber,
  files: (section?.files || []).slice(0, 8).map(compactFile),
}));

const diagnoses = [];
for (const summary of index.items || []) {
  const haystack = normalize([summary.nameFa, summary.name, summary.slug].filter(Boolean).join(' '));
  const matchedQuery = queryTokens.find((query) => haystack.includes(normalize(query)));
  if (!targetIds.has(String(summary.id)) && !matchedQuery) continue;

  let detail = null;
  try { detail = JSON.parse(await fs.readFile(summary.detailPath, 'utf8')); } catch {}
  const source = sourceById.get(String(summary.id));
  diagnoses.push({
    matchedQuery: matchedQuery || null,
    summary: {
      id: summary.id,
      type: summary.type,
      nameFa: summary.nameFa,
      name: summary.name,
      access: summary.access,
      operatorOnly: summary.operatorOnly,
      availableLanguages: summary.availableLanguages,
      detailPath: summary.detailPath,
    },
    detail: detail ? {
      streamUrl: detail.streamUrl,
      streamMode: detail.streamMode,
      access: detail.access,
      operatorOnly: detail.operatorOnly,
      mediaAuditStatus: detail.mediaAuditStatus,
      downloads: compactSections(detail.downloads),
    } : null,
    source: source ? {
      streamUrl: source.streamUrl,
      streamMode: source.streamMode,
      access: source.access,
      operatorOnly: source.operatorOnly,
      mediaAuditStatus: source.mediaAuditStatus,
      downloads: compactSections(source.downloads),
    } : null,
  });
}

// Also search source-only rows that are currently hidden from the mobile index.
const sourceMatches = (catalog.items || [])
  .filter((item) => {
    const haystack = normalize([item.nameFa, item.name, item.slug].filter(Boolean).join(' '));
    return queryTokens.some((query) => haystack.includes(normalize(query)));
  })
  .slice(0, 30)
  .map((item) => ({
    id: item.id,
    type: item.type,
    nameFa: item.nameFa,
    name: item.name,
    publicationStatus: item.publicationStatus,
    streamUrl: item.streamUrl,
    operatorOnly: item.operatorOnly,
    downloadSections: Array.isArray(item.downloads) ? item.downloads.length : 0,
  }));

console.log(JSON.stringify({ diagnoses, sourceMatches }, null, 2));

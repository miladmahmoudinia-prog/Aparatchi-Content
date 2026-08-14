import fs from 'node:fs/promises';
import { buildClientCatalogArtifacts } from './client-catalog.mjs';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const artifacts = buildClientCatalogArtifacts(catalog);
const clientById = new Map(artifacts.index.items.map((item) => [String(item.id), item]));
const detailsByPath = new Map(artifacts.detailFiles.map((detail) => [detail.path, JSON.parse(detail.serialized)]));

const hasHttp = (value) => /^https?:\/\//i.test(String(value || '').trim());
const sourceMediaFiles = (item) => (Array.isArray(item.downloads) ? item.downloads : []).flatMap((section) =>
  (Array.isArray(section?.files) ? section.files : [])
    .filter((file) => hasHttp(file?.url))
    .map((file) => ({
      section: String(section?.title || ''),
      badge: String(section?.badge || ''),
      sectionLanguage: String(section?.language || ''),
      fileLanguage: String(file?.language || ''),
      mode: String(file?.mode || 'download'),
      label: String(file?.label || ''),
      host: (() => { try { return new URL(String(file.url)).host; } catch { return ''; } })(),
      extension: (String(file?.url || '').match(/\.(m3u8|mp4|mkv|webm|mov|m4v)(?:$|[?#])/i)?.[1] || '').toLowerCase(),
    }))
);

const missing = [];
for (const item of catalog.items || []) {
  if (item?.type !== 'movie') continue;
  const sourceFiles = sourceMediaFiles(item);
  if (!sourceFiles.length) continue;
  const summary = clientById.get(String(item.id));
  if (!summary) {
    missing.push({ id: item.id, name: item.name, nameFa: item.nameFa, ir: item.ir, sourceFiles });
    continue;
  }
  const detail = detailsByPath.get(summary.detailPath);
  const clientFiles = (detail?.downloads || []).flatMap((section) => section.files || []).filter((file) => hasHttp(file?.url));
  const directStream = hasHttp(detail?.streamUrl);
  if (!clientFiles.length && !directStream) {
    missing.push({ id: item.id, name: item.name, nameFa: item.nameFa, ir: item.ir, sourceFiles });
  }
}

const oldHenry = (catalog.items || []).filter((item) =>
  /old\s*henry/i.test(String(item?.name || '')) || /هنری\s*پیر/.test(String(item?.nameFa || ''))
).map((item) => {
  const summary = clientById.get(String(item.id));
  const detail = summary ? detailsByPath.get(summary.detailPath) : null;
  return {
    id: item.id,
    name: item.name,
    nameFa: item.nameFa,
    ir: item.ir,
    sourceFiles: sourceMediaFiles(item),
    clientVisible: Boolean(summary),
    clientDetailFiles: (detail?.downloads || []).flatMap((section) => section.files || []).map((file) => ({
      mode: file.mode || 'download', language: file.language || '', label: file.label || '', host: (() => { try { return new URL(String(file.url)).host; } catch { return ''; } })(),
    })),
    clientStream: Boolean(detail?.streamUrl),
  };
});

console.log('OLD_HENRY_DIAGNOSTIC');
console.log(JSON.stringify(oldHenry, null, 2));
console.log('MOVIES_WITH_SOURCE_MEDIA_BUT_NO_CLIENT_MEDIA=' + missing.length);
console.log(JSON.stringify(missing.slice(0, 40), null, 2));

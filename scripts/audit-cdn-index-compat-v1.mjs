import fs from 'node:fs/promises';

const CDN_INDEX = 'https://cdn.jsdelivr.net/gh/miladmahmoudinia-prog/Aparatchi-Content@main/catalog-index.json';
const rawCurrent = JSON.parse(await fs.readFile('catalog-index.json', 'utf8'));
const currentById = new Map((rawCurrent.items || []).map((item) => [`${item.type}:${item.id}`, item]));

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 20_000);
let cdn;
try {
  const response = await fetch(`${CDN_INDEX}?compat=${Date.now()}`, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(`CDN index HTTP ${response.status}`);
  cdn = await response.json();
} finally {
  clearTimeout(timeout);
}

let samePath = 0;
let stalePathExisting = 0;
let stalePathMissing = 0;
let staleOnlyItems = 0;
const missing = [];

for (const stale of cdn.items || []) {
  const current = currentById.get(`${stale.type}:${stale.id}`);
  if (!current) {
    staleOnlyItems += 1;
    continue;
  }
  if (current.detailPath === stale.detailPath) {
    samePath += 1;
    continue;
  }
  try {
    await fs.access(stale.detailPath);
    stalePathExisting += 1;
  } catch {
    stalePathMissing += 1;
    if (missing.length < 100) {
      missing.push({
        id: stale.id,
        type: stale.type,
        nameFa: stale.nameFa,
        name: stale.name,
        staleDetailPath: stale.detailPath,
        currentDetailPath: current.detailPath,
      });
    }
  }
}

console.log(JSON.stringify({
  currentItems: (rawCurrent.items || []).length,
  cdnItems: (cdn.items || []).length,
  samePath,
  stalePathExisting,
  stalePathMissing,
  staleOnlyItems,
  firstMissing: missing,
}, null, 2));

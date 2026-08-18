import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = '00f4309f8ab169f74901bb9ed81e9578f6e2b9fd';
const current = JSON.parse(fs.readFileSync('catalog-index.json', 'utf8'));
const before = JSON.parse(execFileSync('git', ['show', `${BASE}:catalog-index.json`], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
}));

const needles = [
  'justice league',
  'miraculous world',
  'aurora teagarden',
  'knutsen',
  'ludvigsen',
  'madea',
  'paw patrol',
  'troll (2022)',
];

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const norm = (value) => clean(value).normalize('NFKC').toLowerCase();

function selectedItems(catalog) {
  return (Array.isArray(catalog?.items) ? catalog.items : []).filter((item) => {
    const haystack = [item?.collectionName, item?.name].map(norm).join(' | ');
    return needles.some((needle) => haystack.includes(needle));
  });
}

function summarize(catalog) {
  const groups = new Map();
  for (const item of selectedItems(catalog)) {
    const key = clean(item.collectionName) || `NO_COLLECTION:${clean(item.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].map(([collectionName, items]) => ({
    collectionName,
    collectionNameFa: [...new Set(items.map((item) => clean(item.collectionNameFa)).filter(Boolean))],
    items: items.map((item) => ({
      id: item.id,
      name: clean(item.name),
      nameFa: clean(item.nameFa),
      collectionOrder: item.collectionOrder ?? null,
    })),
  }));
}

const result = {
  base: BASE,
  before: summarize(before),
  current: summarize(current),
};
console.log(JSON.stringify(result, null, 2));

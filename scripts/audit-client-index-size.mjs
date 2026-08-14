import fs from 'node:fs/promises';

const raw = await fs.readFile('catalog-index.json', 'utf8');
const payload = JSON.parse(raw);
const items = Array.isArray(payload.items) ? payload.items : [];
const fieldBytes = new Map();
const fieldCounts = new Map();

for (const item of items) {
  if (!item || typeof item !== 'object') continue;
  for (const [key, value] of Object.entries(item)) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    fieldBytes.set(key, (fieldBytes.get(key) || 0) + bytes);
    fieldCounts.set(key, (fieldCounts.get(key) || 0) + 1);
  }
}

const ranked = [...fieldBytes.entries()]
  .map(([field, bytes]) => ({ field, bytes, count: fieldCounts.get(field) || 0 }))
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 35);

const topLevel = Object.fromEntries(Object.entries(payload)
  .filter(([key]) => key !== 'items')
  .map(([key, value]) => [key, Buffer.byteLength(JSON.stringify(value))]));

console.log(JSON.stringify({
  totalBytes: Buffer.byteLength(raw),
  itemCount: items.length,
  averageItemBytes: items.length ? Math.round(Buffer.byteLength(raw) / items.length) : 0,
  topLevel,
  rankedItemFields: ranked,
}, null, 2));

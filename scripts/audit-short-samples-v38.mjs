import fs from 'node:fs/promises';
const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const rows = (catalog.items || [])
  .filter((item) => item?.operatorOnly === true && /-ff92-11f0-/i.test(String(item.id || '')))
  .map((item) => ({
    id: item.id, nameFa: item.nameFa, name: item.name, year: item.year,
    poster: item.poster, contentKind: item.contentKind, isDocumentary: item.isDocumentary,
    genres: item.genres, categoryKeys: item.categoryKeys,
    overview: String(item.overview || '').slice(0, 220), source: item.source,
  }));
console.log(JSON.stringify({count: rows.length, rows}, null, 2));
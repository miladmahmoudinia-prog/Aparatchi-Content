import fs from 'node:fs';

const path = 'scripts/title-collection-truth-v18.mjs';
let source = fs.readFileSync(path, 'utf8');

if (!source.includes("['aurora teagarden mystery collection', 'کالکشن رازهای آرورا تیگاردن']")) {
  const block = `
  ['justice league tomorrowverse collection', 'کالکشن لیگ عدالت (تومارورس)'],
  ['miraculous world', 'کالکشن دنیای دختر کفشدوزکی'],
  ['aurora teagarden mystery collection', 'کالکشن رازهای آرورا تیگاردن'],
  ['knutsen ludvigsen collection', 'کالکشن زبر و زرنگ'],
  ['madea collection', 'کالکشن مادیا'],
  ['paw patrol theatrical collection', 'کالکشن سگ‌های نگهبان'],
  ['troll 2022 collection', 'کالکشن غول'],`;
  const marker = '\n]);\n\nconst PERSIAN_DIGITS';
  if (!source.includes(marker)) throw new Error('KNOWN_COLLECTION_OVERRIDES end marker not found');
  source = source.replace(marker, `${block}\n]);\n\nconst PERSIAN_DIGITS`);
  fs.writeFileSync(path, source);
}
console.log(JSON.stringify({ alignedKnownCollectionOverrides: true }, null, 2));

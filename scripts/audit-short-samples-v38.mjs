import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const normalize = (value) => String(value || '')
  .toLowerCase().normalize('NFKC')
  .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();

const needles = [
  'تیزر جشنواره ارغوان','لمس جهان','دنیای شیرین','داستانی از تلاش و امید','دورون بی وزنی',
  'داستان زندگی دو خواهر ناشنوا','همنشین آبی','من هم هستم','محبت بی واژه','رنگ زندگی',
  'روبیک بی برجسته','دیجیتال','رقص برگ های بی قرار','کمیک','دنیای تفاوت ها','دنیای شادی',
  'یک روز معمولی','دستان گچی','دغدغه','ملودی چوب','معلم معلول','فروغ فرخزاد','پا به پای آزادی',
  'امپراتور و ما','اشغال جزایر','اتو استاپ','آزادی در مه'
].map(normalize);

const rows = (catalog.items || []).filter((item) => {
  const text = normalize(`${item.nameFa || ''} ${item.name || ''}`);
  return needles.some((needle) => needle && text.includes(needle));
}).map((item) => ({
  id: item.id, type: item.type, nameFa: item.nameFa, name: item.name, year: item.year,
  operatorOnly: item.operatorOnly, contentVariant: item.contentVariant,
  contentKind: item.contentKind, isDocumentary: item.isDocumentary,
  collectionId: item.collectionId, collectionNameFa: item.collectionNameFa, collectionName: item.collectionName,
  genres: item.genres, categoryKeys: item.categoryKeys, categoryLabels: item.categoryLabels,
  overview: String(item.overview || '').slice(0, 500), source: item.source,
}));
console.log(JSON.stringify({count: rows.length, rows}, null, 2));
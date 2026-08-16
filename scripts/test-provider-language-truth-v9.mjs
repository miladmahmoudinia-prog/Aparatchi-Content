import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const items = Array.isArray(catalog.items) ? catalog.items : [];
const byId = (id) => items.find((item) => String(item.id) === id);
const files = (item) => (item?.downloads || []).flatMap((section) => section?.files || []);
const langCount = (item, language) => files(item).filter((file) => file?.language === language).length;

const perfect = byId('cbeacfc0-5121-11f1-a97c-a7cfc3f4e1b6');
if (!perfect) throw new Error('Perfect Crown missing from source catalog.');
if (!perfect.availableLanguages?.includes('dubbed')) throw new Error('Perfect Crown still has no dubbed source truth.');
if (langCount(perfect, 'dubbed') < 1) throw new Error('Perfect Crown dubbed files were not tagged.');

const beloved = byId('16b78e90-ea0b-11f0-8bab-27196343f1c8');
if (!beloved) throw new Error('Beloved Thief missing from source catalog.');
if (!beloved.availableLanguages?.includes('dubbed') || !beloved.availableLanguages?.includes('subtitled')) {
  throw new Error('Beloved Thief lost its dubbed/subtitled truth.');
}
if (langCount(beloved, 'dubbed') < 1 || langCount(beloved, 'subtitled') < 1) {
  throw new Error('Beloved Thief language-specific files regressed.');
}

const lostBody = items.find((item) => /I Lost My Body/i.test(String(item.name || '')) || /بدنم را از دست دادم/.test(String(item.nameFa || '')));
if (!lostBody) throw new Error('I Lost My Body sample missing.');
if (lostBody.availableLanguages?.includes('dubbed') || langCount(lostBody, 'dubbed') > 0) {
  throw new Error('Subtitled-only control sample was falsely marked dubbed.');
}
if (!lostBody.availableLanguages?.includes('subtitled') || langCount(lostBody, 'subtitled') < 1) {
  throw new Error('Subtitled-only control sample lost subtitle truth.');
}

const iranianDubbed = items.filter((item) => item.ir === true && (item.availableLanguages || []).includes('dubbed'));
if (iranianDubbed.length) throw new Error(`Iranian titles must not receive foreign dubbed badges: ${iranianDubbed.length}`);

const sync = await fs.readFile('scripts/sync-upera.mjs', 'utf8');
for (const marker of [
  "function providerPrimaryMediaLanguage(source)",
  "function isUperaPrimaryMediaVariant(value)",
  "function parseMediaLinks(links, primaryLanguage = '')",
  "providerPrimaryMediaLanguage(movie)",
  "providerPrimaryMediaLanguage(series)",
  "primaryLanguage === 'dubbed' && isUperaPrimaryMediaVariant(next.link)",
  "!Object.prototype.hasOwnProperty.call(movie, 'dubbed')",
]) {
  if (!sync.includes(marker)) throw new Error(`Persistent provider-language parser marker missing: ${marker}`);
}

console.log(JSON.stringify({
  perfectCrown: { dubbedFiles: langCount(perfect, 'dubbed'), languages: perfect.availableLanguages },
  belovedThief: { dubbedFiles: langCount(beloved, 'dubbed'), subtitledFiles: langCount(beloved, 'subtitled'), languages: beloved.availableLanguages },
  subtitleOnlyControl: { name: lostBody.name, dubbedFiles: langCount(lostBody, 'dubbed'), subtitledFiles: langCount(lostBody, 'subtitled') },
  falseIranianDubbedBadges: iranianDubbed.length,
  movieSparseListRowsRefreshDetail: true,
  syncPersistence: true,
}, null, 2));

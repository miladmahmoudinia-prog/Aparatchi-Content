import fs from 'node:fs/promises';

const index = JSON.parse(await fs.readFile('catalog-index.json', 'utf8'));

const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
const safeFiles = (detail) => (detail.downloads || []).flatMap((section) =>
  (section.files || []).map((file) => ({ section, file }))
).filter(({ file }) => file && /^https?:\/\//i.test(String(file.url || '')) && !/operator/i.test(String(file.mode || '')));

const samples = [
  { key: 'memory', names: ['memory of a killer', 'خاطرات یک آدمکش'], expected: ['subtitled'] },
  // Upera currently exposes two distinct concrete download families for Hijack:
  // -0- (dubbed) and -11- (explicitly subtitled). Keep both; the Mobile sheet
  // must label them separately instead of hiding the real subtitle family.
  { key: 'hijack', names: ['hijack', 'ربودن'], expected: ['dubbed', 'subtitled'] },
  { key: 'fire-force', names: ['fire force', 'نیروی آتش'], expected: ['subtitled'] },
];

let failed = false;
for (const sample of samples) {
  const item = (index.items || []).find((candidate) => {
    const names = [normalize(candidate.name), normalize(candidate.nameFa)];
    return sample.names.some((wanted) => names.includes(normalize(wanted)));
  });
  if (!item) {
    console.error(`[${sample.key}] MISSING FROM APP-FACING INDEX`);
    failed = true;
    continue;
  }
  if (!item.detailPath) {
    console.error(`[${sample.key}] missing detailPath for ${item.id}`);
    failed = true;
    continue;
  }

  const detail = JSON.parse(await fs.readFile(item.detailPath, 'utf8'));
  const entries = safeFiles(detail);
  const byLanguage = new Map();
  for (const { section, file } of entries) {
    const language = String(file.language || '').trim();
    if (!['dubbed', 'subtitled'].includes(language)) continue;
    const list = byLanguage.get(language) || [];
    list.push({
      mode: file.mode || '',
      url: file.url,
      sectionId: section.id,
      sectionTitle: section.title || '',
      sectionBadge: section.badge || '',
      sectionSubtitle: section.subtitle || '',
      season: section.seasonNumber,
      episode: section.episodeNumber,
      label: file.label || file.quality || '',
      fileTitle: file.title || '',
    });
    byLanguage.set(language, list);
  }

  const languages = [...byLanguage.keys()].sort();
  const expected = [...sample.expected].sort();
  const duplicateCrossLanguageUrls = [];
  const urlLanguages = new Map();
  for (const [language, files] of byLanguage) {
    for (const file of files) {
      const key = String(file.url || '').trim();
      if (!key) continue;
      const set = urlLanguages.get(key) || new Set();
      set.add(language);
      urlLanguages.set(key, set);
    }
  }
  for (const [url, langs] of urlLanguages) {
    if (langs.size > 1) duplicateCrossLanguageUrls.push({ url, languages: [...langs] });
  }

  console.log(`\n[${sample.key}] ${item.nameFa} / ${item.name}`);
  console.log('index.availableLanguages=', JSON.stringify(item.availableLanguages || []));
  console.log('detail languages=', JSON.stringify(languages));
  for (const [language, files] of byLanguage) {
    const modes = [...new Set(files.map((entry) => entry.mode))];
    const uniqueUrls = new Set(files.map((entry) => entry.url));
    console.log(`${language}: files=${files.length}, urls=${uniqueUrls.size}, modes=${modes.join(',')}`);
    console.log(`${language} samples=`, JSON.stringify(files.slice(0, 6).map((entry) => ({
      mode: entry.mode,
      sectionId: entry.sectionId,
      sectionTitle: entry.sectionTitle,
      sectionBadge: entry.sectionBadge,
      sectionSubtitle: entry.sectionSubtitle,
      season: entry.season,
      episode: entry.episode,
      label: entry.label,
      fileTitle: entry.fileTitle,
      url: entry.url,
    }))));
  }
  if (duplicateCrossLanguageUrls.length) {
    console.error('cross-language duplicate URLs=', JSON.stringify(duplicateCrossLanguageUrls.slice(0, 10)));
  }

  const indexLanguages = [...new Set((item.availableLanguages || []).filter((value) => ['dubbed', 'subtitled'].includes(value)))].sort();
  if (JSON.stringify(languages) !== JSON.stringify(expected)) {
    console.error(`[${sample.key}] detail mismatch: expected ${expected.join(',')} but got ${languages.join(',') || 'none'}`);
    failed = true;
  }
  if (JSON.stringify(indexLanguages) !== JSON.stringify(expected)) {
    console.error(`[${sample.key}] index mismatch: expected ${expected.join(',')} but got ${indexLanguages.join(',') || 'none'}`);
    failed = true;
  }
  if (duplicateCrossLanguageUrls.length) failed = true;
}

if (failed) process.exit(1);
console.log('\nReported language samples are truthful in app-facing catalog.');

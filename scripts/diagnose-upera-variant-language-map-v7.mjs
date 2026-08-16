import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile('catalog.json', 'utf8'));
const counts = new Map();
const variantTitles = new Map();
const unlabeledCounts = new Map();

const variantFromUrl = (value) => {
  const text = String(value || '');
  if (!/upera\.tv|upera\.link|seeko\.film/i.test(text)) return '';
  const path = (() => { try { return new URL(text).pathname; } catch { return text; } })();
  const name = path.split('/').pop() || '';
  const matches = [...name.matchAll(/-(\d+)-/g)];
  if (!matches.length) return '';
  return matches[matches.length - 1][1];
};

for (const item of catalog.items || []) {
  const seen = new Set();
  for (const section of item.downloads || []) {
    for (const file of section.files || []) {
      const variant = variantFromUrl(file.url);
      if (!variant) continue;
      const language = file.language === 'dubbed' || file.language === 'subtitled' ? file.language : 'unlabeled';
      if (language === 'unlabeled') {
        unlabeledCounts.set(variant, (unlabeledCounts.get(variant) || 0) + 1);
      } else {
        const key = `${variant}:${language}`;
        counts.set(key, (counts.get(key) || 0) + 1);
        seen.add(key);
      }
    }
  }
  for (const key of seen) {
    if (!variantTitles.has(key)) variantTitles.set(key, []);
    const rows = variantTitles.get(key);
    if (rows.length < 15) rows.push({ id: item.id, nameFa: item.nameFa, name: item.name });
  }
}

const variants = [...new Set([...counts.keys()].map((key) => key.split(':')[0]))]
  .sort((a, b) => Number(a) - Number(b));
const report = variants.map((variant) => ({
  variant,
  dubbed: counts.get(`${variant}:dubbed`) || 0,
  subtitled: counts.get(`${variant}:subtitled`) || 0,
  unlabeled: unlabeledCounts.get(variant) || 0,
  dubbedExamples: variantTitles.get(`${variant}:dubbed`) || [],
  subtitledExamples: variantTitles.get(`${variant}:subtitled`) || [],
}));

const v0 = report.find((row) => row.variant === '0');
const v11 = report.find((row) => row.variant === '11');
console.log('UPERA_VARIANT_LANGUAGE_MAP=' + JSON.stringify(report));
console.log('UPERA_VARIANT_KEY_METRICS=' + JSON.stringify({
  variant0: v0 || null,
  variant11: v11 || null,
  variant0ExplicitConflict: Boolean(v0?.dubbed && v0?.subtitled),
  variant11ExplicitConflict: Boolean(v11?.dubbed && v11?.subtitled),
}));

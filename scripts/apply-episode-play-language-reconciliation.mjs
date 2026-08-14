import fs from 'node:fs/promises';

const target = 'scripts/client-catalog.mjs';
let source = await fs.readFile(target, 'utf8');

const marker = `  const languagesByUrl = new Map();`;
const patch = `  // For foreign episodic media, a generic HLS row can carry stale language
  // metadata even though every actual downloadable rendition of that exact
  // episode proves one different language. In that one-language case the HLS
  // stream follows the episode's concrete files. This prevents a fake second
  // playback option while preserving the real online stream.
  if (!iranian && !operatorVariant) {
    for (const section of prepared) {
      if (!Number(section?.episodeNumber || 0)) continue;
      const concreteLanguages = [...new Set((section.files || [])
        .filter((file) => file?.mode !== 'play')
        .map((file) => file?.language)
        .filter((value) => value === 'dubbed' || value === 'subtitled'))];
      if (concreteLanguages.length !== 1) continue;
      const concreteLanguage = concreteLanguages[0];
      section.files = (section.files || []).map((file) =>
        file?.mode === 'play' && file?.language !== concreteLanguage
          ? { ...file, language: concreteLanguage }
          : file
      );
    }
  }

${marker}`;

if (!source.includes('const concreteLanguages = [...new Set((section.files || [])')) {
  if (!source.includes(marker)) throw new Error('Could not locate client media reconciliation marker');
  source = source.replace(marker, patch);
}
await fs.writeFile(target, source, 'utf8');

console.log('Applied episode HLS language reconciliation.');

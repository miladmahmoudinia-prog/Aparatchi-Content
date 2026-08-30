import fs from 'node:fs';

const target = 'scripts/client-catalog.mjs';
let source = fs.readFileSync(target, 'utf8');

if (!source.includes('const preparedForClient = iranian')) {
  const insertionPoint = `  }\n\n  const languagesByUrl = new Map();`;
  const insertion = `  }\n\n  // Aparatchi exposes foreign media only when the source positively proves\n  // Persian dubbing or Persian subtitles. Native Iranian titles keep their\n  // ordinary Persian media without a redundant language badge.\n  const preparedForClient = iranian\n    ? prepared\n    : prepared.map((section) => ({\n        ...section,\n        files: (section.files || []).filter((file) =>\n          file?.language === 'dubbed' || file?.language === 'subtitled'\n        ),\n      }));\n\n  const languagesByUrl = new Map();`;
  if (!source.includes(insertionPoint)) throw new Error('preparedForClient insertion point not found');
  source = source.replace(insertionPoint, insertion);

  const marker = source.indexOf('  const preparedForClient = iranian');
  const head = source.slice(0, marker);
  let tail = source.slice(marker);
  tail = tail.replaceAll('for (const section of prepared) {', 'for (const section of preparedForClient) {');
  tail = tail.replace('const downloads = prepared.flatMap((section) => {', 'const downloads = preparedForClient.flatMap((section) => {');
  tail = tail.replace('if (neutralFiles.length) {', 'if (neutralFiles.length && iranian) {');
  source = head + tail;
}

if (!source.includes('if (!iranian && !availableLanguages.length) return null;')) {
  const languageBlock = `  const availableLanguages = [...new Set(downloads.flatMap((section) =>\n    (section.files || []).map((file) => file.language)\n      .filter((value) => value === 'dubbed' || value === 'subtitled')\n  ))];`;
  if (!source.includes(languageBlock)) throw new Error('availableLanguages block not found');
  source = source.replace(
    languageBlock,
    `${languageBlock}\n  // Foreign titles without proven Persian dub/sub are not part of the app catalog.\n  if (!iranian && !availableLanguages.length) return null;`,
  );
}

fs.writeFileSync(target, source);
console.log('Persian-only foreign media filtering applied.');

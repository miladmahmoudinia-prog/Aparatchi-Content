import fs from 'node:fs';

const target = 'scripts/client-catalog.mjs';
let source = fs.readFileSync(target, 'utf8');

const oldBlock = `  const availableLanguages = [...new Set(downloads.flatMap((section) =>\n    (section.files || []).map((file) => file.language)\n      .filter((value) => value === 'dubbed' || value === 'subtitled')\n  ))];`;

const newBlock = `  const availableLanguages = [...new Set(downloads.flatMap((section) =>\n    (section.files || []).map((file) => file.language)\n      .filter((value) => value === 'dubbed' || value === 'subtitled' || value === 'original')\n  ))];\n\n  // A foreign title with real direct media, no contradictory language rows and\n  // no positive dubbed/subtitled evidence is the source/original edition. Keep\n  // that truth in the compact catalog so poster cards never become unlabeled.\n  const hasNeutralUsableMedia = Boolean(\n    !iranian &&\n    !operatorVariant &&\n    conflicts.size === 0 &&\n    downloads.some((section) => (section.files || []).some((file) =>\n      !file?.language && clientSeriesFileIsUsable(file)\n    ))\n  );\n  if (!availableLanguages.length && hasNeutralUsableMedia) {\n    availableLanguages.push('original');\n  }`;

if (!source.includes(newBlock)) {
  if (!source.includes(oldBlock)) throw new Error('availableLanguages block not found');
  source = source.replace(oldBlock, newBlock);
}

const oldCategorySpread = `    ...availableLanguages,`;
const newCategorySpread = `    ...availableLanguages.filter((value) => value === 'dubbed' || value === 'subtitled'),`;
if (!source.includes(newCategorySpread)) {
  if (!source.includes(oldCategorySpread)) throw new Error('language category spread not found');
  source = source.replace(oldCategorySpread, newCategorySpread);
}

fs.writeFileSync(target, source);
console.log('Client catalog now preserves truthful original-version badge metadata.');

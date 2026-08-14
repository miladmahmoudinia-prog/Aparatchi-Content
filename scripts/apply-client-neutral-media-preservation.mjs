import fs from 'node:fs/promises';

const path = 'scripts/client-catalog.mjs';
let source = await fs.readFile(path, 'utf8');

const before = `      const language = clientFileLanguage(file, section);\n      if (!iranian && language !== 'dubbed' && language !== 'subtitled') return [];\n      return [{ ...file, ...(language ? { language } : {}) }];`;
const after = `      const language = clientFileLanguage(file, section);\n      // Missing language metadata is not proof that a real Upera file is bad.\n      // Preserve it neutrally; the mobile UI must not invent dubbed/subtitled\n      // labels for these rows. Positively identified languages still win.\n      return [{ ...file, ...(language ? { language } : {}) }];`;

if (source.includes(before)) source = source.replace(before, after);
else if (!source.includes(after)) throw new Error('Foreign unlabelled-media drop rule not found.');

await fs.writeFile(path, source, 'utf8');
console.log('Client catalog now preserves real unlabelled foreign media without manufacturing a language.');

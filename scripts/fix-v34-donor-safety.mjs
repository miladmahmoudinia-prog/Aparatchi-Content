import fs from 'node:fs/promises';

const file = 'scripts/operator-metadata-repair.mjs';
let source = await fs.readFile(file, 'utf8');
const before = `    const year = Number(item.year || 0);\n    for (const name of titleNames(item)) {\n      if (year) candidates.push(['exact-title-year-donor', donorByTitleYear.get(\`${'${item.type}|${year}|${name}'}\`)]);\n      candidates.push(['unique-title-donor', donorByUniqueTitle.get(\`${'${item.type}|${name}'}\`)]);\n    }`;
const after = `    const year = Number(item.year || 0);\n    for (const name of titleNames(item)) {\n      if (year) {\n        candidates.push(['exact-title-year-donor', donorByTitleYear.get(\`${'${item.type}|${year}|${name}'}\`)]);\n      } else {\n        // A title-only donor is safe only when the operator shell has no year.\n        // Never let a same-name production from another year overwrite metadata.\n        candidates.push(['unique-title-donor', donorByUniqueTitle.get(\`${'${item.type}|${name}'}\`)]);\n      }\n    }`;
if (!source.includes(before)) throw new Error('v34 donor-safety marker not found');
source = source.replace(before, after);
await fs.writeFile(file, source, 'utf8');
console.log('Applied year-safe operator donor matching.');
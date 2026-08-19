import fs from 'node:fs';
const path = 'scripts/apply-smart-categories-v38.mjs';
let source = fs.readFileSync(path, 'utf8');
source = source.replace(
  `  "  'programs', 'dubbed', 'subtitled', 'documentaries', 'wildlife', 'collections',",\n  "  'programs', 'dubbed', 'subtitled', 'documentaries', 'short-films', 'wildlife', 'collections',",`,
  `  "'documentaries', 'wildlife', 'collections'",\n  "'documentaries', 'short-films', 'wildlife', 'collections'",`,
);
fs.writeFileSync(path, source);
console.log('Fixed smart categories v38 generator anchors');
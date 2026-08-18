import fs from 'node:fs/promises';

const file = 'scripts/client-catalog.mjs';
let source = await fs.readFile(file, 'utf8');

const startMarker = '  // Fresh installs should paint a truthful Home immediately instead of exposing\n';
const endMarker = '  const bootstrapSerialized = `${JSON.stringify(bootstrap)}\\n`;\n';
const start = source.indexOf(startMarker);
if (start < 0) throw new Error('startup bootstrap start marker not found');
const endStart = source.indexOf(endMarker, start);
if (endStart < 0) throw new Error('startup bootstrap end marker not found');
const end = endStart + endMarker.length;

const replacement = [
  '  // Cold start only needs the current Home truth. Shipping every visible title',
  '  // made this file multi-megabytes and forced the splash screen to wait behind',
  '  // network parsing. Home rows are already compact client summaries, including',
  '  // only bounded play/download previews and the first-screen people/backdrop data.',
  '  // Full navigation/search remains in catalog-index.json and loads after first paint.',
  '  const bootstrapItems = bootstrapItemsForHome(items);',
  '  const bootstrap = {',
  '    version: index.version,',
  '    updatedAt: index.updatedAt,',
  '    items: bootstrapItems,',
  '    iranianSchedule: index.iranianSchedule,',
  '    weeklySchedule: index.weeklySchedule,',
  '    featuredPeople: index.featuredPeople,',
  '    ...(index.imdbTop100 ? { imdbTop100: index.imdbTop100 } : {}),',
  '  };',
  '  const bootstrapSerialized = `${JSON.stringify(bootstrap)}\\n`;',
  '',
].join('\n');

source = source.slice(0, start) + replacement + source.slice(end);
await fs.writeFile(file, source, 'utf8');
console.log('Patched client-catalog startup bootstrap.');

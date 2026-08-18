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
  '  // (and especially episode/action previews) made this file multi-megabytes and',
  '  // forced the splash screen to wait behind network parsing. Keep only the rows',
  '  // that can actually appear on Home; the complete index still loads after first',
  '  // paint and every row keeps detailPath for immediate detail hydration.',
  '  const richHomeItems = bootstrapItemsForHome(items);',
  '  const bootstrapItems = richHomeItems.map((item) => {',
  '    const compact = {};',
  '    for (const field of BOOTSTRAP_NAVIGATION_FIELDS) {',
  '      if (Object.prototype.hasOwnProperty.call(item || {}, field)) compact[field] = item[field];',
  '    }',
  '    // Home/hero/detail-first-paint fields are cheap and prevent a second visible',
  '    // pop-in after the startup cover disappears. Media archives are intentionally',
  '    // omitted; opening a title hydrates its immutable detail shard.',
  "    for (const field of ['backdrop', 'backdropFallback', 'overview', 'genres', 'countryLabels', 'countryNames', 'people']) {",
  '      if (Object.prototype.hasOwnProperty.call(item || {}, field)) compact[field] = item[field];',
  '    }',
  '    delete compact.downloads;',
  '    delete compact.streamUrl;',
  '    delete compact.streamMode;',
  '    return compact;',
  '  });',
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

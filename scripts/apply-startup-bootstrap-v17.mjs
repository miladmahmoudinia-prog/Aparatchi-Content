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

const replacement = `  // Cold start only needs the current Home truth. Shipping every visible title\n  // (and especially episode/action previews) made this file multi-megabytes and\n  // forced the splash screen to wait behind network parsing. Keep only the rows\n  // that can actually appear on Home; the complete index still loads after first\n  // paint and every row keeps detailPath for immediate detail hydration.\n  const richHomeItems = bootstrapItemsForHome(items);\n  const bootstrapItems = richHomeItems.map((item) => {\n    const compact = {};\n    for (const field of BOOTSTRAP_NAVIGATION_FIELDS) {\n      if (Object.prototype.hasOwnProperty.call(item || {}, field)) compact[field] = item[field];\n    }\n    // Home/hero/detail-first-paint fields are cheap and prevent a second visible\n    // pop-in after the startup cover disappears. Media archives are intentionally\n    // omitted; opening a title hydrates its immutable detail shard.\n    for (const field of ['backdrop', 'backdropFallback', 'overview', 'genres', 'countryLabels', 'countryNames', 'people']) {\n      if (Object.prototype.hasOwnProperty.call(item || {}, field)) compact[field] = item[field];\n    }\n    delete compact.downloads;\n    delete compact.streamUrl;\n    delete compact.streamMode;\n    return compact;\n  });\n  const bootstrap = {\n    version: index.version,\n    updatedAt: index.updatedAt,\n    items: bootstrapItems,\n    iranianSchedule: index.iranianSchedule,\n    weeklySchedule: index.weeklySchedule,\n    featuredPeople: index.featuredPeople,\n    ...(index.imdbTop100 ? { imdbTop100: index.imdbTop100 } : {}),\n  };\n  const bootstrapSerialized = \\`${'${JSON.stringify(bootstrap)}'}\\\\n\\`;\n`;

source = source.slice(0, start) + replacement + source.slice(end);
await fs.writeFile(file, source, 'utf8');
console.log('Patched client-catalog startup bootstrap.');

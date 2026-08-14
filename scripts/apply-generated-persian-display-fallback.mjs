import fs from 'node:fs/promises';

const sharedPath = 'scripts/persian-title-overrides.mjs';
let shared = await fs.readFile(sharedPath, 'utf8');

// The old generated-transliteration fallback produced labels such as
// «لست اپویینتمنت». Keep authoritative/verified Persian titles, but when no
// trustworthy Persian title exists show the original title instead of inventing
// a Persian-looking pronunciation.
const lastAppointmentEntry = `  ['last appointment', 'آخرین قرار'],\n`;
if (!shared.includes("['last appointment', 'آخرین قرار']")) {
  const anchor = `const VERIFIED_PERSIAN_TITLE_ENTRIES = [\n`;
  if (!shared.includes(anchor)) throw new Error('Verified Persian title list not found.');
  shared = shared.replace(anchor, anchor + lastAppointmentEntry);
}

const oldGeneratedFunction = /function applyGeneratedPersianDisplayTitles\(items\) \{[\s\S]*?\n\}\n\nfunction collectionMemberOrder/;
const replacement = `function applyGeneratedPersianDisplayTitles(items) {\n  let changes = 0;\n  for (const item of items) {\n    if (!item || !['movie', 'series'].includes(item.type)) continue;\n    const wasGenerated = item.nameFaGenerated === true || item.nameFaSource === GENERATED_TITLE_SOURCE;\n    if (!wasGenerated) continue;\n\n    const original = cleanDisplayText(item.name);\n    if (original && item.nameFa !== original) {\n      item.nameFa = original;\n      changes += 1;\n    }\n    delete item.nameFaGenerated;\n    item.nameFaSource = 'original-title-fallback';\n  }\n  return changes;\n}\n\nfunction collectionMemberOrder`;
if (!oldGeneratedFunction.test(shared)) throw new Error('Generated display-title function not found.');
shared = shared.replace(oldGeneratedFunction, replacement);

await fs.writeFile(sharedPath, shared, 'utf8');

const enrichPath = 'scripts/enrich-persian-titles.mjs';
let enrich = await fs.readFile(enrichPath, 'utf8');
if (!enrich.includes("['last appointment', 'آخرین قرار']")) {
  const anchor = `const VERIFIED_PERSIAN_TITLE_OVERRIDES = new Map([\n`;
  if (!enrich.includes(anchor)) throw new Error('Enrichment verified-title list not found.');
  enrich = enrich.replace(anchor, anchor + lastAppointmentEntry);
}
await fs.writeFile(enrichPath, enrich, 'utf8');

console.log('Synthetic Persian transliteration retired; verified titles stay authoritative and unknown titles fall back to the original name.');

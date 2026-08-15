import fs from 'node:fs/promises';

// Reuse the v3 permanent classifier/test/repair generator, then harden the
// recovery audit against Persian source labels that only contain Latin text in
// a media extension such as "مارمالادی.mp4".
await import('./patch-persian-title-source-policy-v3.mjs');

const repairPath = 'scripts/repair-transliterated-persian-titles-v3.mjs';
let source = await fs.readFile(repairPath, 'utf8');

const oldBlock = `  const previousName = String(previous.name || '').trim();\n  if (!/\\p{Script=Latin}/u.test(previousName)) return false;\n  const previousFa = String(previous.nameFa || '').trim();`;
const newBlock = `  const previousName = String(previous.name || '').trim().replace(/\\.mp4$/i, '').trim();\n  // The source itself must be a Latin title. Persian/native titles with a\n  // Latin file extension are outside English-to-Persian transliteration.\n  if (!/\\p{Script=Latin}/u.test(previousName) || /[\\u0600-\\u06FF]/.test(previousName)) return false;\n  const previousFa = String(previous.nameFa || '').trim();`;

if (source.includes(oldBlock)) {
  source = source.replace(oldBlock, newBlock);
} else if (!source.includes("trim().replace(/\\.mp4$/i, '').trim();")) {
  throw new Error('Proper-name recovery audit block not found.');
}

await fs.writeFile(repairPath, source, 'utf8');
console.log('Persian title policy v4: media-extension language false positives excluded.');

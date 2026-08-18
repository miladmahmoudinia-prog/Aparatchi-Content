import fs from 'node:fs/promises';

const path = 'scripts/persian-title-overrides.mjs';
let source = await fs.readFile(path, 'utf8');

const unsafeClassifier = `function collectionNameLooksLikeInstallment(value, members) {\n  const current = cleanDisplayText(value);\n  if (!current || !hasPersianScript(current)) return false;\n  const normalizedCurrent = normalizePersianOverrideKey(current.replace(/^مجموعه\\s+/u, ''));\n  const equalsMember = members.some((item) =>\n    normalizePersianOverrideKey(item?.nameFa) === normalizedCurrent\n  );\n  const numbered = /(?:^|\\s)(?:قسمت|بخش|فصل)\\s+(?:[۰-۹0-9]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\\s*$/u.test(current) ||\n    /\\s[۰-۹0-9]+\\s*$/u.test(current);\n  return equalsMember || numbered;\n}\n`;

const safeClassifier = `function collectionNameLooksLikeInstallment(value, members) {\n  const current = cleanDisplayText(value);\n  if (!current || !hasPersianScript(current)) return false;\n  const stripped = current.replace(/^مجموعه\\s+/u, '').trim();\n  const normalizedCurrent = normalizePersianOverrideKey(stripped);\n  if (!normalizedCurrent) return false;\n\n  const hasSeparator = /[:：؛]/u.test(stripped) || /\\s[-–—]\\s/u.test(stripped);\n  const hasPartSuffix = /(?:^|\\s)(?:قسمت|بخش|فصل)\\s+(?:[۰-۹0-9]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم)\\s*$/u.test(stripped);\n  const hasNumericSuffix = /\\s[۰-۹0-9]+(?:[٫.][۰-۹0-9]+)?\\s*$/u.test(stripped);\n\n  // A franchise base may legitimately equal its first movie title (Batman,\n  // Scream, Superman, ...). Only installment-shaped folder labels are bad.\n  if (!hasSeparator && !hasPartSuffix && !hasNumericSuffix) return false;\n\n  const equalsMember = members.some((item) =>\n    normalizePersianOverrideKey(item?.nameFa) === normalizedCurrent\n  );\n  if (equalsMember) return true;\n\n  if (hasSeparator) {\n    const prefix = stripped.split(/\\s*(?:[:：؛]|\\s[-–—]\\s)\\s*/u)[0]?.trim();\n    if (prefix && members.some((item) =>\n      normalizePersianOverrideKey(persianCollectionBaseFromTitle(item?.nameFa)) === normalizePersianOverrideKey(prefix)\n    )) return true;\n  }\n  return hasPartSuffix || hasNumericSuffix;\n}\n`;

if (source.includes(unsafeClassifier)) {
  source = source.replace(unsafeClassifier, safeClassifier);
} else if (!source.includes('A franchise base may legitimately equal its first movie title')) {
  throw new Error('Expected collection installment classifier was not found.');
}

const unsafeAssignment = `    const base = persianCollectionBaseFromTitle(source.nameFa);\n    if (!base) continue;\n    for (const item of members) {\n      if (item.collectionNameFa !== base) {\n        item.collectionNameFa = base;\n        changes += 1;\n      }\n    }\n`;
const safeAssignment = `    const base = persianCollectionBaseFromTitle(source.nameFa);\n    if (!base) continue;\n    const collectionLabel = /^مجموعه\\s+/u.test(base) ? base : \`مجموعه \${base}\`;\n    for (const item of members) {\n      if (item.collectionNameFa !== collectionLabel) {\n        item.collectionNameFa = collectionLabel;\n        changes += 1;\n      }\n    }\n`;

if (source.includes(unsafeAssignment)) {
  source = source.replace(unsafeAssignment, safeAssignment);
} else if (!source.includes('const collectionLabel = /^مجموعه\\s+/u.test(base)')) {
  throw new Error('Expected collection label assignment was not found.');
}

await fs.writeFile(path, source, 'utf8');
console.log('Conservative collection source policy v18 applied.');

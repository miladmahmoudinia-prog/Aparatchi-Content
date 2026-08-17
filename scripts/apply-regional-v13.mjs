import fs from 'node:fs/promises';

const replaceOnce = (source, before, after, label) => {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(before, after);
};

let classification = await fs.readFile('scripts/classification.mjs', 'utf8');
classification = replaceOnce(
  classification,
  `  // Explicit country metadata is authoritative. Original language is only a\n  // fallback when the provider/TMDB did not supply any country at all; otherwise\n  // a stale language or legacy ir=true flag can wrongly turn foreign films Iranian.\n  const hasCountryIdentity = countryCodes.length > 0;\n  const iranianIdentity = hasCountryIdentity\n    ? countryCodes.includes('IR')\n    : (originalLanguage === 'fa' || input.ir === true);\n  const koreanIdentity = hasCountryIdentity\n    ? countryCodes.includes('KR')\n    : originalLanguage === 'ko';\n  const indianIdentity = hasCountryIdentity\n    ? countryCodes.includes('IN')\n    : indianLanguages.has(originalLanguage);`,
  `  // Country arrays include co-production partners. A title must not enter a\n  // nationality shelf merely because KR/IN appears somewhere in that array\n  // (for example Jexi, Past Lives or The Medium). Original language is the\n  // strongest identity signal for Korean/Indian shelves; primary country is\n  // only a fallback when language metadata is missing.\n  const hasCountryIdentity = countryCodes.length > 0;\n  const iranianIdentity = hasCountryIdentity\n    ? countryCodes.includes('IR')\n    : (originalLanguage === 'fa' || input.ir === true);\n  const primaryCountry = countryCodes[0] || '';\n  const koreanIdentity = originalLanguage\n    ? originalLanguage === 'ko'\n    : primaryCountry === 'KR';\n  const indianIdentity = originalLanguage\n    ? indianLanguages.has(originalLanguage)\n    : primaryCountry === 'IN';`,
  'regional identity must not use any co-production country',
);
classification = replaceOnce(
  classification,
  `    } else if (indianIdentity) {\n      categoryKeys.push(type === 'movie' ? 'indian-movies' : 'indian-series');\n      categoryLabels.push(type === 'movie' ? 'فیلم هندی' : 'سریال هندی');\n    } else {`,
  `    } else if (indianIdentity && type === 'movie') {\n      // Keep only the dedicated Indian movie shelf. Indian series remain fully\n      // browsable under foreign-series, as requested by the product UI.\n      categoryKeys.push('indian-movies');\n      categoryLabels.push('فیلم هندی');\n    } else {`,
  'Indian series falls back to foreign series',
);
await fs.writeFile('scripts/classification.mjs', classification);

let titles = await fs.readFile('scripts/persian-title-overrides.mjs', 'utf8');
titles = replaceOnce(
  titles,
  `  ['the lionheart', 'شیردل'],\n  ['our father', 'پدر ما'],`,
  `  ['the lionheart', 'شیردل'],\n  ['our father', 'پدر ما'],\n  // Upera currently exposes this Korean title in Arabic (حديقة الربيع).\n  // Keep the display language consistently Persian.\n  ['spring garden', 'باغ بهاری'],`,
  'Spring Garden Persian title override',
);
await fs.writeFile('scripts/persian-title-overrides.mjs', titles);

console.log('Applied regional classification/title source fixes v13.');

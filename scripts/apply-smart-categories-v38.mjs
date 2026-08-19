import fs from 'node:fs';

const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Missing anchor: ${label}`);
  return source.slice(0, index) + after + source.slice(index + before.length);
};

let classification = fs.readFileSync('scripts/classification.mjs', 'utf8');
classification = replaceOnce(
  classification,
  "  'documentaries', 'wildlife', 'collections',",
  "  'documentaries', 'short-films', 'wildlife', 'collections',",
  'managed short-film key',
);
classification = replaceOnce(
  classification,
  "  'تاک‌شو', 'مسابقه و رئالیتی‌شو', 'مستند', 'حیات وحش', 'کالکشن',",
  "  'تاک‌شو', 'مسابقه و رئالیتی‌شو', 'مستند', 'فیلم کوتاه', 'حیات وحش', 'کالکشن',",
  'managed short-film label',
);
classification = replaceOnce(
  classification,
  "const documentaryTerms = ['مستند', 'documentary'];",
  `const documentaryTerms = ['مستند', 'documentary'];\nconst documentaryOverviewTerms = [\n  'این مستند', 'مستندی درباره', 'مستندی از', 'فیلم مستند', 'روایت مستند', 'مستند درباره',\n  'documentary film', 'this documentary',\n];\nconst shortFilmTerms = [\n  'فیلم کوتاه', 'فیلم‌کوتاه', 'کوتاه داستانی', 'اثر کوتاه', 'آثار کوتاه',\n  'short film', 'short-film', 'short movie',\n];\nconst promotionalTitleTerms = [\n  'تیزر جشنواره', 'تیزر رویداد', 'تیزر رسمی', 'تریلر رسمی', 'آنونس',\n  'festival teaser', 'official teaser', 'official trailer',\n];\nconst verifiedArghavanShortTitles = new Set([\n  'دنیای شیرین', 'لمس جهان', 'محبت بی واژه', 'ملودی چوب', 'معلم معلول',\n  'داستان زندگی دو خواهر ناشنوا', 'همنشین آبی', 'داستانی از تلاش و امید', 'دستان گچی',\n  'دغدغه', 'یک روز معمولی', 'دورون بی وزنی', 'دورون بی‌وزنی', 'من هم هستم',\n  'رنگ زندگی', 'روبیک بی برجسته', 'رقص برگ های بی قرار', 'رقص برگ‌های بی‌قرار',\n  'کمیک', 'دنیای تفاوت ها', 'دنیای تفاوت‌ها', 'دنیای شادی', 'دیجیتال',\n  'من و موشموشک عمه', 'مسیر دلدادگی', 'مسیر دزدها',\n  'من میبینام بدنی ساکت دلی پر از عشق', 'من می‌بینم بدنی ساکت دلی پر از عشق',\n].map(normalize));`,
  'short/documentary signals',
);
classification = replaceOnce(
  classification,
  "  const validationVersion = Number(input.tmdbValidationVersion || input.validationVersion || 0);\n  const trustedTmdb = validationVersion >= 7;",
  "  const validationVersion = Number(input.tmdbValidationVersion || input.validationVersion || 0);\n  const trustedTmdb = validationVersion >= 7;\n  const operatorClassificationPending = input.operatorClassificationPending === true;",
  'operator pending flag',
);
classification = replaceOnce(
  classification,
  "    [2025, ['سلطان ناصر']],\n  ].some",
  "    [2025, ['سلطان ناصر']],\n    [2025, ['اشغال جزایر']],\n    [2004, ['اتو استاپ']],\n    [2007, ['آزادی در مه']],\n    [2006, ['امپراتور و ما']],\n    [1967, ['فروغ فرخزاد ۱۳۱۳ ۱۳۴۵', 'فروغ فرخزاد: ۱۳۱۳-۱۳۴۵']],\n    [2006, ['پا به پای آزادی']],\n  ].some",
  'verified documentary samples',
);
classification = replaceOnce(
  classification,
  "  const knownDocumentary = verifiedDocumentaryTitleYear || includesAny(titleText, [",
  "  const documentaryOverviewSignal = includesAny(overview, documentaryOverviewTerms);\n  const knownDocumentary = verifiedDocumentaryTitleYear || includesAny(titleText, [",
  'documentary overview signal declaration',
);
classification = replaceOnce(
  classification,
  "    : Boolean(knownDocumentary || explicitDocumentary || documentaryGenre);",
  "    : Boolean(knownDocumentary || explicitDocumentary || documentaryGenre || documentaryOverviewSignal);",
  'documentary overview signal use',
);
classification = replaceOnce(
  classification,
  "  const isGeneralProgram = includesAny(programIdentityText, generalProgramTerms);",
  "  const isGeneralProgram = includesAny(programIdentityText, generalProgramTerms) || includesAny(titleText, promotionalTitleTerms);",
  'promo content identity',
);
classification = replaceOnce(
  classification,
  "  const isProgram = isChildrenProgram || isTalkShow || isRealityCompetition || isGeneralProgram ||\n    (trustedSpecializedKind && existingKind === 'program');\n\n  const isQuran",
  `  const isProgram = isChildrenProgram || isTalkShow || isRealityCompetition || isGeneralProgram ||\n    (trustedSpecializedKind && existingKind === 'program');\n  const verifiedArghavanShort = Boolean(\n    type === 'movie' &&\n    Number(input.year || 0) === 2025 &&\n    exactTitleNames.some((name) => verifiedArghavanShortTitles.has(name))\n  );\n  const shortFilmSignal = includesAny(\n    \`${'${titleText} ${genreText} ${overview}'}\`,\n    shortFilmTerms,\n  );\n  const isShortFilm = Boolean(\n    type === 'movie' &&\n    !isAnimation && !isDocumentary && !isProgram &&\n    (verifiedArghavanShort || shortFilmSignal || existingKind === 'short-film' || existingKeys.includes('short-films'))\n  );\n\n  const isQuran`,
  'short film identity',
);
classification = replaceOnce(
  classification,
  "  const specialized = isAnimation || isDocumentary || isProgram || isReligiousProgram;",
  "  const specialized = isAnimation || isDocumentary || isShortFilm || isProgram || isReligiousProgram;",
  'short film specialized',
);
classification = replaceOnce(
  classification,
  "  const regionalEligible = !isAnimation && !isDocumentary && !isProgram && !isReligiousProgram;",
  "  const regionalEligible = !isAnimation && !isDocumentary && !isShortFilm && !isProgram && !isReligiousProgram && !operatorClassificationPending;",
  'regional pending/short exclusion',
);
classification = replaceOnce(
  classification,
  "  if (isDocumentary) {\n    if (isWildlife) {",
  "  if (isShortFilm) {\n    categoryKeys.push('short-films');\n    categoryLabels.push('فیلم کوتاه');\n  }\n  if (isDocumentary) {\n    if (isWildlife) {",
  'short film category output',
);
classification = replaceOnce(
  classification,
  "  else if (isAnimation) contentKind = type === 'movie' ? 'animation-movie' : 'animation-series';\n  else if (isDocumentary) contentKind = 'documentary';",
  "  else if (isAnimation) contentKind = type === 'movie' ? 'animation-movie' : 'animation-series';\n  else if (isShortFilm) contentKind = 'short-film';\n  else if (isDocumentary) contentKind = 'documentary';",
  'short film content kind',
);
classification = replaceOnce(
  classification,
  "    isDocumentary,\n    isWildlife,",
  "    isDocumentary,\n    isShortFilm,\n    isWildlife,",
  'short film return flag',
);
fs.writeFileSync('scripts/classification.mjs', classification);

let client = fs.readFileSync('scripts/client-catalog.mjs', 'utf8');
client = replaceOnce(
  client,
  "  'programs', 'dubbed', 'subtitled', 'documentaries', 'wildlife', 'collections',",
  "  'programs', 'dubbed', 'subtitled', 'documentaries', 'short-films', 'wildlife', 'collections',",
  'bootstrap short-film category',
);
fs.writeFileSync('scripts/client-catalog.mjs', client);

let sync = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');
sync = replaceOnce(
  sync,
  "const operatorOverviewTitlesPerRun = Math.min(\n  30,\n  nonNegativeInt(process.env.APARATCHI_OPERATOR_OVERVIEWS_PER_RUN, 12),\n);",
  `const operatorOverviewTitlesPerRun = Math.min(\n  30,\n  nonNegativeInt(process.env.APARATCHI_OPERATOR_OVERVIEWS_PER_RUN, 12),\n);\n\nconst operatorClassificationTitlesPerRun = Math.min(\n  40,\n  nonNegativeInt(process.env.APARATCHI_OPERATOR_CLASSIFICATION_PER_RUN, 16),\n);`,
  'operator classification budget',
);

sync = replaceOnce(
  sync,
  "async function enrichPeopleFromTmdb(item) {",
  `function operatorClassificationNeedsVerification(item) {\n  if (!item || catalogVariant(item) !== 'operator') return false;\n  const rules = classifyCatalogRules({ ...item, operatorClassificationPending: false });\n  if (rules.contentKind && !['movie', 'series'].includes(rules.contentKind)) return false;\n  if (item.operatorClassificationSource === 'tmdb' && Number(item.tmdbValidationVersion || 0) >= 7) return false;\n  const informativeGenres = (Array.isArray(item.genres) ? item.genres : [])\n    .map((value) => cleanText(value).toLowerCase())\n    .filter((value) => value && !['سایر', 'other', 'unknown', 'نامشخص'].includes(value));\n  const hasRegionTruth = Boolean(\n    (Array.isArray(item.countryCodes) && item.countryCodes.length) ||\n    cleanText(item.originalLanguage)\n  );\n  return !(informativeGenres.length > 0 && hasRegionTruth);\n}\n\nasync function enrichOperatorClassificationMetadata() {\n  if (!tmdbBearerToken || operatorClassificationTitlesPerRun <= 0) return;\n  const now = Date.now();\n  const retryMs = 24 * 60 * 60 * 1000;\n  const candidates = items\n    .filter((item) => operatorClassificationNeedsVerification(item))\n    .filter((item) => {\n      const checked = Date.parse(cleanText(item.operatorClassificationCheckedAt));\n      return !Number.isFinite(checked) || now - checked >= retryMs;\n    })\n    .sort((a, b) => peopleCandidateTimestamp(b) - peopleCandidateTimestamp(a))\n    .slice(0, operatorClassificationTitlesPerRun);\n\n  for (const item of candidates) {\n    if (runTimeBudgetReached('operator-classification', 35000)) break;\n    item.operatorClassificationCheckedAt = new Date().toISOString();\n    item.operatorClassificationStatus = 'pending';\n    try {\n      const title = await resolveTmdbTitle(item);\n      if (!title) continue;\n      const [detailsEn, detailsFa] = await Promise.all([\n        fetchTmdbJson(\`${'${title.mediaType}/${title.id}'}\`, { language: 'en-US' }),\n        fetchTmdbJson(\`${'${title.mediaType}/${title.id}'}\`, { language: 'fa-IR' }),\n      ]);\n      const genreObjects = Array.isArray(detailsEn?.genres) ? detailsEn.genres : [];\n      const genres = genreObjects.map((genre) => cleanText(genre?.name)).filter(Boolean);\n      if (genres.length) item.genres = genres;\n      const countryCodes = title.mediaType === 'tv'\n        ? (Array.isArray(detailsEn?.origin_country) ? detailsEn.origin_country : [])\n        : (Array.isArray(detailsEn?.production_countries) ? detailsEn.production_countries.map((entry) => entry?.iso_3166_1) : []);\n      if (countryCodes.filter(Boolean).length) item.countryCodes = uniqueStrings(countryCodes);\n      const originalLanguage = cleanText(detailsEn?.original_language);\n      if (originalLanguage) item.originalLanguage = originalLanguage;\n      const overviewFa = cleanText(detailsFa?.overview);\n      if (overviewFa && /[\\u0600-\\u06ff]/.test(overviewFa)) item.overview = overviewFa;\n      const genreIds = new Set(genreObjects.map((genre) => Number(genre?.id || 0)));\n      if (genreIds.has(99) || genres.some((genre) => /documentary/i.test(genre))) item.isDocumentary = true;\n      if (genreIds.has(16) || genres.some((genre) => /animation/i.test(genre))) item.isAnimation = true;\n      item.tmdbId = Number(title.id);\n      item.tmdbValidationVersion = Math.max(8, Number(item.tmdbValidationVersion || 0));\n      item.operatorClassificationSource = 'tmdb';\n      item.operatorClassificationStatus = operatorClassificationNeedsVerification(item) ? 'pending' : 'verified';\n    } catch (error) {\n      rememberError(\`operator-classification-\${String(item.id || 'unknown')}\`, error);\n    }\n  }\n}\n\nasync function enrichPeopleFromTmdb(item) {`,
  'smart operator classification helper',
);

sync = replaceOnce(
  sync,
  "items = items.map(reclassifyCatalogItem).map((item) => withSeriesPublicationState(item));",
  `if (!runTimeBudgetReached('before-operator-classification', 35000)) {\n  await enrichOperatorClassificationMetadata();\n}\nitems = items.map(reclassifyCatalogItem).map((item) => withSeriesPublicationState(item));`,
  'operator classification before final publish',
);

sync = replaceOnce(
  sync,
  "function reclassifyCatalogItem(item) {\n  if (!item || !['movie', 'series'].includes(item.type)) return item;\n  const classification = classifyCatalogRules(item);",
  `function reclassifyCatalogItem(item) {\n  if (!item || !['movie', 'series'].includes(item.type)) return item;\n  const operatorClassificationPending = operatorClassificationNeedsVerification(item);\n  const classification = classifyCatalogRules({ ...item, operatorClassificationPending });`,
  'operator pending classification gate',
);
sync = replaceOnce(
  sync,
  "    isDocumentary: classification.isDocumentary,\n    isWildlife: classification.isWildlife,",
  "    isDocumentary: classification.isDocumentary,\n    isShortFilm: classification.isShortFilm,\n    isWildlife: classification.isWildlife,\n    ...(catalogVariant(item) === 'operator' ? { operatorClassificationStatus: operatorClassificationPending ? 'pending' : (item.operatorClassificationStatus || 'resolved') } : {}),",
  'operator status and short flag',
);
fs.writeFileSync('scripts/sync-upera.mjs', sync);

const test = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\nimport { classifyCatalogItem } from '../classification.mjs';\n\ntest('Arghavan sample goes to short films, not Iranian movies', () => {\n  const result = classifyCatalogItem({ type: 'movie', year: 2025, nameFa: 'لمس جهان', name: 'لمس جهان', ir: true, genres: ['سایر'] });\n  assert.equal(result.contentKind, 'short-film');\n  assert.ok(result.categoryKeys.includes('short-films'));\n  assert.ok(!result.categoryKeys.includes('iranian-movies'));\n});\n\ntest('Arghavan teaser is a program, not a short or cinema movie', () => {\n  const result = classifyCatalogItem({ type: 'movie', year: 2025, nameFa: 'تیزر جشنواره ارغوان', ir: true, genres: ['سایر'] });\n  assert.equal(result.contentKind, 'program');\n  assert.ok(result.categoryKeys.includes('programs'));\n  assert.ok(!result.categoryKeys.includes('short-films'));\n  assert.ok(!result.categoryKeys.includes('iranian-movies'));\n});\n\ntest('reported documentary samples leave Iranian movies', () => {\n  for (const [nameFa, year] of [['فروغ فرخزاد: ۱۳۱۳-۱۳۴۵', 1967], ['پا به پای آزادی', 2006], ['امپراتور و ما', 2006], ['اشغال جزایر', 2025], ['اتو استاپ', 2004], ['آزادی در مه', 2007]]) {\n    const result = classifyCatalogItem({ type: 'movie', year, nameFa, ir: true, genres: ['سایر'] });\n    assert.equal(result.contentKind, 'documentary', nameFa);\n    assert.ok(result.categoryKeys.includes('documentaries'), nameFa);\n    assert.ok(!result.categoryKeys.includes('iranian-movies'), nameFa);\n  }\n});\n\ntest('unknown weak operator shell cannot pollute regional movie shelves', () => {\n  const result = classifyCatalogItem({ type: 'movie', nameFa: 'عنوان ناشناخته', ir: true, genres: ['سایر'], operatorClassificationPending: true });\n  assert.ok(!result.categoryKeys.includes('iranian-movies'));\n  assert.ok(!result.categoryKeys.includes('foreign-movies'));\n});\n\ntest('operator sync searches TMDB classification before final publish', () => {\n  const source = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');\n  assert.ok(source.includes('await enrichOperatorClassificationMetadata();'));\n  assert.ok(source.includes("item.operatorClassificationSource = 'tmdb'"));\n  assert.ok(source.includes('operatorClassificationNeedsVerification(item)'));\n});\n\ntest('client bootstrap carries short film category', () => {\n  const source = fs.readFileSync('scripts/client-catalog.mjs', 'utf8');\n  assert.ok(source.includes("'documentaries', 'short-films', 'wildlife'"));\n});\n`;
fs.writeFileSync('scripts/tests/smart-categories-v38.test.mjs', test);
console.log('Applied smart categories v38');
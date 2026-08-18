import fs from 'node:fs';

function edit(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`${path}: patch made no change`);
  fs.writeFileSync(path, after);
}

function replaceOnce(src, oldText, newText, label) {
  const count = src.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 match, got ${count}`);
  return src.replace(oldText, newText);
}

edit('scripts/classification.mjs', (input) => {
  let src = input;
  src = replaceOnce(src,
`  'kids show', "children's program", 'childrens program', 'preschool show',
  'هشتگ خاله سوسکه', 'خاله سوسکه', 'عمو پورنگ', 'کلاه قرمزی', 'فیتیله',
];`,
`  'kids show', "children's program", 'childrens program', 'preschool show',
  'هشتگ خاله سوسکه', 'خاله سوسکه', 'عمو پورنگ', 'کلاه قرمزی', 'فیتیله',
  // Verified operator-only child programs that frequently arrive without a synopsis.
  // Exact title identity keeps ordinary narrative films out of Kids.
  'فیل کوچولوی کم طاقت', 'فیل کوچولوی کم‌طاقت', 'نجات فیلی از گودال',
  'راه جنگل', 'دروغ کوچک', 'فینبار و کرم شبتاب', 'فینیارو و کرم شبتاب',
  'سالی و آواز درخت', 'لبخند کروکودیل', 'موزیکال دوستی و مهربونی',
  'موزیکال دوستی و مهربانی',
];`, 'kids verified titles');

  src = replaceOnce(src,
`const talkShowTerms = ['تاک شو', 'تاک‌شو', 'talk show'];`,
`const generalProgramTerms = [
  'ویژه برنامه', 'ویژه‌برنامه', 'برنامه نوروزی', 'برنامه نوروز',
  'nowruz special', 'new year special',
];
const talkShowTerms = ['تاک شو', 'تاک‌شو', 'talk show'];`, 'general program terms');

  src = replaceOnce(src,
`  const knownDocumentary = includesAny(titleText, ['از بی', 'از به', 'az be']);`,
`  const knownDocumentary = includesAny(titleText, [
    'از بی', 'از به', 'az be',
    'من ناصر حجازی هستم', 'i am nasser hejazi',
  ]);`, 'known documentary');

  src = replaceOnce(src,
`  'wildlife', 'wild animals', 'animal kingdom', 'natural history', 'nature documentary',
  'marine life', 'ocean life', 'underwater wildlife', 'planet earth', 'our planet',`,
`  'wildlife', 'wild animals', 'animal kingdom', 'natural history', 'nature documentary',
  'marine life', 'ocean life', 'underwater wildlife', 'planet earth', 'our planet',
  'deep sea 3d', 'دریای عمیق',`, 'deep sea wildlife');

  src = replaceOnce(src,
`  const isProgram = isChildrenProgram || isTalkShow || isRealityCompetition ||
    (trustedSpecializedKind && existingKind === 'program');`,
`  const isGeneralProgram = includesAny(programIdentityText, generalProgramTerms);
  const isProgram = isChildrenProgram || isTalkShow || isRealityCompetition || isGeneralProgram ||
    (trustedSpecializedKind && existingKind === 'program');`, 'general program identity');

  src = replaceOnce(src,
`  else if (isRealityCompetition) contentKind = 'reality-competition';
  else if (isTalkShow) contentKind = 'talk-show';
  else if (isAnime) contentKind = type === 'movie' ? 'anime-movie' : 'anime-series';`,
`  else if (isRealityCompetition) contentKind = 'reality-competition';
  else if (isTalkShow) contentKind = 'talk-show';
  else if (isProgram) contentKind = 'program';
  else if (isAnime) contentKind = type === 'movie' ? 'anime-movie' : 'anime-series';`, 'program content kind');
  return src;
});

edit('scripts/sync-upera.mjs', (input) => {
  let src = input;
  src = replaceOnce(src,
`const peopleEnrichmentRetryHours = Math.min(
  168,
  positiveInt(process.env.APARATCHI_PEOPLE_RETRY_HOURS, 12),
);`,
`const peopleEnrichmentRetryHours = Math.min(
  168,
  positiveInt(process.env.APARATCHI_PEOPLE_RETRY_HOURS, 12),
);

const operatorOverviewTitlesPerRun = Math.min(
  30,
  nonNegativeInt(process.env.APARATCHI_OPERATOR_OVERVIEWS_PER_RUN, 12),
);`, 'operator overview quota');

  src = replaceOnce(src,
`async function enrichPeopleFromTmdb(item) {`,
`async function enrichMissingOperatorOverviews() {
  if (!tmdbBearerToken || operatorOverviewTitlesPerRun <= 0) return;
  const now = Date.now();
  const retryMs = 7 * 24 * 60 * 60 * 1000;
  const candidates = (Array.isArray(catalog.items) ? catalog.items : [])
    .filter((item) => item && (item.operatorOnly === true || item.access === 'operator'))
    .filter((item) => !/[\\u0600-\\u06ff]/.test(cleanText(item.overview)))
    .filter((item) => {
      const checked = Date.parse(cleanText(item.operatorOverviewCheckedAt));
      return !Number.isFinite(checked) || now - checked >= retryMs;
    })
    .sort((a, b) => peopleCandidateTimestamp(b) - peopleCandidateTimestamp(a))
    .slice(0, operatorOverviewTitlesPerRun);

  for (const item of candidates) {
    if (runTimeBudgetReached('operator-overview-enrichment', 35000)) break;
    item.operatorOverviewCheckedAt = new Date().toISOString();
    try {
      const title = await resolveTmdbTitle(item);
      if (!title) continue;
      const details = await fetchTmdbJson(\`${'${title.mediaType}'}/${'${title.id}'}\`, { language: 'fa-IR' });
      const overview = cleanText(details?.overview);
      if (overview && /[\\u0600-\\u06ff]/.test(overview)) {
        item.overview = overview;
        item.operatorOverviewSource = 'tmdb-fa';
      }
    } catch (error) {
      rememberError(\`operator-overview-${'${String(item.id || \'unknown\')}'}\`, error);
    }
  }
}

async function enrichPeopleFromTmdb(item) {`, 'operator overview enrichment');

  src = replaceOnce(src,
`  await syncPeopleMetadata();
  if (!runTimeBudgetReached('before-episode-artwork-metadata', 60000)) {`,
`  await syncPeopleMetadata();
  if (!runTimeBudgetReached('before-operator-overviews', 45000)) {
    await enrichMissingOperatorOverviews();
  }
  if (!runTimeBudgetReached('before-episode-artwork-metadata', 60000)) {`, 'call overview enrichment');
  return src;
});

edit('.github/workflows/sync-upera.yml', (input) => replaceOnce(input,
`          APARATCHI_PEOPLE_RETRY_HOURS: '12'
          APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '48'`,
`          APARATCHI_PEOPLE_RETRY_HOURS: '12'
          APARATCHI_OPERATOR_OVERVIEWS_PER_RUN: '12'
          APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '48'`, 'sync overview env'));

console.log('final category batch v31 source guards applied');

import fs from 'node:fs/promises';

const read = (p) => fs.readFile(p, 'utf8');
const write = (p, s) => fs.writeFile(p, s, 'utf8');

function mustReplace(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`Missing follow-up target: ${label}`);
  return text.replace(before, after);
}

function replaceBetween(text, start, end, replacement, label) {
  const a = text.indexOf(start);
  if (a < 0) throw new Error(`Missing follow-up start: ${label}`);
  const b = text.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`Missing follow-up end: ${label}`);
  return text.slice(0, a) + replacement + text.slice(b);
}

let client = await read('scripts/client-catalog.mjs');
client = mustReplace(
  client,
  "  // Keep incomplete server records for backfill, but never expose a phantom\n  // or partially-built archive to the app. `visibilityLocked` was a legacy\n  // compatibility escape hatch and is intentionally NOT a publication signal.\n  if (!seriesHasUsableClientMedia(item)) return false;\n  return item.publicationStatus === 'published' || item.archiveComplete === true;",
  "  // Iranian narrative archives are intentionally hidden while their clean\n  // sequential rebuild is incomplete. Keep the legacy visibility lock only for\n  // other series so a foreign title does not disappear during a background audit.\n  if (!seriesHasUsableClientMedia(item)) return false;\n  const keys = Array.isArray(item.categoryKeys) ? item.categoryKeys : [];\n  const strictIranianArchive = Boolean(\n    !item.isDocumentary &&\n    item.contentKind !== 'documentary' &&\n    (keys.includes('iranian-series') || (item.ir === true && !keys.includes('foreign-series')))\n  );\n  return item.publicationStatus === 'published' ||\n    item.archiveComplete === true ||\n    (!strictIranianArchive && item.visibilityLocked === true);",
  'client visibility only strict for Iranian narrative series',
);
await write('scripts/client-catalog.mjs', client);

let sync = await read('scripts/sync-upera.mjs');

sync = mustReplace(
  sync,
  "  iranianSeriesNoProgress: {},\n  operatorSeriesPage: 1,",
  "  iranianSeriesNoProgress: {},\n  iranianSeriesActiveId: '',\n  operatorSeriesPage: 1,",
  'Iranian active-id default',
);
sync = mustReplace(
  sync,
  "state.iranianSeriesOffset = nonNegativeInt(state.iranianSeriesOffset, 0);\nif (!state.iranianSeriesNoProgress || typeof state.iranianSeriesNoProgress !== 'object' || Array.isArray(state.iranianSeriesNoProgress)) state.iranianSeriesNoProgress = {};",
  "state.iranianSeriesOffset = nonNegativeInt(state.iranianSeriesOffset, 0);\nstate.iranianSeriesActiveId = cleanText(state.iranianSeriesActiveId || '');\nif (!state.iranianSeriesNoProgress || typeof state.iranianSeriesNoProgress !== 'object' || Array.isArray(state.iranianSeriesNoProgress)) state.iranianSeriesNoProgress = {};",
  'Iranian active-id state normalization',
);

sync = mustReplace(
  sync,
  "  state.iranianSeriesNoProgress = {};\n  state.iranianSeriesRebuildVersion = IRANIAN_SERIES_REBUILD_VERSION;\n  // Do not let old compatibility migrations republish the shells we just hid.\n  state.legacySeriesVisibilityMigrationCompleted = true;\n  state.historicalVisibleSeriesRecoveryCompleted = true;\n  console.log(`بازسازی تمیز سریال ایرانی: ${resetCount} عنوان برای تکمیل ترتیبی ریست شد.`);",
  "  state.iranianSeriesNoProgress = {};\n  state.iranianSeriesActiveId = '';\n  state.iranianSeriesRebuildVersion = IRANIAN_SERIES_REBUILD_VERSION;\n  // Only suppress old visibility migrations when an Iranian shell was actually\n  // reset. Regression/foreign-only catalogs must retain their old compatibility\n  // behavior.\n  if (resetCount > 0) {\n    state.legacySeriesVisibilityMigrationCompleted = true;\n    state.historicalVisibleSeriesRecoveryCompleted = true;\n  }\n  console.log(`بازسازی تمیز سریال ایرانی: ${resetCount} عنوان برای تکمیل ترتیبی ریست شد.`);",
  'conditional legacy visibility suppression',
);

// Remove the one historical manual Ganj-e Mozafar operator test sibling. If the
// panel really reports it as traffic_oo=1 later, normal panel discovery may add
// a fresh verified sibling again.
const itemMarker = "let items = Array.isArray(catalog.items)\n  ? catalog.items.filter(Boolean)\n  : [];\n";
if (!sync.includes(itemMarker)) throw new Error('Missing item marker for cleanup');
sync = sync.replace(itemMarker, itemMarker + `
items = items.filter((item) => !(
  item?.type === 'series' &&
  catalogVariant(item) === 'operator' &&
  baseCatalogId(item) === '0211f520-f2b9-11eb-8904-6179943b9168'
));

function reconcileStoredLanguageFiles(files) {
  const source = (Array.isArray(files) ? files : []).map((file) => {
    if (file?.language === 'dubbed' || file?.language === 'subtitled') return { ...file };
    const tag = mediaLanguageTag(\`\${file?.label || ''} \${file?.quality || ''}\`);
    return tag ? { ...file, language: tag } : { ...file };
  });
  const explicit = new Set(source.map((file) => file.language).filter((value) => value === 'dubbed' || value === 'subtitled'));
  const unknown = source.filter((file) => !file.language);
  if (!unknown.length) return source;
  if (explicit.has('dubbed') && explicit.has('subtitled')) return source.filter((file) => Boolean(file.language));
  if (explicit.size === 1) {
    const counterpart = explicit.has('dubbed') ? 'subtitled' : 'dubbed';
    return source.map((file) => file.language ? file : { ...file, language: counterpart });
  }
  return source;
}

function reconcileStoredLanguageSections(item) {
  if (!item || !Array.isArray(item.downloads)) return item;
  if (item.type === 'series') {
    return {
      ...item,
      downloads: item.downloads.map((group) => ({
        ...group,
        files: reconcileStoredLanguageFiles(group?.files),
      })),
    };
  }

  const prepared = item.downloads.map((section) => {
    const sectionTag = mediaLanguageTag(\`\${section?.title || ''} \${section?.badge || ''}\`);
    const files = (Array.isArray(section?.files) ? section.files : []).map((file) =>
      file?.language || !sectionTag ? { ...file } : { ...file, language: sectionTag },
    );
    return { ...section, files };
  });
  const explicit = new Set(prepared.flatMap((section) => section.files || [])
    .map((file) => file.language)
    .filter((value) => value === 'dubbed' || value === 'subtitled'));

  return {
    ...item,
    downloads: prepared.flatMap((section) => {
      const sectionTag = mediaLanguageTag(\`\${section?.title || ''} \${section?.badge || ''}\`);
      if (sectionTag) return [{ ...section, files: reconcileStoredLanguageFiles(section.files) }];
      if (explicit.has('dubbed') && explicit.has('subtitled')) return [];
      if (explicit.size === 1) {
        const counterpart = explicit.has('dubbed') ? 'subtitled' : 'dubbed';
        return [{
          ...section,
          title: mediaLanguageLabel(counterpart),
          badge: counterpart === 'dubbed' ? 'دوبله' : 'زیرنویس',
          files: (section.files || []).map((file) => ({ ...file, language: counterpart })),
        }];
      }
      return [{
        ...section,
        title: 'لینک‌های دریافت',
        badge: 'دریافت',
        files: section.files || [],
      }];
    }),
  };
}

items = items.map(reconcileStoredLanguageSections);
`);

// A full language audit should add/repair current source media without deleting
// a known-good download simply because one transient Upera response contains
// only a player link. The reconciliation above removes the legacy fake-original
// grouping independently.
sync = mustReplace(
  sync,
  "  const mergedMedia = options.replaceMedia === true || options.fullMediaAudit === true\n    ? media\n    : mergeMovieMedia(existing, media);",
  "  const mergedMedia = options.replaceMedia === true\n    ? media\n    : mergeMovieMedia(existing, media);",
  'preserve known-good movie downloads during language audit',
);

// Do not promote arbitrary extensionless acquisition/redirect URLs to media.
// Missing movie downloads are repaired from actual direct files returned by the
// source, not by guessing from a quality word in a portal URL.
sync = mustReplace(
  sync,
  "function isLikelyDownloadableAffiliateLink(link) {\n  if (isDownloadableMediaUrl(link?.link)) return true;\n  if (!isHttp(link?.link) || operatorPortalDetails(link?.link)) return false;\n  const text = mediaLinkDescriptor(link);\n  return /(?:360|480|720|1080|1440|2160|hq|quality|download|دانلود|کیفیت)/i.test(text);\n}",
  "function isLikelyDownloadableAffiliateLink(link) {\n  return isDownloadableMediaUrl(link?.link);\n}",
  'reject extensionless acquisition portals',
);

// Lock an Iranian series by source id as well as page/offset so small upstream
// ordering changes cannot switch to a different title between hourly runs.
sync = mustReplace(
  sync,
  "    let offset = nonNegativeInt(state.iranianSeriesOffset, 0);\n    if (offset >= candidates.length) offset = 0;\n    const candidate = candidates[offset];\n    const sourceId = String(baseCatalogId(candidate) || candidate?.t_id || candidate?.series_id || '');\n    const progressKey = sourceId || `p${page}-o${offset}`;",
  "    let offset = nonNegativeInt(state.iranianSeriesOffset, 0);\n    if (offset >= candidates.length) offset = 0;\n    const lockedId = cleanText(state.iranianSeriesActiveId || '');\n    if (lockedId) {\n      const lockedIndex = candidates.findIndex((entry) =>\n        String(baseCatalogId(entry) || entry?.t_id || entry?.series_id || '') === lockedId,\n      );\n      if (lockedIndex >= 0) offset = lockedIndex;\n    }\n    const candidate = candidates[offset];\n    const sourceId = String(baseCatalogId(candidate) || candidate?.t_id || candidate?.series_id || '');\n    if (!lockedId && sourceId) state.iranianSeriesActiveId = sourceId;\n    const progressKey = sourceId || `p${page}-o${offset}`;",
  'Iranian source id lock',
);
for (const marker of ['iranian-skip-', 'iranian-complete-', 'iranian-deferred-']) {
  const target = marker === 'iranian-skip-'
    ? "      delete state.iranianSeriesNoProgress[progressKey];\n      offset += 1;"
    : marker === 'iranian-complete-'
      ? "      delete state.iranianSeriesNoProgress[progressKey];\n      offset += 1;"
      : "      // Hidden broken title is retried later by repair/backfill lanes; advance\n      // this dedicated discovery queue so the next Iranian title can start.\n      offset += 1;";
  const replacement = marker === 'iranian-deferred-'
    ? "      // Hidden broken title is retried later by repair/backfill lanes; advance\n      // this dedicated discovery queue so the next Iranian title can start.\n      state.iranianSeriesActiveId = '';\n      offset += 1;"
    : "      delete state.iranianSeriesNoProgress[progressKey];\n      state.iranianSeriesActiveId = '';\n      offset += 1;";
  if (sync.includes(target)) sync = sync.replace(target, replacement);
}

await write('scripts/sync-upera.mjs', sync);

// Update tests whose former assertions explicitly depended on the intentionally
// removed manual Ganj-e Mozafar override or on the old media-audit version.
let regression = await read('scripts/tests/sync-upera-regression.test.mjs');
regression = replaceBetween(
  regression,
  "test('verified Ganje Mozafar episode 12 stream creates a separate operator series post'",
  "\ntest('operator movie discovery still runs while an archive backfill is active'",
  `test('manual Ganje Mozafar operator fixture is no longer injected', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-no-manual-operator-'));
  const fixture = initialCatalog();
  const series = fixture.items[0];
  series.id = '0211f520-f2b9-11eb-8904-6179943b9168';
  series.slug = \`series-\${series.id}\`;
  series.name = 'Ganje Mozafar';
  series.nameFa = 'گنج مظفر';
  series.archiveComplete = true;
  series.publicationStatus = 'published';
  await writeJson(path.join(fixtureDirectory, 'catalog.json'), fixture);
  await writeJson(path.join(fixtureDirectory, 'sync-state.json'), { legacySeriesVisibilityMigrationCompleted: true });
  try {
    const result = await runSync(fixtureDirectory, { mode: 'PEOPLE' });
    assert.ok(result.catalog.items.find((entry) => entry.id === series.id));
    assert.equal(result.catalog.items.some((entry) => entry.id === \`\${series.id}--operator\`), false);
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});
`,
  'replace manual Ganj fixture test',
);
regression = regression.replace(
  "assert.equal(item.mediaLanguageAuditVersion, 5);",
  "assert.equal(item.mediaLanguageAuditVersion, 6);",
);
await write('scripts/tests/sync-upera-regression.test.mjs', regression);

// Strengthen the new source-level regression file with the preservation and
// active-id guarantees that caused the first dry run to catch regressions.
let userTests = await read('scripts/tests/user-bugfix-batch.test.mjs');
userTests += `

test('language audit preserves existing direct media and never guesses extensionless portals', () => {
  const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('const mergedMedia = options.replaceMedia === true'));
  assert.ok(source.includes('return isDownloadableMediaUrl(link?.link);'));
  assert.ok(source.includes('reconcileStoredLanguageSections'));
});

test('Iranian sequential cursor has a persistent active source id', () => {
  const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('iranianSeriesActiveId'));
  assert.ok(source.includes('const lockedId = cleanText(state.iranianSeriesActiveId'));
});
`;
await write('scripts/tests/user-bugfix-batch.test.mjs', userTests);

console.log('Applied Aparatchi bugfix follow-up hardening.');

import fs from 'node:fs/promises';
import path from 'node:path';

const syncPath = 'scripts/sync-upera.mjs';
let source = await fs.readFile(syncPath, 'utf8');

function mustReplace(before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing patch target: ${label}`);
  source = source.replace(before, after);
}

mustReplace(
  'const MEDIA_LANGUAGE_AUDIT_VERSION = 6;',
  'const MEDIA_LANGUAGE_AUDIT_VERSION = 7;',
  'media-language audit version',
);
mustReplace(
  "const CATALOG_VERSION = '0.23.0-user-bugfix-batch';",
  "const CATALOG_VERSION = '0.23.1-media-language-truth';",
  'catalog version',
);

// An unlabeled row is ambiguous evidence; it must never be turned into the
// opposite language simply because one real language was detected elsewhere.
mustReplace(
`  if (explicit.size === 1) {
    const counterpart = explicit.has('dubbed') ? 'subtitled' : 'dubbed';
    return source.map((file) => file.language ? file : { ...file, language: counterpart });
  }
  return source;
}`,
`  if (explicit.size === 1) {
    return source.filter((file) =>
      file.language === 'dubbed' ||
      file.language === 'subtitled' ||
      isValidStoredOperatorFile(file) ||
      isValidStoredPublicPortalFile(file)
    );
  }
  return source;
}`,
  'stored file counterpart fabrication',
);

mustReplace(
`      if (explicit.size === 1) {
        const counterpart = explicit.has('dubbed') ? 'subtitled' : 'dubbed';
        return [{
          ...section,
          title: mediaLanguageLabel(counterpart),
          badge: counterpart === 'dubbed' ? 'دوبله' : 'زیرنویس',
          files: (section.files || []).map((file) => ({ ...file, language: counterpart })),
        }];
      }
      return [{`,
`      if (explicit.size === 1) {
        const verifiedPortalFiles = (Array.isArray(section.files) ? section.files : [])
          .filter((file) => isValidStoredOperatorFile(file) || isValidStoredPublicPortalFile(file));
        if (verifiedPortalFiles.length) {
          return [{
            ...section,
            title: 'پخش آنلاین',
            badge: 'پخش',
            files: verifiedPortalFiles,
          }];
        }
        return [];
      }
      return [{`,
  'stored movie section counterpart fabrication',
);

mustReplace(
`  if (explicit.size === 1) {
    const counterpart = explicit.has('dubbed') ? 'subtitled' : 'dubbed';
    for (const link of unknown) {
      link._media_language_tag = counterpart;
      link._media_language = mediaLanguageLabel(counterpart);
    }
  }
  return list;
}`,
`  if (explicit.size === 1) {
    for (const link of unknown) link._drop_ambiguous_language = true;
  }
  return list;
}`,
  'fresh affiliate counterpart fabrication',
);

// A replacement audit may only discard old media when the fresh provider
// snapshot actually contains usable ordinary media. An empty/transient source
// response must never erase a working legacy download or player URL.
mustReplace(
`  const mergedMedia = options.replaceMedia === true
    ? media
    : mergeMovieMedia(existing, media);`,
`  const freshHasUsableOrdinaryMedia = Boolean(
    media?.streamUrl ||
    (Array.isArray(media?.downloads) && media.downloads.some((section) =>
      (Array.isArray(section?.files) ? section.files : []).some((file) =>
        file?.mode === 'download' || file?.mode === 'play' || !file?.mode,
      ),
    ))
  );
  const mergedMedia = options.replaceMedia === true && freshHasUsableOrdinaryMedia
    ? media
    : mergeMovieMedia(existing, media);`,
  'safe movie replacement guard',
);

// The NORMAL repair lane is where old movie language metadata is refreshed.
// Request replacement there, but the guard above preserves old working media
// if Upera returns no usable ordinary files on that attempt.
mustReplace(
  "result = await processMovie(item, 'media-repair', { fullMediaAudit: true });",
  "result = await processMovie(item, 'media-repair', { fullMediaAudit: true, replaceMedia: true });",
  'movie repair language replacement',
);

// Keep strict oldest-year ordering during BACKFILL. When that active movie is
// being audited and already has usable media, a successful fresh snapshot may
// replace its stale language rows; a failed/empty snapshot is still protected
// by freshHasUsableOrdinaryMedia above.
mustReplace(
`      result = await processMovie(item, 'year-backfill', {
        fullMediaAudit: true,
        replaceMedia: false,
      });`,
`      result = await processMovie(item, 'year-backfill', {
        fullMediaAudit: true,
        replaceMedia: hadUsableMedia,
      });`,
  'year-backfill language replacement',
);

// A series language audit must replace the old ordinary episode rows rather
// than merge a formerly fabricated language back into the fresh snapshot.
// Authenticated public/operator portal access is independent and is preserved.
mustReplace(
`      const nextGroup = episodeGroup(episode, media, series);
      upsertEpisodeGroup(mergedGroups, nextGroup);`,
`      const nextGroup = episodeGroup(episode, media, series);
      if (options.refreshAllMedia === true && previousGroup) {
        const preservedVerifiedPortalFiles = (Array.isArray(previousGroup.files) ? previousGroup.files : [])
          .filter((file) => isValidStoredOperatorFile(file) || isValidStoredPublicPortalFile(file));
        nextGroup.files = dedupeMediaFiles([
          ...(Array.isArray(nextGroup.files) ? nextGroup.files : []),
          ...preservedVerifiedPortalFiles,
        ]);
        const previousIndex = mergedGroups.indexOf(previousGroup);
        if (previousIndex >= 0) mergedGroups.splice(previousIndex, 1);
      }
      upsertEpisodeGroup(mergedGroups, nextGroup);`,
  'series language-audit replacement',
);

if (source.includes("const counterpart = explicit.has('dubbed') ? 'subtitled' : 'dubbed';")) {
  throw new Error('A counter-language fabrication path still exists in sync-upera.mjs');
}
if (!source.includes('const MEDIA_LANGUAGE_AUDIT_VERSION = 7;')) {
  throw new Error('Media language audit version did not advance to 7');
}
if (!source.includes('freshHasUsableOrdinaryMedia')) {
  throw new Error('Movie replacement is not protected from empty provider snapshots');
}
if (!source.includes("replaceMedia: hadUsableMedia")) {
  throw new Error('Backfill movie language audit is not replacing stale media safely');
}
if (!source.includes('preservedVerifiedPortalFiles')) {
  throw new Error('Series language audit is not replacing stale ordinary media');
}

await fs.writeFile(syncPath, source, 'utf8');

const testsDir = 'scripts/tests';
for (const name of await fs.readdir(testsDir)) {
  if (!name.endsWith('.test.mjs')) continue;
  const filePath = path.join(testsDir, name);
  let testSource = await fs.readFile(filePath, 'utf8');
  testSource = testSource.replaceAll('MEDIA_LANGUAGE_AUDIT_VERSION = 6', 'MEDIA_LANGUAGE_AUDIT_VERSION = 7');
  testSource = testSource.replaceAll('oldMovie?.mediaLanguageAuditVersion, 6', 'oldMovie?.mediaLanguageAuditVersion, 7');
  await fs.writeFile(filePath, testSource, 'utf8');
}

const regression = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');

test('an unlabeled Upera row never manufactures the opposite media language', () => {
  assert.ok(!source.includes("const counterpart = explicit.has('dubbed') ? 'subtitled' : 'dubbed';"));
  assert.ok(source.includes('for (const link of unknown) link._drop_ambiguous_language = true;'));
  assert.ok(source.includes("file.language === 'dubbed' ||"));
});

test('language audits replace stale rows only from a usable fresh snapshot', () => {
  assert.ok(source.includes('MEDIA_LANGUAGE_AUDIT_VERSION = 7'));
  assert.ok(source.includes('freshHasUsableOrdinaryMedia'));
  assert.ok(source.includes("fullMediaAudit: true, replaceMedia: true"));
  assert.ok(source.includes('replaceMedia: hadUsableMedia'));
  assert.ok(source.includes('preservedVerifiedPortalFiles'));
  assert.ok(!source.includes("'backfill-language-repair'"));
});
`;
await fs.writeFile(path.join(testsDir, 'media-language-truth.test.mjs'), regression, 'utf8');

console.log('Applied non-destructive Upera media-language truth hotfix (audit v7).');

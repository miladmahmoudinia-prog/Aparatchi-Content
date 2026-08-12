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

// Never infer a missing Upera language from the presence of the other one.
// An unlabeled row is ambiguous evidence, not proof of a dubbed/subtitled twin.
mustReplace(
`  if (explicit.size === 1) {
    const counterpart = explicit.has('dubbed') ? 'subtitled' : 'dubbed';
    return source.map((file) => file.language ? file : { ...file, language: counterpart });
  }
  return source;
}`,
`  if (explicit.size === 1) {
    // Keep only positively identified language rows. Older code manufactured
    // the opposite language here, which could expose a fake Dubbed button that
    // played the exact same subtitled stream.
    return source.filter((file) => file.language === 'dubbed' || file.language === 'subtitled');
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
        // A neutral legacy section cannot become the missing language merely
        // because another section has a known language. Drop the ambiguous
        // stale section and let the versioned source audit rebuild truthfully.
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
    // One explicit language plus an unlabeled row is NOT evidence for the
    // opposite language. Keep ambiguous rows out of language-labelled media.
    for (const link of unknown) link._drop_ambiguous_language = true;
  }
  return list;
}`,
  'fresh affiliate counterpart fabrication',
);

// A full language audit is a complete provider snapshot. It must replace stale
// ordinary media instead of merging old fabricated language rows back in.
mustReplace(
`  const mergedMedia = options.replaceMedia === true
    ? media
    : mergeMovieMedia(existing, media);`,
`  const mergedMedia = options.replaceMedia === true || options.fullMediaAudit === true
    ? media
    : mergeMovieMedia(existing, media);`,
  'movie full-audit replacement',
);

// During a series language audit, replace this episode's old ordinary direct
// files. Preserve only panel-verified public/operator portal access, because it
// is an independent authenticated access channel rather than a language guess.
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

// Even while the archive backfill is active, spend a tiny bounded slice on old
// movie language audits. This prevents a long series backlog from leaving fake
// dubbed/subtitled movie variants in production for weeks.
mustReplace(
`  stats.normalSyncSkippedForBackfill = true;
  await syncSequentialArchiveBackfill();`,
`  stats.normalSyncSkippedForBackfill = true;
  if (!affiliateBudgetExhausted && !runTimeBudgetReached('before-backfill-language-repair', 90000)) {
    await withAffiliateRequestScope(
      'backfill-language-repair',
      Math.min(4, mediaRepairRequestQuota),
      syncIncompleteMovieMedia,
    );
  }
  if (!affiliateBudgetExhausted) await syncSequentialArchiveBackfill();`,
  'bounded movie audit during backfill',
);

if (source.includes("const counterpart = explicit.has('dubbed') ? 'subtitled' : 'dubbed';")) {
  throw new Error('A counter-language fabrication path still exists in sync-upera.mjs');
}
if (!source.includes('const MEDIA_LANGUAGE_AUDIT_VERSION = 7;')) {
  throw new Error('Media language audit version did not advance to 7');
}
if (!source.includes("options.replaceMedia === true || options.fullMediaAudit === true")) {
  throw new Error('Movie full language audits are not replacing stale media');
}
if (!source.includes('preservedVerifiedPortalFiles')) {
  throw new Error('Series full language audits are not replacing stale ordinary media');
}

await fs.writeFile(syncPath, source, 'utf8');

// Align existing source-level assertions with the new versioned audit.
const testsDir = 'scripts/tests';
for (const name of await fs.readdir(testsDir)) {
  if (!name.endsWith('.test.mjs')) continue;
  const filePath = path.join(testsDir, name);
  let testSource = await fs.readFile(filePath, 'utf8');
  testSource = testSource.replaceAll('MEDIA_LANGUAGE_AUDIT_VERSION = 6', 'MEDIA_LANGUAGE_AUDIT_VERSION = 7');
  await fs.writeFile(filePath, testSource, 'utf8');
}

const regression = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');

test('an unlabeled Upera row never manufactures the opposite media language', () => {
  assert.ok(!source.includes("const counterpart = explicit.has('dubbed') ? 'subtitled' : 'dubbed';"));
  assert.ok(source.includes('for (const link of unknown) link._drop_ambiguous_language = true;'));
  assert.ok(source.includes("return source.filter((file) => file.language === 'dubbed' || file.language === 'subtitled');"));
});

test('versioned media audits replace stale direct movie and series language rows', () => {
  assert.ok(source.includes('MEDIA_LANGUAGE_AUDIT_VERSION = 7'));
  assert.ok(source.includes('options.replaceMedia === true || options.fullMediaAudit === true'));
  assert.ok(source.includes('preservedVerifiedPortalFiles'));
  assert.ok(source.includes("Math.min(4, mediaRepairRequestQuota)"));
});
`;
await fs.writeFile(path.join(testsDir, 'media-language-truth.test.mjs'), regression, 'utf8');

console.log('Applied strict Upera media-language truth hotfix (audit v7).');

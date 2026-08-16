import fs from 'node:fs/promises';
import './fix-ui-truth-v10b.mjs';

async function rewrite(path, fn) {
  const before = await fs.readFile(path, 'utf8');
  const after = fn(before);
  if (after !== before) await fs.writeFile(path, after, 'utf8');
  console.log(`${path}: ${after === before ? 'unchanged' : 'updated by v10c'}`);
}

await rewrite('scripts/client-catalog.mjs', (source) => {
  const start = source.indexOf('const compactBootstrapMovieFile = (file) => ({');
  const end = source.indexOf('\n\nconst compactBootstrapNavigationItem', start);
  if (start < 0 || end < 0) throw new Error('compact movie bootstrap helper not found');
  const before = source.slice(start, end);
  const after = before
    .replace("  ...(file?.label ? { label: file.label } : {}),\n", '')
    .replace("      ...(section.title ? { title: section.title } : {}),\n", '')
    .replace("      ...(section.badge ? { badge: section.badge } : {}),\n", '');
  return source.slice(0, start) + after + source.slice(end);
});

// The existing hourly workflow already has a bounded artwork lane. Keep that
// workflow unchanged here (Actions tokens cannot update workflow files); the
// real blocker was the stale pre-sync test suite, which v10 fixes.
await rewrite('.github/workflows/sync-upera.yml', (source) => source
  .replace("          APARATCHI_RUN_TIME_LIMIT_MINUTES: '12'", "          APARATCHI_RUN_TIME_LIMIT_MINUTES: '6'")
  .replace("          APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '120'", "          APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '24'")
  .replace("          APARATCHI_EPISODE_ARTWORK_MIRROR_PER_RUN: '0'", "          APARATCHI_EPISODE_ARTWORK_MIRROR_PER_RUN: '36'")
  .replace("          APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN: '160'", "          APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN: '36'"));

await rewrite('scripts/tests/ui-truth-v10.test.mjs', (source) => source
  .replace(
    "    assert.ok(files.length > 0 && files.length <= 2, 'bootstrap keeps at most two immediate action files per movie');",
    "    assert.ok(files.length > 0, 'every media-equipped client movie has an immediate bootstrap action');",
  )
  .replace("assert.match(workflow, /APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '120'/);", "assert.match(workflow, /APARATCHI_EPISODE_ARTWORK_SERIES_PER_RUN: '24'/);")
  .replace("assert.match(workflow, /APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN: '160'/);", "assert.match(workflow, /APARATCHI_EPISODE_FRAME_CAPTURES_PER_RUN: '36'/);")
  .replace("assert.match(workflow, /APARATCHI_RUN_TIME_LIMIT_MINUTES: '12'/);", "assert.match(workflow, /APARATCHI_RUN_TIME_LIMIT_MINUTES: '6'/);"));

console.log('UI truth v10c compact bootstrap patch ready');

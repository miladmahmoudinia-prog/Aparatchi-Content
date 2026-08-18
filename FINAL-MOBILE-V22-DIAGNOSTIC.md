# Final public Mobile v22 validation diagnostic

- mobileHead: b51e7843d9d2a978316fc7f17a91df79b298534f
- checkout: success
- setupNode: success
- install: success
- rawTypecheck: success
- regressions: failure
- materialize: success
- patchedTypecheck: success
- audit: success

## mobile-install.log
```text
npm warn deprecated uuid@7.0.3: uuid@10 and below is no longer supported.  For ESM codebases, update to uuid@latest.  For CommonJS codebases, use uuid@11 (but be aware this version will likely be deprecated in 2028).

added 485 packages, and audited 486 packages in 16s

43 packages are looking for funding
  run `npm fund` for details

21 vulnerabilities (7 moderate, 14 high)

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
```

## mobile-raw-typecheck.log
```text

> aparatchi-mobile@0.15.9 typecheck
> tsc --noEmit

```

## mobile-regressions.log
```text
  ...
# Subtest: all RTL people/star rails snap to the right edge
not ok 5 - all RTL people/star rails snap to the right edge
  ---
  duration_ms: 0.834456
  type: 'test'
  location: '/home/runner/work/Aparatchi-Content/Aparatchi-Content/mobile/scripts/tests/final-user-batch-20260814.test.mjs:12:1'
  failureType: 'testCodeFailure'
  error: |-
    The expression evaluated to a falsy value:
    
      assert.ok(source.includes('peopleRailRef.current?.scrollToEnd({ animated: false })'))
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
  stack: |-
    TestContext.<anonymous> (file:///home/runner/work/Aparatchi-Content/Aparatchi-Content/mobile/scripts/tests/final-user-batch-20260814.test.mjs:13:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  ...
# Subtest: episode art never falls back to the series poster
ok 6 - episode art never falls back to the series poster
  ---
  duration_ms: 0.607212
  type: 'test'
  ...
# Subtest: category covers never use unrelated fallback content
ok 7 - category covers never use unrelated fallback content
  ---
  duration_ms: 0.282798
  type: 'test'
  ...
# Subtest: category position restores on return
ok 8 - category position restores on return
  ---
  duration_ms: 0.365872
  type: 'test'
  ...
# Subtest: home virtualization and operator redirect fixes remain enabled
not ok 9 - home virtualization and operator redirect fixes remain enabled
  ---
  duration_ms: 0.714072
  type: 'test'
  location: '/home/runner/work/Aparatchi-Content/Aparatchi-Content/mobile/scripts/tests/final-user-batch-20260814.test.mjs:40:1'
  failureType: 'testCodeFailure'
  error: |-
    The expression evaluated to a falsy value:
    
      assert.ok(source.includes('trustedOperatorNavigationRef.current'))
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
  stack: |-
    TestContext.<anonymous> (file:///home/runner/work/Aparatchi-Content/Aparatchi-Content/mobile/scripts/tests/final-user-batch-20260814.test.mjs:42:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: locked player uses the same controls hide timer
ok 10 - locked player uses the same controls hide timer
  ---
  duration_ms: 1.746306
  type: 'test'
  ...
# Subtest: video taps reveal and hide the unlock affordance while locked
ok 11 - video taps reveal and hide the unlock affordance while locked
  ---
  duration_ms: 0.357777
  type: 'test'
  ...
# Subtest: unlock button renders only while locked controls are visible
ok 12 - unlock button renders only while locked controls are visible
  ---
  duration_ms: 0.280372
  type: 'test'
  ...
# Subtest: unlocking resumes normal control auto-hide
ok 13 - unlocking resumes normal control auto-hide
  ---
  duration_ms: 0.340856
  type: 'test'
  ...
# Subtest: people section is hidden when no real cast or crew exists
ok 14 - people section is hidden when no real cast or crew exists
  ---
  duration_ms: 1.01329
  type: 'test'
  ...
# Subtest: real cast rail remains available and starts from the right edge with deterministic RTL
ok 15 - real cast rail remains available and starts from the right edge with deterministic RTL
  ---
  duration_ms: 0.229047
  type: 'test'
  ...
# Subtest: people list is built only from real actor/director catalog records
ok 16 - people list is built only from real actor/director catalog records
  ---
  duration_ms: 0.199132
  type: 'test'
  ...
# Subtest: catalog artwork keeps a stable image instance across fallback urls
ok 17 - catalog artwork keeps a stable image instance across fallback urls
  ---
  duration_ms: 1.100692
  type: 'test'
  ...
# Subtest: main horizontal catalog keeps Android edge posters mounted without duplicate props
ok 18 - main horizontal catalog keeps Android edge posters mounted without duplicate props
  ---
  duration_ms: 0.258252
  type: 'test'
  ...
# Subtest: home vertical list keeps nested poster rails attached while scrolling
ok 19 - home vertical list keeps nested poster rails attached while scrolling
  ---
  duration_ms: 0.259574
  type: 'test'
  ...
1..19
# tests 19
# suites 0
# pass 16
# fail 3
# cancelled 0
# skipped 0
# todo 0
# duration_ms 166.374168
```

## mobile-materialize.log
```text
materialized Mobile App patch delta=1147
```

## mobile-patched-typecheck.log
```text

> aparatchi-mobile@0.15.9 typecheck
> tsc --noEmit

```

## mobile-audit.log
```text
  const posterNameFa = String(item.nameFa || item.name || '').trim();
let collectionBrowserScrollOffset = 0;
      contentOffset={{ x: 0, y: collectionBrowserScrollOffset }}
      onScroll={rememberCollectionBrowserOffset}
          const relatedBadges = itemPosterBadges(relatedItem);
                  badge.kind === 'operator' && styles.posterOperatorAccess,
                    badge.kind === 'operator' && styles.posterOperatorAccessText,
                        style={[styles.posterAccess, badge.kind === 'operator' && styles.posterOperatorAccess]}
                          style={[styles.posterAccessText, badge.kind === 'operator' && styles.posterOperatorAccessText]}
    ? (item.latestEpisode || newestEpisodeGroup(item))
        removeClippedSubviews
        removeClippedSubviews={false}
        removeClippedSubviews={false}
      removeClippedSubviews={false}
        removeClippedSubviews={false}
          removeClippedSubviews={false}
        removeClippedSubviews={false}
      removeClippedSubviews={false}
import { installStartupContentGate } from './src/startupContentGate';
installStartupContentGate();
  'scripts/metro-app-patch-transformer.cjs',
```

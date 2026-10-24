# Stage 12 — Settings concurrency, backfill termination, manual alias cleanup

Date: 2026-10-24

## Baseline
- Repository: PyRookie1/luna-toc-sc
- Base branch: main
- Base commit: bb36da1424b69fb83054eaec0c6424b7f0af55f2 (Stage 11 merged)
- Working branch: fix/stage-12-settings-backfill-alias-cleanup
- Scope: checklist items 04–06; bug IDs B030, B031, B032
- Release: not authorized or performed. Main is not modified by this branch.

## Change checklist
- [x] 04 / B030: options page submits per-field sidebar patches with editor-time expected values; background validates and compare-and-sets each patched field inside shared queue. Stale same-field edits fail without storage writes; options page refreshes and reports conflicts; a pending write disables rapid repeat edits. Legacy full-record writers may initialize missing settings or confirm an identical value, but cannot overwrite valid existing settings.
- [x] 05 / B031: per-page backfill timeout covers fetch and JSON parsing; abort releases hung tasks; route/history change cancels old jobs; reject stale/cyclic cursors.
- [x] 06 / B032: user-controlled inventory of saved aliases with explicit backup acknowledgment and single-record confirmation. Backend rechecks full preview, fences deletion, and rejects stale selections. No automatic deletion on untrusted page messages.

## Safety, compatibility, limitations
- The new cleanup UI **cannot prove a remote ChatGPT conversation has been deleted**. Only the user can identify unneeded records, and cleanup is never automatic.
- Confirmed cleanup writes an irreversible-without-restore local deletion fence before removing aliases. Restoring a local backup containing that route removes the fence. A failed remove can leave the protective fence installed.
- Existing local storage schema and backup format remain unchanged; no new Chrome extension permissions or external services.
- Older installed options pages using full-record sidebar writes cannot modify existing valid settings; they must be refreshed to use the new conflict-aware patch protocol. The unchanged backup data format remains readable.
- Existing backup restore continues to serialize against writes in the background queue, but remote ChatGPT account state is not queried.

## Automatic evidence
- Added regressions for same-field stale writes (including backup restore), multi-field all-or-nothing rejection, legacy full-state rejection, settings UI conflicts and rapid clicks, invalid changes, hung fetch/JSON, route change, cursor loop, stale alias preview and deletion-fence failures.
- Stage 12 completed-code CI on commit `b755fc235f3d020a434cb27a27242a2cb9070e15`: https://github.com/PyRookie1/luna-toc-sc/actions/runs/40072275696 — **both required jobs passed**. A subsequent documentation-only readiness update requires a fresh latest-head CI check before merge.
- Final code: **84/84 Vitest files, 562/562 tests passed** (including both TSX options-page UI suites); TypeScript checks, extension build, ZIP integrity, license inventory, dependency advisory gate and **10/10 Chromium MV3** simulated-page tests passed. Test discovery explicitly includes `.test.tsx` files.
- Synthetic Chromium benchmarks used mock ChatGPT pages, not live authenticated sessions.
- Earlier initial Stage 12 run failed one legacy repeated-cursor test; corrected the fixture to use distinct cursors for the page-cap case. The latest run above passed.
- Local checkout unavailable in this environment (github.com DNS lookup failed); no claim of local test execution.
- Live authenticated ChatGPT validation: **not performed**.

## Merge gate
1. Requirements and code: checklist 04–06 (B030–B032) implemented and source reviewed.
2. Regression tests: original conflict reproduced by stale-baseline cases; same-field and multi-field write rejection, backfill failure/cancel, alias preview conflict, options UI failure/recovery tests executed and passed.
3. Full test suite and blocking defects: 562/562 Vitest tests passed on final code; no known open P0 or blocking P1 from Stage 12 review. No claim of zero defects.
4. Typecheck, build and package: passed on final code commit (CI linked above); verify current PR head again before merge.
5. Security, data compatibility and rollback: existing storage schema and extension permissions unchanged; user-confirmed alias cleanup is the sole destructive new path, guarded by backend preview comparison and tombstone. Backup restore is required for reversing a confirmed cleanup; reverting extension code alone cannot restore deleted data.
6. Commit, diff and rollback: 18 changed files plus this readiness record, baseline `bb36da1`; no merge conflict in latest reviewed PR. Restore backed-up data for any destructive cleanup already performed. Historic Release and tags must remain intact.

**Stage verdict: 允许合并 after documentation-only latest-head CI succeeds and the PR is marked Ready for Review.** Six technical/acceptance conditions are met on tested code; live authenticated ChatGPT remains **unverified** and is explicitly deferred to the next browser-validation stage, not counted as tested. User authorization is still required for merging; a PR merge does not authorize a release.

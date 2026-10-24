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
- Earlier Stage 12 CI run on code commit `3fb34601d9bb706179d05e52422eb5f0f0be6c85`: https://github.com/PyRookie1/luna-toc-sc/actions/runs/40071014235 — **all jobs passed before the B030 follow-up**. Current-head CI after the follow-up is required; earlier success cannot certify new changes.
- Before B030 follow-up: **82/82 files, 552/552 Vitest tests passed**; typecheck, extension build, ZIP integrity, license audit, high/critical dependency advisory gate and Chromium MV3 E2E **passed**. The follow-up introduces new tests; exact latest counts must be read from final CI.
- Synthetic Chromium benchmarks used mock ChatGPT pages, not live authenticated sessions.
- Earlier initial Stage 12 run failed one legacy repeated-cursor test; corrected the fixture to use distinct cursors for the page-cap case. The latest run above passed.
- Local checkout unavailable in this environment (github.com DNS lookup failed); no claim of local test execution.
- Live authenticated ChatGPT validation: **not performed**.

## Merge gate
1. Requirements and code: implemented on feature branch; review pending.
2. Regression tests: authored; execution pending.
3. Full test suite and no P0/P1: pending latest CI + code review.
4. Typecheck, build and package: pending CI.
5. Security/data compatibility/rollback: review pending; backup restore documented.
6. Commit, diff and rollback: individual commits recorded; revert Stage 12 branch commits if needed, but do not delete local storage or tombstones without restoring a verified backup.

**Status: 待验收 — 不可合并 until final-head CI completes.** The previous source review found a remaining B030 concurrency hole now addressed by the follow-up; latest tests and security/rollback review must confirm. Live authenticated ChatGPT remains unverified.

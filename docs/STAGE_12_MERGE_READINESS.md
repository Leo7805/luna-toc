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
- [x] 04 / B030: options page submits per-field sidebar patches; background validates and merges with current storage inside shared queue. Keep legacy complete-record message compatible.
- [x] 05 / B031: per-page backfill timeout covers fetch and JSON parsing; abort releases hung tasks; route/history change cancels old jobs; reject stale/cyclic cursors.
- [x] 06 / B032: user-controlled inventory of saved aliases with explicit backup acknowledgment and single-record confirmation. Backend rechecks full preview, fences deletion, and rejects stale selections. No automatic deletion on untrusted page messages.

## Safety, compatibility, limitations
- The new cleanup UI **cannot prove a remote ChatGPT conversation has been deleted**. Only the user can identify unneeded records, and cleanup is never automatic.
- Confirmed cleanup writes an irreversible-without-restore local deletion fence before removing aliases. Restoring a local backup containing that route removes the fence. A failed remove can leave the protective fence installed.
- Existing local storage schema and backup format remain unchanged; no new Chrome extension permissions or external services.
- Older installed content scripts can still use the legacy full-record sidebar write while running; refresh open ChatGPT tabs after updating to guarantee field-patch semantics.
- Existing backup restore continues to serialize against writes in the background queue, but remote ChatGPT account state is not queried.

## Automatic evidence
- Added regressions for concurrent sidebar patches, invalid changes, hung fetch/JSON, route change, cursor loop, stale alias preview and deletion-fence failures.
- Typecheck, complete Vitest suite, Chromium extension E2E, build, package audit and dependency advisory: **pending current PR CI**.
- Local checkout unavailable in this environment (github.com DNS lookup failed); no claim of local test execution.
- Live authenticated ChatGPT validation: **not performed**.

## Merge gate
1. Requirements and code: implemented on feature branch; review pending.
2. Regression tests: authored; execution pending.
3. Full test suite and no P0/P1: pending latest CI + code review.
4. Typecheck, build and package: pending CI.
5. Security/data compatibility/rollback: review pending; backup restore documented.
6. Commit, diff and rollback: individual commits recorded; revert Stage 12 branch commits if needed, but do not delete local storage or tombstones without restoring a verified backup.

**Status: 待验收 — 不可合并 (until latest CI and review pass).**

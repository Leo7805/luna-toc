# B033 — TOC heading jump conflicts with edge navigation

- Date: 2026-10-24
- Priority: P2
- Status: Fix committed on `fix/b033-outline-scroll-conflict`; review and current CI status are tracked in [PR #20](https://github.com/PyRookie1/luna-toc-sc/pull/20). Real-site behavior remains unverified.

## Symptom

After navigating to a heading inside an answer, using a top/bottom edge control can allow the earlier heading navigation to move the conversation again, fighting the user's newer scroll target.

## Root cause

`outlineNavigation.ts` guards heading retries and its next-frame position correction with `outlineJumpVersion`. Edge navigation in `promptNavigation.ts` invalidates `navigationJumpVersion`, but those are separate cancellation domains. The controller previously started edge jumps without cancelling the outline navigation.

## Fix

`navigatorController.jumpToEdge()` and `jumpToAbsoluteEdge()` now call `cancelOutlineNavigation()` before starting the edge jump. This invalidates stale heading retries and frame corrections and clears the old heading highlight. Regular TOC prompt clicks already cancel heading navigation through `handlePromptNavigation()`.

## Regression coverage

The controller regression test verifies that both bottom-edge click navigation and absolute top-edge navigation cancel outline positioning before starting the new edge jump. Existing outline tests cover cancellation of delayed heading retries.

## Verification

GitHub Actions run [#40102328225](https://github.com/PyRookie1/luna-toc-sc/actions/runs/40102328225) passed for implementation head `27624440ae4401478889a4b8752f179613da5cf9`:

- TypeScript type-check passed.
- Vitest: 85 test files, 561 tests passed.
- Chrome extension build, built-file verification, ZIP creation, privilege-boundary/license audit passed.
- Headless Chromium MV3 fixture: 10 TAP tests including the parent test; the fixture is synthetic and does not use a live ChatGPT account.
- Dependency advisory gate passed.

CI runs [#40102328225](https://github.com/PyRookie1/luna-toc-sc/actions/runs/40102328225) and [#40102585182](https://github.com/PyRookie1/luna-toc-sc/actions/runs/40102585182) both passed for their respective heads. Check PR #20 for the latest head and required checks; future commits require fresh CI. Real authenticated ChatGPT interaction remains unverified.

## Rollback

Revert the fix commit/PR. The change does not alter persisted user data, storage formats, extension permissions, dependencies, or network requests.

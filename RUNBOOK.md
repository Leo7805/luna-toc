# LunaTOC-SC Runbook

## Environment

- Product: Chrome Manifest V3 extension for ChatGPT.
- Runtime sites: `https://chatgpt.com` and `https://chat.openai.com`.
- Node.js: 22 for project scripts and CI.
- Package manager: npm with committed `package-lock.json`.
- Current release workflow: manually dispatched pre-release from `main`; CI itself does not publish.

## Reproduce CI locally

From the repository root:

1. Install the Node.js 22 LTS line and npm.
2. Run `npm ci`.
3. Run `npm run typecheck`.
4. Run `npm test`.
5. Run `npm run build`.
6. Run `npm run test:security`.
7. Run `npm audit --audit-level=high`.
8. Run `npm run test:browser:setup` then `npm run test:browser`.

The browser test installs a pinned Playwright runner in a temporary directory and loads `dist/` into a disposable Chromium profile. Its ChatGPT requests are fixtures; it does not test a real account.

## Stage 11 account/clear safeguards

- The content script checks `/api/auth/session` in the isolated world. Unknown identity means account-scoped aliases are hidden; do not use page `postMessage` to restore access.
- Historical `ownerId=null` aliases are still available in JSON backups but are deliberately not displayed or adopted without verified ownership. Preserve backups before changing code or browser profiles.
- Clear-all now modifies prompt records and usage together in one background queue job, verifies both values and attempts compensation on failure. A persistent storage failure can also defeat rollback: retain a separate backup.
- Regression checks include forged page messages, account switching, reserved alias IDs, partial storage writes and stale prompt usage updates. Simulated Chromium is not real authenticated ChatGPT testing.

## User-data backup and restore

- Open the extension popup → **设置** → **本地数据备份与恢复**.
- Export a JSON backup and store it outside the browser profile. It can contain private prompts and account/conversation identifiers.
- Restore by selecting a JSON file, reviewing the preview, selecting merge or replace, then confirming.
- The current extension serializes owned-data writes and preflights estimated storage capacity. It cannot make Chrome storage a cross-context transaction; older content scripts or other direct writers may bypass the queue.
- If restore reports quota failure, no restore writes were started. Keep the JSON file, remove unnecessary local data or reduce the backup, then retry.
- If restore reports rollback failure, stop further restore attempts and retain the backup. Do not delete the only copy of user data.

## Page-originated deletion notices (B026)

The MAIN-world page event `TOC_CONVERSATION_DELETED` is **not an authorized local-storage deletion**. It is ignored by the ISOLATED-world lifecycle listener to prevent forged same-origin events from erasing aliases. Actual ChatGPT deletion does not automatically remove stored aliases; they may remain in JSON backups. Use an explicit trusted cleanup design for any future removal. Regression coverage: `test/navigation/lifecycle/conversationLifecycle.test.ts` and the B026 Chromium browser subtest.

## Pull request and merge

- Each stage starts from the latest verified `main` commit on its own short-lived branch.
- CI passing is necessary but not sufficient; review scope, tests, security, compatibility and rollback.
- The assistant must not merge a PR into `main` or publish a release without separate explicit authorization.
- After merge, verify that the latest `main` commit has a completed successful CI run.

## Repository branch protection

As of 2026-10-24, `main` is **protected** under Active [Ruleset 25771265](https://github.com/PyRookie1/luna-toc-sc/rules/25771265). It requires PRs and both GitHub Actions checks (`Typecheck, test, build and package`; `Dependency advisory gate`), strict up-to-date head checks, and blocks force push/deletion without bypass. GitHub confirms `main.protected:true`. See [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md). This protection was configured by the repository administrator, not by the connected GitHub tool.

## Release and rollback

- Open **Actions → LunaTOC-SC manual release**; choose `main` and explicitly check `confirm_publish`.
- Verify both verification and publish jobs succeed. Check the generated tag, ZIP and SHA256.
- Do not delete historical Releases or Git tags.
- Code rollback does not automatically roll back local user data. Check schema compatibility before reverting extension versions.

## Stage 10 merge gate (2026-10-24)

Stage 10 merge evidence and remaining blockers are tracked in [docs/STAGE_10_MERGE_READINESS.md](docs/STAGE_10_MERGE_READINESS.md). Passing the mock-browser suite is not a real-account acceptance test. Do not mark PR #16 merge-authorized while the P1 unauthenticated deletion-notification issue B026 remains unresolved or branch protection is inactive. Re-run the latest branch CI after any fix and obtain explicit merge authorization separately.

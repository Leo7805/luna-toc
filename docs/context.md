# Persistent Project Context

## Purpose

This file is the concise handoff for resuming LunaTOC work after a session restart, context loss, compaction, or agent handoff. It records only the current working state; durable architecture and decisions belong in `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.

## Project

- LunaTOC is a Chrome extension that adds a prompt table-of-contents sidebar to ChatGPT.
- The source is TypeScript and React, built with Vite and CRXJS into `dist/`.
- Chrome must load the generated `dist/` directory rather than the repository root.
- The root `manifest.json` is the source Manifest and authoritative extension version.

## Current Architecture

- `src/content.ts` is the minimal Isolated World entry.
- `src/app/applicationShell.ts` creates and coordinates the sidebar application.
- `src/components/sidebar` contains the incremental React sidebar shell.
- ChatGPT-specific behavior lives under `src/platforms/chatgpt`; a Copilot placeholder lives under `src/platforms/copilot`. Both implement the `Platform` interface in `src/platforms/platformInterface.ts`, and the active adapter is resolved once at startup via `getActivePlatform(host = window.location.host)`.
- Generic prompt navigation and fingerprint logic lives under `src/features/navigation`.
- ChatGPT navigation supports `legacy-native` and experimental `independent-virtual` strategies; the default remains `legacy-native`.
- React UI is being adopted incrementally while legacy imperative modules continue to use stable sidebar slots.

## Current Working Direction

- Platform abstraction for Copilot / Gemini / Claude is now in place (see [ADR 11](DECISIONS.md#adr-11-platform-abstraction-interface)). ChatGPT adapter wraps the existing modules unchanged; Copilot is a placeholder that throws on every method.
- Implement actual Copilot support: replace each `throw` in `src/platforms/copilot/*.ts` with concrete fetch-bumping, route detection, navigation, theme detection, etc. Subsequent Gemini and Claude adapters follow the same shape.
- Prefer completing small, reviewable React migrations instead of rewriting the entire sidebar at once.
- Treat the independent virtual navigation algorithm as experimental; avoid further isolated patches without reviewing the complete search flow.
- Keep z-index ownership centralized and allow host-page fullscreen media overlays to temporarily hide LunaTOC surfaces.

## Collaboration Rules

- Read `AGENTS.md`, `docs/ARCHITECTURE.md`, and `docs/DECISIONS.md` before code changes.
- Propose the affected files and approach, then wait for explicit user approval.
- Write code comments, documentation, and persistent context in English.
- The primary coordinating agent owns updates to this file unless write ownership is explicitly delegated.
- Sub-agents may read this file and should return findings to the primary agent rather than editing it concurrently.
- Keep this file current by replacing stale state; do not append chat transcripts or implementation diaries.
- Never record secrets, credentials, access tokens, or private user data here.

## Validation and Handoff

- Logic tests belong in `test/` and use Vitest.
- After relevant source changes, run `npm test`, `npm run typecheck`, and `npm run build`.
- Report executed automated tests separately from manual tests that remain for the user.
- Organize implementation summaries by linked file, with one-line file and changed-function descriptions.
- End implementation handoffs with a Conventional Commits message.

## Next Step

- Tasks P0.1, P0.2, and P0.3 are complete: test suite and TypeScript baseline are green.
- Task P0.4 Audit completed and documented in `docs/P0.4_AUDIT.md`.
- Task P0.4a completed: removed orphaned background fingerprint collection and hashing lifecycles.
- Task P0.4b completed: simplified `navigationSnapshotStore.ts` to focus strictly on prompt snapshots, preserving revision semantics and defensive cloning.
- Task P0.4c completed: decoupled `virtualSearchController.ts` and deleted disconnected search planners and machine modules (`virtualSearchPlanner.ts`, `relativeSearchPlanner.ts`, `virtualSearchMachine.ts`).
- Task P0.4d completed:
  - Added regression tests for active DOM helpers (`findRenderedChatGptPromptByText`, `getChatGptThreadScrollContainer`, `readMountedWithSidebarIdx`) and platform interface contracts (`platformInterface.test.ts`).
  - Pruned 5 unused navigation methods from `PlatformNavigationAdapter` (`isElementVisible`, `getScrollMetrics`, `createElementNavigationAnchor`, `observeVirtualPosition`, `getPromptMountDiagnostic`) and their ChatGPT/Copilot implementations and stubs.
  - Cleaned `virtualSearchAdapter.ts` to strictly retain active DOM lookup and scroll container functions.
  - Removed unused `RenderedTextBlock` and viewport sampling helper `getVisibleAssistantViewportSamples` from `renderedTextAdapter.ts`.
  - Deleted remaining 5 legacy virtual search modules (`virtualSearchController.ts`, `navigationAnchorStore.ts`, `visiblePositionResolver.ts`, `matcher.ts`, `segmentMatcher.ts`).
  - Deleted 5 legacy test suites (`navigationAnchorStore.test.ts`, `visiblePositionResolver.test.ts`, `resolvePromptIndexesFromIds.test.ts`, `matcher.test.ts`, `segmentMatcher.test.ts`).
  - Verified baseline: 33/33 test files (143/143 tests passing), typecheck clean, production build clean, and `git diff --check` clean.
- P0.4 cleanup is fully complete.
- Task P1.1 completed:
  - Extended `PlatformNavigationAdapter` and `PlatformNavigationDiagnostics` in `src/platforms/platformInterface.ts` with optional methods (`findRenderedPromptByText`, `readMountedWithSidebarIdx`, `getMessageIdFromElement`, `isJumpVizDebugEnabled`) and modern selectors in `config.selectors`.
  - Exported `getChatGptMessageId` from `virtualSearchAdapter.ts` and wired active implementations in `chatgpt/index.ts`. Left optional methods `undefined` on `copilotPlatform` without dummy stubs.
  - Refactored `mountQueue.ts` and `promptNavigation.ts` to use `getActivePlatform()` lazily, eliminating direct imports from `@/platforms/chatgpt/*` and adding explicit error handling when mounted prompt inspection is unsupported.
  - Refactored `navigatorController.ts` and `outline.ts` to use `platform.config.selectors` and `platform.navigation.getMessageIdFromElement`, preserving DOM selector semantics, query scopes, ancestor lookups, and comma-separated message ID matching.
  - Verified baseline: 34 test files (147 tests passing), `typecheck` clean, `build` clean, and `git diff --check` clean.
- Next step: Awaiting next instructions for Phase P1.2. Do not proceed to P1.2 without approval.


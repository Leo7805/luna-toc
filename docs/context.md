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
- ChatGPT-specific behavior lives under `src/platforms/chatgpt`.
- Generic prompt navigation and fingerprint logic lives under `src/features/navigation`.
- ChatGPT navigation supports `legacy-native` and experimental `independent-virtual` strategies; the default remains `legacy-native`.
- React UI is being adopted incrementally while legacy imperative modules continue to use stable sidebar slots.

## Current Working Direction

- Continue separating platform-independent sidebar and navigation behavior from ChatGPT-specific adapters before adding support for consumer Microsoft Copilot, Gemini, or Claude.
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

- Resume from the user's next confirmed task. Update this section when a concrete implementation goal is selected.

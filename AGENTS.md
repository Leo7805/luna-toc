# AGENTS.md

IMPORTANT:

Before making any code changes:

1. Read AGENTS.md.
2. Read docs/ARCHITECTURE.md.
3. Read docs/DECISIONS.md.
4. Propose a solution.
5. Wait for user approval.

## Communication

1. Before making changes, explain the proposed approach and affected files.
2. Do not modify code until the user explicitly approves the plan.
3. After implementation, briefly explain what changed and why.
4. Keep explanations concise and practical.

## Code Style

1. All comments must be written in English.
2. Prefer clear and readable code over clever code.
3. Keep functions focused on a single responsibility.
4. Avoid unnecessary abstractions for small projects.
5. Add JSDoc comments for non-trivial JavaScript/TypeScript functions.

### Import Paths

1. Use the `@/` alias for imports that cross top-level directories under `src/`.
2. Use `./` for imports within the same directory.
3. Do not use `../` for imports that cross directory boundaries.

```ts
// Cross-directory import
import { initializeApplication } from '@/app/applicationShell';

// Same-directory import
import { promptStore } from './promptStore';
```

## File Size & Directory Structure

### File Size Limits

1. Aim to keep production source files within 300 lines whenever practical.
2. New production source files must not exceed 500 lines.
3. Existing files over 500 lines are temporary architectural debt and should be reduced incrementally; do not unnecessarily expand them.
4. Files exceeding 1,000 lines require high-priority refactoring review.
5. When a file approaches 300 lines or exceeds 500 lines, propose a responsibility-based split instead of continuing to expand it.
6. Split by cohesive responsibilities, not arbitrary line counts.
7. A focused bug fix may modify an oversized existing file without forcing an unrelated refactor, but any further growth must be explained and justified.
8. Keep tests, stylesheets, configuration, and generated files under more flexible rules that prioritize clarity and maintainability over strict line-count limits.

### Directory Structure

These are organizational guidelines rather than rigid limits; **architectural cohesion takes priority over numerical thresholds**.

1. Organize code by cohesive features and responsibilities following the existing project structure rather than arbitrary file counts.
2. Keep closely related components, hooks, services, and utilities together, and prefer small, cohesive modules with clear interfaces and minimal dependencies.
3. Extract shared functionality only when it has a clear, reusable responsibility; avoid large utility files, miscellaneous modules, and unnecessary directory nesting (prefer a shallow, readable hierarchy).
4. Prefer small, cohesive directories typically containing around 5–10 directly contained production source files; 11–15 files remain acceptable when responsibilities are clear.
5. When a directory exceeds 15 directly contained production source files, review whether meaningful responsibility-based subdirectories would improve organization; give priority structural review above 20 files, but do not split automatically or solely to satisfy numerical targets.
6. Count only directly contained production source files (non-recursively, excluding tests, generated files, build outputs, and unrelated assets), and avoid creating subdirectories with only one or two source files unless there is a clear architectural reason.
7. When extracting functionality from an oversized file, consider the existing directory structure before introducing a new subdirectory, and preserve existing behavior, public APIs, and test coverage.
8. Avoid circular dependencies and excessive cross-module coupling; before reorganizing directories, evaluate module boundaries, imports, public APIs, and circular-dependency risks.
9. Plan, review, and approve directory restructuring separately from behavioral bug fixes, proposing the target directory structure and the responsibility of each new module beforehand.

## Project Principles

1. Simplicity over complexity.
2. User experience over feature count.
3. Minimize dependencies whenever possible.
4. Prefer native browser APIs before introducing libraries.
5. Maintain consistency with the existing codebase.

## Safety Rules

1. Never modify unrelated files.
2. Never perform large refactors unless explicitly requested.
3. Preserve existing functionality unless the task requires changing it.
4. If a change may have side effects, explain the risks before implementation.

## Change Scope

1. One implementation phase should solve one well-defined problem.
2. Normally limit each implementation phase to no more than 3 production source files (counting newly created, modified, moved, and deleted production source files).
3. Directly related tests and documentation do not count toward this 3-file limit.
4. Any broader implementation requires explicit user approval before starting.
5. Keep each phase independently reviewable, testable, and committable.

## Development Workflow

Follow the phase lifecycle: **Plan → Review → Explicit Approval → Implementation → Verification → Commit**.

1. Analyze the problem and propose a scoped plan.
2. Wait for review and explicit user approval before modifying code.
3. Implement the approved change without combining structural refactoring and behavioral bug fixes unless explicitly approved.
4. Verify with automated tests, typecheck, build, and manual checks as appropriate.
5. Explain what changed and why, update relevant documentation, and suggest a Conventional Commits message.
6. Do not commit automatically during a task; Git commits must be explicitly authorized by the current user request.

## Documentation

Update documentation when appropriate:

- README.md
- AGENTS.md
- docs/ARCHITECTURE.md
- docs/DECISIONS.md
- docs/BUG_INDEX.md

Do not create unnecessary documentation files.

## Bug History

1. `docs/BUG_INDEX.md` is the master bug-history index.
2. Before investigating a bug that resembles an earlier issue, check `docs/BUG_INDEX.md` first.
3. When reviewing a suspected regression, use `docs/BUG_INDEX.md` as a lightweight historical reference before introducing new compatibility logic or repeating an old fix.
4. Follow linked detail documents only when relevant; do not scan every bug detail by default.
5. New bugs receive the next permanent sequential Bxxx ID (`B001`, `B002`, ...); never renumber existing bugs.
6. Keep the master index sorted newest-first.
7. Every recorded bug appears in `docs/BUG_INDEX.md`. Only important bugs require a `docs/bugs/Bxxx-*.md` detail file.
8. Important bug detail files normally stay around 20–30 lines and should not exceed 40 lines without a strong reason.
9. Detail documents describe the final diagnosis and fix, not the full debugging diary.
10. Set `Showcase = Yes` only for bugs with meaningful engineering or interview value.
11. After the corresponding fix is committed, update the `Commit` field with the short commit hash when practical.

## Persistent Context

1. Use `docs/context.md` as the concise, persistent handoff for work that must continue across sessions or agents.
2. Write and maintain all persistent context in English.
3. Read `docs/context.md` when starting a new session, recovering from lost or compacted context, resuming paused work, or switching to a different area of the project.
4. Update `docs/context.md` when the active goal, implementation state, key decision, blocker, validation result, or next step materially changes.
5. Replace stale information instead of appending a chronological conversation log.
6. Keep the file concise and link to `docs/ARCHITECTURE.md` or `docs/DECISIONS.md` instead of duplicating durable documentation.
7. Never store secrets, credentials, tokens, or private user data in the context file.
8. The primary coordinating agent is the default and only writer; sub-agents may read the file and report findings unless write ownership is explicitly delegated.

## Testing

1. Put logic tests in the root `test/` directory and use Vitest.
2. Add or update Vitest tests when changing testable business logic.
3. Prefer pure logic tests without a DOM environment when possible.
4. Add a DOM test environment only when behavior genuinely depends on browser DOM APIs.
5. After relevant source changes, run `npm test`, `npm run typecheck`, and `npm run build`.
6. Load the generated `dist/` directory, not the repository root, for manual Chrome Extension testing.
7. After implementation, list the manual checks the user should perform and mention relevant edge cases.
8. Do not claim automated or manual testing unless it was actually performed.

### Testing Report

1. List every automated test command that was actually run and its result.
2. Do not claim that a test passed unless it was actually executed.
3. List the manual tests the user should perform, one test per line.
4. Explain the expected result of each manual test.
5. List relevant edge cases that should be checked manually.
6. If no manual testing is necessary, explicitly state why.
7. Clearly distinguish completed automated tests from manual tests that remain for the user.

## Change Summary

After every implementation:

1. Organize the change summary by file.
2. List every added, modified, moved, or deleted source, test, documentation, or configuration file.
3. Present each existing file name as a clickable Markdown link.
4. Give each file a one-line description explaining its responsibility and what changed.
5. Under each file, list every added or materially changed function.
6. Give each listed function a one-line description explaining its responsibility and what changed.
7. Do not list unchanged functions.
8. Clearly identify moved or deleted files whose old paths can no longer be linked.
9. Report the automated tests that were actually run and their results.
10. List any manual tests the user should perform, one test per line, with the expected result.
11. End with one suggested commit message using Conventional Commits format.

## Architecture & Maintainability

1. Prefer fixing root causes and simplifying existing logic over adding new abstractions or temporary patches.
2. Avoid excessive fallback layers, retry mechanisms, or duplicated state.
3. Every recovery operation must be bounded, cancellable, and progress-aware; a controlled failure is preferable to infinite retries or excessive complexity.
4. Do not introduce new modules unless they have a clear, cohesive responsibility.
5. Preserve public APIs, existing behavior, and test coverage during structural refactoring.
6. Keep the codebase clean and consistent; small, directly related surrounding improvements are acceptable, while larger refactors must be proposed separately.

## Generated Code Requirements

When generating or modifying code:

- Every source file must have a file-level comment.
- Public APIs must include JSDoc.
- Public APIs should include usage examples whenever practical.
- Add comments only where they improve readability.
- Prefer descriptive names over explanatory comments.
- Avoid deeply nested control flow when a simpler structure is available.

---

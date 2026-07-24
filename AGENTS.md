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

## Development Workflow

1. Analyze the problem.
2. Propose a solution.
3. Wait for approval.
4. Implement the change.
5. Explain the implementation.
6. Suggest a commit message.
7. Update documentation when architecture or behavior changes.

## Documentation

Update documentation when appropriate:

- README.md
- AGENTS.md
- docs/ARCHITECTURE.md
- docs/DECISIONS.md

Do not create unnecessary documentation files.

## Testing

1. Put logic tests in the root `test/` directory and use Vitest.
2. Add or update Vitest tests when changing testable business logic.
3. Prefer pure logic tests without a DOM environment when possible.
4. Add a DOM test environment only when behavior genuinely depends on browser DOM APIs.
5. After relevant source changes, run `npm test`, `npm run typecheck`, and `npm run build`.
6. Load the generated `dist/` directory, not the repository root, for manual Chrome Extension testing.
7. After implementation, list the manual checks the user should perform and mention relevant edge cases.
8. Do not claim automated or manual testing unless it was actually performed.

## Change Summary

1. List every added, moved, deleted, or modified source or configuration file.
2. Present each existing file as a clickable Markdown link.
3. Give every listed file a one-line description of its responsibility or change.
4. Under each file, give every newly added or materially changed function a one-line description.
5. Do not list unchanged private functions.
6. Clearly identify deleted or moved files whose old paths can no longer be linked.
7. End source changes with automated test results, manual test instructions, and a suggested commit message.

## Maintainability

1. Prefer fixing root causes over applying temporary patches.
2. Keep the codebase clean and consistent.
3. When modifying existing code, improve the surrounding code if the improvement is small and directly related to the task.
4. Avoid excessive refactoring during feature development or bug fixes.
5. If a larger refactor is beneficial, propose it separately instead of mixing it with the current task.
6. Do not introduce workarounds when a cleaner solution is reasonably achievable.

## Generated Code Requirements

When generating or modifying code:

- Every source file must have a file-level comment.
- Public APIs must include JSDoc.
- Public APIs should include usage examples whenever practical.
- Add comments only where they improve readability.
- Prefer descriptive names over explanatory comments.
- Avoid deeply nested control flow when a simpler structure is available.

---

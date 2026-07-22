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

After implementation:

1. Describe how the feature can be tested manually.
2. Mention edge cases when relevant.
3. Do not claim something is tested unless it was actually tested.
4. Run `npm run typecheck` and `npm run build` for source changes when relevant.
5. Load the generated `dist/` directory, not the repository root, for Chrome testing.

## Maintainability

1. Prefer fixing root causes over applying temporary patches.
2. Keep the codebase clean and consistent.
3. When modifying existing code, improve the surrounding code if the improvement is small and directly related to the task.
4. Avoid excessive refactoring during feature development or bug fixes.
5. If a larger refactor is beneficial, propose it separately instead of mixing it with the current task.
6. Do not introduce workarounds when a cleaner solution is reasonably achievable.

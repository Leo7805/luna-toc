# Bug Index

This document is the master registry for tracking bugs and regressions in Luna TOC.

## ID & Ordering Rules

- **Permanent Sequential IDs**: Assigned in recording order (`B001`, `B002`, `B003`, ...).
- **Immutable**: Once assigned, an ID never changes. Never renumber existing bugs. New bugs receive the next available ID.
- **Newest-First**: Display bugs newest-first so higher/newer IDs appear above older IDs.
- **Detail Documents**: Important bugs link from the `Bug` column to a concise detail document in `bugs/`. Small bugs exist only as one row in this table.
- **Showcase**: Set to `Yes` if the bug carries notable engineering, portfolio, or case-study value; otherwise `No`.
- **Commit**: Record the short commit hash after the fix is committed; use `—` if pending.

---

| ID | Date | Bug | Area | Root Cause | Fix | Commit | Showcase |
|---|---|---|---|---|---|---|---|
| B001 | 2026-10-13 | [First prompt disappears during new-chat route migration](bugs/B001-first-prompt-disappears-new-chat.md) | Navigation / State | ChatGPT's temporary `local-*` conversation route was treated as permanent, so state was dropped during the second identity transition. | Treat `local-*` as temporary and migrate accumulated messages and snapshots across the full temporary route chain. | — | Yes |

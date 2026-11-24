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
| B004 | 2026-11-24 | [Cold-start navigation ejection and Walker oscillation on tall unmounted turns](bugs/B004-cold-start-tall-turn-ejection.md) | Navigation / Virtual Layout / Walker | Jumping directly to a very tall unmounted turn (~8,800px estimated at ~292–386px) triggered ChatGPT's native `compensateScrollToDistanceFromBottomPx`, ejecting the viewport past the target and reverting its estimate; unbounded Viewport Walker then oscillated indefinitely against host compensation, and offscreen `scrollHeight` ticks reset target stability. | Added bounded progress/oscillation guards and physical-boundary gating to Viewport Walker, added bounded 2-hop successor-anchor recovery (`successorAnchorRecovery.ts`) for downward-ejected stagnant offsets, made disconnect recovery progress-aware, and decoupled aligned-target stability from compensated offscreen `scrollHeight` oscillation. Verified 851/851 Vitest tests and 5/5 real-Chrome cold-start `#1 → #15` trials (original bug fixed; rare triple-giant-turn `#90 → #14` post-landing ejection accepted as a cleanly bounded edge case). | `c7e4aa2` | Yes |
| B003 | 2026-11-06 | Issue #5 controlled regressions (implemented; real-page acceptance pending) | Conversation state / SSE / Routing | Controlled tests expose shared stream buffers, discarded late events, live-only prompt collapse, and late live duplicates overriding GET authority; the historical incident remains unconfirmed. | Implemented on 2026-11-07: local buffers, cache-only late updates, pending prompt reconciliation, GET-confirmed ID precedence, and Project route consistency. Real-workspace D10: 116 tests passed; full suite: 765 tests passed; typecheck and build passed. Real-page acceptance pending. Pagination continuity and unversioned GET ordering remain unverified. | — | No |
| B002 | 2026-10-14 | Unhandled custom TOC title persistence rejection after extension context invalidation | Custom TOC Titles / Storage | A storage write rejected after Chrome invalidated the content-script context, while the dialog intentionally discarded the async submit promise. | Roll back optimistic cache changes on persistence failure and handle rejected dialog submissions explicitly. | — | No |
| B001 | 2026-10-13 | [First prompt disappears during new-chat route migration](bugs/B001-first-prompt-disappears-new-chat.md) | Navigation / State | ChatGPT's temporary `local-*` conversation route was treated as permanent, so state was dropped during the second identity transition. | Treat `local-*` as temporary and migrate accumulated messages and snapshots across the full temporary route chain. | — | Yes |

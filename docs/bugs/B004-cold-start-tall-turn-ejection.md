# B004 — Cold-Start Navigation Ejection & Walker Oscillation on Tall Unmounted Turns

## Symptom

On a fresh reload of a long ChatGPT conversation (123–131 prompts), navigating to Prompt #1 and then clicking Prompt #15 failed in two ways:
- **Fast failure (~0.5–2.5s):** Target mounted briefly, unmounted, and terminated with `Jump failed` (`target-disconnected`).
- **Unbounded oscillation (10s+):** Viewport Walker repeatedly bounced across distant prompts (`Now #23 / #37 / #42 / #36`) without making net progress.

## Root Cause

1. **Unmeasured virtual-list height ejection:** Prompt #15 belongs to an ~8,800px-tall turn whose unmounted height estimate is ~292–386px. Jumping directly to its estimated `topOffsetPx` mounted the turn, causing its expansion to trigger ChatGPT's native `compensateScrollToDistanceFromBottomPx`. ChatGPT shifted `scrollTop` thousands of pixels past #15, unmounting it and reverting its height estimate so repeated direct jumps replayed the same ejection.
2. **Unbounded Viewport Walker:** `loadUntilMountedViaViewport` lacked net-progress, direction-flip, and step/time guards, and invoked `handleBoundaryOrBackfillStall` on mid-feed host compensation reversals.
3. **Rigid recovery & offscreen stability resets:** Recovery #2 unconditionally forced Viewport Walker even while virtual offsets were converging, and `stabilizeStep` reset alignment stability on compensated offscreen `scrollHeight` ticks even when the target stayed motionless at `190px`.

## Fix

1. **Bounded Viewport Walker (`viewportWalker.ts`):** Added net directional progress, frontier progress, oscillation (`MAX_UNPRODUCTIVE_STEPS = 8`, `MAX_DIRECTION_FLIPS = 4`), no-progress timeout (`4000ms`, reset on genuine pagination), safety step cap (`200`), and physical-boundary gating for `handleBoundaryOrBackfillStall`.
2. **Bounded Successor-Anchor Recovery (`successorAnchorRecovery.ts`, `virtualLayoutStrategy.ts`):** When a direct jump to a non-zero stagnant `topOffsetPx` is ejected downward, jumps to at most 2 valid successor turns (`targetIndex + 1`, then `+2`) so the host virtualizer mounts and measures the tall turn above the anchor, verifying connected stability across rendered frames before handoff.
3. **Progress-Aware Recovery & Target-State Stability (`promptNavigation.ts`):** Keeps Virtual Layout on Recovery #2 when `topOffsetPx` shifted meaningfully, and evaluates actual target UUID connection and viewport movement (`190px`) rather than failing on compensated offscreen `scrollHeight` oscillation.

## Verification & Known Limitation

- **Automated:** `71/71` test files (`851/851` Vitest tests), `typecheck`, and `build` passed.
- **Real Chrome:** `5/5` independent fresh-reload `#1 → #15` trials passed (`190.0px`, `0.0px` error, `2100ms` stable, `0` disconnects), plus `#131 → #15`, `#1 → #60`, `#15 → #90`, To Top, To Bottom (`0px`), Double-click Last Prompt (`190.0px`), Fast Path, wheel cancellation, and rapid switching.
- **Accepted bounded edge case:** Jumping from far away (`#90 → #14`) into three consecutive unmeasured giant turns (`#13` 5.5k px / `#14` 2.4k px / `#15` 8.8k px) can still trigger post-landing ejection when `#13` mounts above `#14`; navigation terminates cleanly (~3.3s) without oscillating.

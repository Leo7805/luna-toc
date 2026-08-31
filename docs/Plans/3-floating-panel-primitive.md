# Plan 3: Floating Panel Primitive

## 思路

After Plan 1 renames `src/features/toggleButton.ts` → `src/features/SidebarToggleButton.ts` and `src/features/jumpControls/jumpControls.ts` → `src/app/sidebar/FloatingPanel.ts`, both floating controls carry their own copy of viewport-clamp math. This plan extracts the clamp into a shared pure function and adds the missing `dataset.dragged` flag to `FloatingPanel` (matching `SidebarToggleButton`'s click-suppression pattern).

Scope is deliberately tight: pure-function extraction + a defensive `dataset.dragged` flag. Drag-handler abstraction (B in the planning discussion) is explicitly out of scope — the two panels diverge on too many axes (2D vs 1D, absolute vs ratio storage, drag acknowledgment, descendant-button guard).

## TODO 大纲

- [ ] 1. Create `src/lib/clampToViewport.ts` with `clampToViewport(left, top, width, height, options?)`
- [ ] 2. Refactor `SidebarToggleButton.ts` to call `clampToViewport`
- [ ] 3. Refactor `FloatingPanel.ts` to call `clampToViewport`
- [ ] 4. Add `dataset.dragged` flag to `FloatingPanel`'s drag handler
- [ ] 5. Verify build and functionality

## Dependencies

Plan 3 must run after Plan 1 completes the renames:

- `src/features/toggleButton.ts` → `src/features/SidebarToggleButton.ts`
- `src/features/jumpControls/jumpControls.ts` → `src/app/sidebar/FloatingPanel.ts`

Plan 3 is independent of Plan 2 (sessionStorage helper).

## 改动清单

- New [`src/lib/clampToViewport.ts`](src/lib/clampToViewport.ts) (~20 lines)
  - `clampToViewport(left: number, top: number, width: number, height: number, options?: ViewportClampOptions): { left: number; top: number }` — pure function, no DOM, no storage
  - `ViewportClampOptions` defaults margins to 8px on all sides; `SidebarToggleButton` passes `{ marginRight: 0 }`
- Modify [`src/features/SidebarToggleButton.ts`](src/features/SidebarToggleButton.ts)
  - New import: `import { clampToViewport } from '@/lib/clampToViewport';`
  - Remove inline clamp arithmetic from `clampPosition`; call `clampToViewport` with `{ marginRight: 0 }`
  - Delete `POSITION_MARGIN` and `RIGHT_POSITION_MARGIN` constants if no longer used elsewhere in the file
- Modify [`src/app/sidebar/FloatingPanel.ts`](src/app/sidebar/FloatingPanel.ts)
  - New import: `import { clampToViewport } from '@/lib/clampToViewport';`
  - Remove inline clamp arithmetic from `clampJumpControlsTop`; call `clampToViewport` with default margins
  - Add `dataset.dragged = 'true'` after drag completes, matching `SidebarToggleButton`'s pattern

## 步骤

- [ ] 1.1 Create [`src/lib/clampToViewport.ts`](src/lib/clampToViewport.ts) with `clampToViewport` and `ViewportClampOptions`
- [ ] 2.1 In `SidebarToggleButton.ts`, replace inline `Math.min`/`Math.max` clamping with `clampToViewport(left, top, width, height, { marginRight: 0 })`
- [ ] 2.2 Verify `POSITION_MARGIN` / `RIGHT_POSITION_MARGIN` constants are not used elsewhere in the file; remove if dead
- [ ] 3.1 In `FloatingPanel.ts`, replace inline `clampJumpControlsTop` with `clampToViewport(0, top, 0, height, { marginTop: 8, marginBottom: 8 })` or equivalent
- [ ] 3.2 Verify the `8px` margin constant is not duplicated elsewhere in the file
- [ ] 4.1 In `FloatingPanel.ts`'s `pointerup` handler, after the existing `if (didDrag) saveJumpControlsPosition(controls);`, add `controls.dataset.dragged = 'true';`
- [ ] 4.2 Confirm the panel container has no click handler bound externally; document any risk in the verification section
- [ ] 5.1 `pnpm typecheck` passes
- [ ] 5.2 `pnpm sbuild` passes
- [ ] 5.3 `pnpm test` passes
- [ ] 5.4 Chrome manual smoke: drag each panel, verify position persists; verify no spurious click fires after drag

## 验证

- [ ] `pnpm typecheck` passes
- [ ] `pnpm sbuild` passes (no new files; just edits)
- [ ] `pnpm test` passes (no behavior change for existing tests)
- [ ] Chrome manual smoke:
  - [ ] Drag `SidebarToggleButton` — position saved, refresh restores; click after drag does not toggle sidebar visibility
  - [ ] Drag `FloatingPanel` — position saved (ratio format), refresh restores; resize re-clamps; clicking on panel padding after drag does not trigger any spurious click
  - [ ] Resize browser — both panels re-clamp and persist new positions

## 风险

- **`dataset.dragged` on `FloatingPanel`:** Defensive flag matching `SidebarToggleButton`. Today the panel container has no click handler, so the flag has no immediate consumer. The fix is harmless and brings parity with `SidebarToggleButton` in case a future click handler is added to the panel.
- **Clamp margin defaults:** `FloatingPanel` currently uses 8px top/bottom; `SidebarToggleButton` uses 8px on most sides but 0 on the right (so it can sit flush with the viewport edge). The shared primitive must allow per-side margin overrides. Confirmed in API: `ViewportClampOptions` is `{ marginLeft?, marginRight?, marginTop?, marginBottom? }` with each defaulting to 8.
- **Behavior equivalence:** Both inline clamp implementations currently use the same `Math.min(maxX, Math.max(minX, x))` pattern with the same 8px margins (modulo `SidebarToggleButton`'s right edge). Extracting to a shared function with identical math produces identical behavior.

## Out of Scope

- Full drag-handler abstraction (`initDraggableFloatingControl` factory). Deferred indefinitely — the two panels diverge on too many axes to justify a generic wrapper.
- Storage-format alignment (`SidebarToggleButton` `{ left, top }` vs `FloatingPanel` `{ topRatio }`). Behavior change; not part of this plan.
- Drag handler abstraction in `src/navigation/follow/follow.ts` (`pointerdown` abort only). Different concern (follow-tracking, not drag-to-position).
/**
 * Owns the active-jump progress snapshot consumed by the sidebar status
 * band ("Jumping to prompt #N"). A thin object store plus the re-render
 * notification the status band needs to reflect changes.
 *
 * Kept free of DOM / controller imports so it can be unit-tested directly.
 */
export type JumpProgress =
  | { active: boolean; targetIndex: number; remainingSteps: number }
  | null;

let progress: JumpProgress = null;
let onRender: (() => void) | null = null;

/**
 * Returns the current jump progress snapshot, or null when no jump is
 * active.
 */
export function getJumpProgress(): JumpProgress {
  return progress;
}

/**
 * Injects the callback fired after `setJumpProgress` / `clearJumpProgress`
 * so the controller can re-render the status band.
 */
export function setOnRender(callback: () => void): void {
  onRender = callback;
}

/**
 * Marks a jump as active and notifies the renderer.
 */
export function setJumpProgress(next: NonNullable<JumpProgress>): void {
  progress = next;
  onRender?.();
}

/**
 * Clears any active jump progress and notifies the renderer.
 */
export function clearJumpProgress(): void {
  if (progress === null) return;
  progress = null;
  onRender?.();
}
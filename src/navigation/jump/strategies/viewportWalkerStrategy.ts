/**
 * Viewport-walker jump strategy adapter for unmounted prompts.
 * In Step 1, this is a transparent synchronous adapter returning the original walker Promise directly.
 */
import type { JumpStrategyContext } from './types';
import { loadUntilMountedViaViewport } from '@/navigation/jump/viewportWalker';

/**
 * Executes unmounted prompt navigation via the viewport-walker algorithm.
 *
 * @param context Strategy execution parameters including target prompt and cancellation check.
 * @returns Promise resolving to the mounted target element, or null if cancelled or exhausted.
 */
export function executeViewportWalkerStrategy(
  context: JumpStrategyContext
): Promise<HTMLElement | null> {
  return loadUntilMountedViaViewport(
    context.targetMessage.id,
    context.targetIndex,
    context.prompts,
    context.container,
    context.jumpId,
    context.isCancelled
  );
}

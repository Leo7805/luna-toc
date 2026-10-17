/**
 * Scaffold for future React virtual-layout jump strategy.
 * This module is reserved for Step 2 and is not invoked during Step 1 live navigation.
 */
import type { JumpStrategyContext } from './types';

/**
 * Placeholder for virtual-layout jump strategy.
 *
 * @param _context Strategy execution parameters.
 * @returns Always returns null in Step 1 scaffold.
 */
export function tryVirtualLayoutStrategy(
  _context: JumpStrategyContext
): Promise<HTMLElement | null> {
  return Promise.resolve(null);
}

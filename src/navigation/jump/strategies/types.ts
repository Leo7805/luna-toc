/**
 * Type definitions for navigation jump strategies.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';

/**
 * Execution context passed into jump strategy implementations.
 */
export interface JumpStrategyContext {
  targetMessage: NavigatorMessage;
  targetIndex: number;
  prompts: ReadonlyArray<NavigatorMessage>;
  container: HTMLElement;
  jumpId: string;
  isCancelled: () => boolean;
}

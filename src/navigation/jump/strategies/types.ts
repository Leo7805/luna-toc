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

/**
 * Outcome of evaluating virtual strategy availability for an unmounted prompt.
 * Determines whether the jump locks into Virtual Mode or selects Legacy Mode.
 */
export type VirtualStrategyAttempt =
  | {
      readonly mode: 'unsupported';
      readonly reason: string;
    }
  | {
      readonly mode: 'virtual';
      readonly promise: Promise<VirtualStrategyExecutionResult>;
    };

/**
 * Result of executing an active virtual jump or pagination sequence.
 */
export type VirtualStrategyExecutionResult =
  | {
      readonly status: 'mounted';
      readonly element: HTMLElement;
    }
  | {
      readonly status: 'capability-failure';
      readonly reason: string;
    }
  | {
      readonly status: 'exhausted';
      readonly reason: string;
    }
  | {
      readonly status: 'cancelled';
    };

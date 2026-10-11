/**
 * Types and interfaces for virtual list search and navigation observations.
 */
import type { NavigationAnchor } from './navigationAnchorStore';
import type { VisiblePromptPosition } from './visiblePositionResolver';

export interface VirtualScrollMetrics {
  scrollTop: number;
  maximumScrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface VirtualSearchObservation {
  position: VisiblePromptPosition;
  anchors: NavigationAnchor[];
}

export interface VirtualSearchDiagnosticEvent {
  eventName: string;
  details: Record<string, unknown>;
}

export interface VirtualSearchControllerOptions {
  targetPromptId: string;
  targetPromptIndex: number;
  promptCount: number;
  getConfirmedAnchors: () => Promise<NavigationAnchor[]>;
  invalidateConfirmedAnchor?: (
    promptId: string,
    promptIndex: number
  ) => Promise<void>;
  getObservedAnchors: () => NavigationAnchor[];
  recordObservation: (anchor: NavigationAnchor) => void;
  getScrollMetrics: () => VirtualScrollMetrics;
  observePosition: () => Promise<VirtualSearchObservation>;
  isTargetRendered: () => boolean;
  scrollTo: (scrollTop: number) => void;
  waitForRender?: () => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  maxAttempts?: number;
  maxUnproductiveAttempts?: number;
  maxDurationMs?: number;
  targetDomRecoveryDirection?: 1 | -1 | null;
  onDiagnosticEvent?: (event: VirtualSearchDiagnosticEvent) => void;
  onProgress?: (info: { remaining: number }) => void;
}

export type VirtualSearchResultStatus =
  | 'found'
  | 'cancelled'
  | 'exhausted'
  | 'timed-out'
  | 'unresolved';

export interface VirtualSearchResult {
  status: VirtualSearchResultStatus;
  attempts: number;
  lastPlan: unknown | null;
  lastPosition: VisiblePromptPosition;
}

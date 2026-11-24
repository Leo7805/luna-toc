/**
 * Stateless jump navigation diagnostics, debug-flag gating, and structured
 * alignment/failure console formatters for prompt navigation.
 */
import { getActivePlatform } from '@/platforms';
import type { AlignElementResult } from './promptAlignment';

/**
 * Generates a unique navigation jump identifier via the active platform diagnostics service.
 *
 * @returns Unique jump identifier string.
 * @example
 * const jumpId = createNavigationJumpId();
 */
export function createNavigationJumpId(): string {
  return getActivePlatform().diagnostics.createJumpId();
}

/**
 * Logs a structured navigation lifecycle event via the active platform diagnostics service.
 *
 * @param jumpId Correlation ID for the active jump.
 * @param eventName Lifecycle event name (e.g. `JUMP_START`, `JUMP_FINISHED`).
 * @param details Optional structured event payload.
 * @param storage Optional storage override for diagnostic persistence.
 */
export function logNavigationEvent(
  jumpId: string,
  eventName: string,
  details: Record<string, unknown> = {},
  storage?: Storage
): void {
  getActivePlatform().diagnostics.logEvent(jumpId, eventName, details, storage);
}

/**
 * Returns true when verbose jump debugging is enabled in `localStorage`.
 *
 * @returns Whether the active platform's debug storage flag is set to `'1'`.
 */
export function isNavigationDebugEnabled(): boolean {
  try {
    const key = getActivePlatform().diagnostics.debugStorageKey ?? 'chatTocDebugJump';
    return (
      typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1'
    );
  } catch {
    return false;
  }
}

/**
 * Emits a structured `[LUNA JUMP FAILED]` debug log when navigation debugging is enabled.
 * Performs no platform container queries or DOM reads when debugging is disabled.
 *
 * @param details Failure metadata and optional scroll container reference.
 */
export function logJumpFailedDiagnostic(details: {
  targetIndex: number;
  targetMessageId: string;
  reason: string;
  strategy: string;
  recoveryAttempts: number;
  container?: HTMLElement | null;
}): void {
  if (!isNavigationDebugEnabled()) return;
  const activeContainer =
    details.container ?? getActivePlatform().navigation.getScrollContainer();
  const scrollPosition = activeContainer
    ? {
        scrollTop: activeContainer.scrollTop,
        scrollHeight: activeContainer.scrollHeight,
        clientHeight: activeContainer.clientHeight,
        maxScrollTop: Math.max(
          0,
          activeContainer.scrollHeight - activeContainer.clientHeight
        ),
      }
    : null;

  const payload = {
    targetIndex: details.targetIndex,
    targetMessageId: details.targetMessageId,
    reason: details.reason,
    scrollPosition,
    strategy: details.strategy,
    recoveryAttempts: details.recoveryAttempts,
  };

  // Use console.debug with serialized JSON so handled navigation failures remain
  // readable in DevTools without polluting chrome://extensions error logs.
  console.debug(`[LUNA JUMP FAILED] ${JSON.stringify(payload)}`, payload);
}

/**
 * Lifecycle stage for a debug-only `[LUNA ALIGNMENT]` measurement record.
 */
export type AlignmentMeasurementStage =
  | 'before-align'
  | 'after-align'
  | 'next-frame'
  | 'realign'
  | 'settled'
  | 'failed';

/**
 * Emits a structured `[LUNA ALIGNMENT]` debug log when navigation debugging is enabled.
 * Performs no DOM measurements when debugging is disabled.
 *
 * @param params Alignment stage, target/container references, and active jump metadata.
 */
export function emitAlignmentMeasurement(params: {
  jumpId: string;
  stage: AlignmentMeasurementStage;
  targetMessageId: string;
  targetIndex: number;
  strategy: string;
  element: HTMLElement;
  container: HTMLElement | null;
  expectedViewportTopPx: number;
  clamped: boolean;
  method?: AlignElementResult['method'];
  displacementKind?: string;
}): void {
  if (!isNavigationDebugEnabled()) return;
  const {
    jumpId,
    stage,
    targetMessageId,
    targetIndex,
    strategy,
    element,
    container,
    expectedViewportTopPx,
    clamped,
    method,
    displacementKind,
  } = params;

  const connected = element.isConnected;
  const actualViewportTopPx = connected
    ? Math.round(element.getBoundingClientRect().top * 10) / 10
    : null;
  const alignmentErrorPx =
    actualViewportTopPx !== null
      ? Math.round((actualViewportTopPx - expectedViewportTopPx) * 10) / 10
      : null;
  const distanceFromBottom = container
    ? Math.round(
        (container.scrollHeight - container.scrollTop - container.clientHeight) * 10
      ) / 10
    : null;

  console.info('[LUNA ALIGNMENT]', {
    jumpId,
    stage,
    targetMessageId,
    targetIndex,
    strategy,
    targetTag: element.tagName,
    targetUnitKey: element.getAttribute('data-chatgpt-search-unit-key'),
    targetConnected: connected,
    expectedViewportTopPx: Math.round(expectedViewportTopPx * 10) / 10,
    actualViewportTopPx,
    alignmentErrorPx,
    scrollTop: container ? Math.round(container.scrollTop) : null,
    scrollHeight: container ? Math.round(container.scrollHeight) : null,
    clientHeight: container ? Math.round(container.clientHeight) : null,
    distanceFromBottom,
    clamped,
    ...(method ? { method } : {}),
    ...(displacementKind ? { displacementKind } : {}),
  });
}

/**
 * Adapts ChatGPT's internal React virtualizer layout state for fast prompt navigation.
 * Exposes the synchronous ISOLATED-world facade for querying the MAIN-world bridge.
 */
import {
  CHATGPT_BRIDGE_PROTOCOL,
  createBridgeRequestId,
} from './virtualLayoutBridgeProtocol';
import type { VirtualJumpTargetResult } from '../platformInterface';

/**
 * Queries ChatGPT's MAIN-world virtual layout bridge for the position of an unmounted prompt.
 * Dispatches a synchronous CustomEvent on the active container and waits for the immediate response.
 *
 * @param container The active chat scroll container (.thread-scroll-container).
 * @param messageId The target prompt message ID to resolve.
 * @returns Synchronous VirtualJumpTargetResult.
 *
 * @example
 * const result = queryChatGptVirtualJumpTarget(container, 'prompt-msg-123');
 * if (result.status === 'ok') {
 *   console.log('Target top offset:', result.topOffsetPx);
 * }
 */
export function queryChatGptVirtualJumpTarget(
  container: HTMLElement,
  messageId: string
): VirtualJumpTargetResult {
  if (
    !container ||
    !(container instanceof HTMLElement) ||
    !container.isConnected ||
    typeof messageId !== 'string' ||
    !messageId
  ) {
    return { status: 'unavailable', reason: 'invalid-context' };
  }

  const requestId = createBridgeRequestId();
  let bridgeResult: VirtualJumpTargetResult | null = null;
  let settled = false;

  const removeResponseListener = () => {
    container.removeEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      onResponse
    );
  };

  const settle = (result: VirtualJumpTargetResult) => {
    if (settled) return;
    settled = true;
    bridgeResult = result;
    removeResponseListener();
  };

  function onResponse(event: Event): void {
    if (settled) return;

    // Step 1: detail type guard
    const customEvent = event as CustomEvent;
    if (typeof customEvent.detail !== 'string') {
      return;
    }

    // Step 2: JSON parse guard (do not settle on unparsable JSON)
    let parsed: unknown;
    try {
      parsed = JSON.parse(customEvent.detail);
    } catch {
      return;
    }

    // Step 3: runtime structural object check
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return;
    }

    const data = parsed as Record<string, unknown>;

    // Step 4: request correlation guard (do not settle on mismatched requestId)
    if (typeof data.requestId !== 'string' || data.requestId !== requestId) {
      return;
    }

    // Step 5: correlation established; validate schema and settle exactly once
    if (data.status === 'ok') {
      const targetIndex = data.targetIndex;
      const turnCount = data.turnCount;
      const topOffsetPx = data.topOffsetPx;

      if (
        typeof targetIndex === 'number' &&
        Number.isInteger(targetIndex) &&
        targetIndex >= 0 &&
        typeof turnCount === 'number' &&
        Number.isInteger(turnCount) &&
        turnCount > 0 &&
        targetIndex < turnCount &&
        typeof topOffsetPx === 'number' &&
        Number.isFinite(topOffsetPx) &&
        topOffsetPx >= 0
      ) {
        settle({
          status: 'ok',
          targetIndex,
          topOffsetPx,
          turnCount,
        });
      } else {
        settle({
          status: 'unavailable',
          reason: 'invalid-payload',
        });
      }
    } else if (data.status === 'target-not-in-layout') {
      const turnCount = data.turnCount;
      if (
        typeof turnCount === 'number' &&
        Number.isInteger(turnCount) &&
        turnCount > 0
      ) {
        settle({
          status: 'target-not-in-layout',
          turnCount,
        });
      } else {
        settle({
          status: 'unavailable',
          reason: 'invalid-payload',
        });
      }
    } else if (data.status === 'unavailable') {
      settle({
        status: 'unavailable',
        reason:
          typeof data.reason === 'string'
            ? data.reason
            : 'host-unavailable',
      });
    } else {
      settle({
        status: 'unavailable',
        reason: 'invalid-payload',
      });
    }
  }

  try {
    container.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      onResponse
    );
    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: JSON.stringify({ requestId, messageId }),
      })
    );
  } catch {
    return { status: 'unavailable', reason: 'dispatch-failed' };
  } finally {
    removeResponseListener();
  }

  return bridgeResult ?? { status: 'unavailable', reason: 'no-response' };
}

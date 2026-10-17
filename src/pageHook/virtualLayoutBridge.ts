/**
 * MAIN-world bridge listener and React virtual-layout extractor for ChatGPT.
 */
import {
  CHATGPT_BRIDGE_PROTOCOL,
  type VirtualLayoutBridgeRequest,
  type VirtualLayoutBridgeResponse,
} from '@/platforms/chatgpt/virtualLayoutBridgeProtocol';

/**
 * Shape of ChatGPT's active React virtualizer layout state in the page MAIN world.
 * Kept private to the MAIN-world bridge.
 */
interface ChatGptVirtualLayout {
  readonly turnKeys: ReadonlyArray<string>;
  readonly turnIndexByKey: ReadonlyMap<string, number>;
  readonly topOffsetsPx: ReadonlyArray<number>;
  readonly heightsPx: ReadonlyArray<number>;
  readonly totalHeightPx: number;
}

const MAX_ANCESTOR_HOPS = 40;
const MAX_HOOKS_PER_FIBER = 100;

const INTERNAL_FEED_SELECTORS = [
  '[data-chatgpt-search-unit-key$=":user"]',
  '[data-chatgpt-search-unit-key$=":assistant"]',
  '[data-message-author-role="user"]',
  '[data-message-author-role="assistant"]',
] as const;

/**
 * Validates that an unknown candidate conforms strictly to the ChatGptVirtualLayout contract.
 * Preserves all collection integrity, bijection, monotonicity, and height constraints.
 *
 * @param candidate Unknown candidate object to inspect.
 * @returns True if candidate is a valid ChatGptVirtualLayout.
 */
export function isValidVirtualLayout(
  candidate: unknown
): candidate is ChatGptVirtualLayout {
  if (!candidate || typeof candidate !== 'object') return false;
  const layout = candidate as Partial<ChatGptVirtualLayout>;

  // 1. Basic collection shape checks
  if (!Array.isArray(layout.turnKeys) || layout.turnKeys.length === 0) {
    return false;
  }
  if (
    !layout.turnIndexByKey ||
    typeof (layout.turnIndexByKey as Map<unknown, unknown>).get !== 'function' ||
    typeof (layout.turnIndexByKey as Map<unknown, unknown>).size !== 'number'
  ) {
    return false;
  }
  if (!Array.isArray(layout.topOffsetsPx) || !Array.isArray(layout.heightsPx)) {
    return false;
  }
  if (
    typeof layout.totalHeightPx !== 'number' ||
    !Number.isFinite(layout.totalHeightPx) ||
    layout.totalHeightPx < 0
  ) {
    return false;
  }

  const count = layout.turnKeys.length;
  if (
    layout.topOffsetsPx.length !== count ||
    layout.heightsPx.length !== count
  ) {
    return false;
  }
  if (layout.turnIndexByKey.size !== count) {
    return false;
  }

  // 2. Element-wise integrity and monotonic offset check
  let prevTop = -1;
  for (let i = 0; i < count; i++) {
    const key = layout.turnKeys[i];
    if (typeof key !== 'string' || !key) return false;
    if (layout.turnIndexByKey.get(key) !== i) return false;

    const top = layout.topOffsetsPx[i];
    if (
      typeof top !== 'number' ||
      !Number.isFinite(top) ||
      top < 0 ||
      top < prevTop
    ) {
      return false;
    }
    prevTop = top;

    const height = layout.heightsPx[i];
    if (
      typeof height !== 'number' ||
      !Number.isFinite(height) ||
      height < 0
    ) {
      return false;
    }
  }

  // 3. Overall boundary validation
  const lastTop = layout.topOffsetsPx[count - 1];
  if (layout.totalHeightPx < lastTop) {
    return false;
  }

  return true;
}

/**
 * Traverses React Fiber ancestors and hooks to find a valid ChatGptVirtualLayout state in MAIN world.
 *
 * @param anchorElement A DOM element inside the virtualized subtree.
 * @returns Validated ChatGptVirtualLayout, or null if not discovered.
 */
export function findMainWorldVirtualLayout(
  anchorElement: HTMLElement
): ChatGptVirtualLayout | null {
  try {
    const allKeys = Object.keys(anchorElement);
    const reactFiberKey = allKeys.find((key) =>
      key.startsWith('__reactFiber$')
    );
    const reactInternalInstanceKey = allKeys.find((key) =>
      key.startsWith('__reactInternalInstance$')
    );

    const fiberKey = reactFiberKey || reactInternalInstanceKey;
    if (!fiberKey) return null;

    let fiber: any = (anchorElement as any)[fiberKey];
    const visitedFibers = new Set<any>();
    let ancestorHops = 0;

    outerLoop: while (fiber && ancestorHops < MAX_ANCESTOR_HOPS) {
      if (visitedFibers.has(fiber)) break;
      visitedFibers.add(fiber);
      ancestorHops++;

      // Inspect current fiber and its alternate (double buffering)
      const fibersToCheck = fiber.alternate
        ? [fiber, fiber.alternate]
        : [fiber];

      for (const f of fibersToCheck) {
        let hook = f.memoizedState;
        const visitedHooks = new Set<any>();
        let hookHops = 0;

        while (hook && hookHops < MAX_HOOKS_PER_FIBER) {
          if (visitedHooks.has(hook)) break;
          visitedHooks.add(hook);
          hookHops++;

          const state = hook.memoizedState;
          if (state && typeof state === 'object') {
            // Check direct state
            if (isValidVirtualLayout(state)) {
              return state;
            }

            // Check ref.current wrapper (confirmed real-browser pattern)
            if (state.current && typeof state.current === 'object') {
              if (isValidVirtualLayout(state.current)) {
                return state.current;
              }
            }

            // Check tuple/array element if state is a tuple
            if (Array.isArray(state)) {
              for (const elem of state) {
                if (elem && typeof elem === 'object') {
                  if (isValidVirtualLayout(elem)) {
                    return elem;
                  }
                }
              }
            }
          }
          hook = hook.next;
        }
      }

      fiber = fiber.return;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves target prompt index and top offset from a validated layout with defensive bounds checking.
 *
 * @param layout Validated ChatGPT virtual layout.
 * @param messageId Target message ID to resolve.
 * @param requestId Correlation request ID.
 * @returns Sanitized bridge response DTO.
 */
export function resolveVirtualJumpTarget(
  layout: ChatGptVirtualLayout,
  messageId: string,
  requestId: string
): VirtualLayoutBridgeResponse {
  const targetIndex = layout.turnIndexByKey.get(messageId);

  if (
    typeof targetIndex !== 'number' ||
    !Number.isInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= layout.turnKeys.length
  ) {
    return {
      requestId,
      status: 'target-not-in-layout',
      turnCount: layout.turnKeys.length,
    };
  }

  const topOffsetPx = layout.topOffsetsPx[targetIndex];
  if (
    typeof topOffsetPx !== 'number' ||
    !Number.isFinite(topOffsetPx) ||
    topOffsetPx < 0
  ) {
    return {
      requestId,
      status: 'unavailable',
      reason: 'invalid-offset',
    };
  }

  return {
    requestId,
    status: 'ok',
    targetIndex,
    topOffsetPx,
    turnCount: layout.turnKeys.length,
  };
}

/**
 * Handles incoming production virtual-layout query requests in the page MAIN world.
 *
 * @param event The dispatched CustomEvent from ISOLATED world.
 */
export function handleVirtualLayoutRequest(event: Event): void {
  try {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !target.isConnected ||
      !target.classList.contains('thread-scroll-container')
    ) {
      return;
    }

    const customEvent = event as CustomEvent;
    if (typeof customEvent.detail !== 'string') {
      return;
    }

    let request: VirtualLayoutBridgeRequest;
    try {
      request = JSON.parse(customEvent.detail) as VirtualLayoutBridgeRequest;
    } catch {
      return;
    }

    if (
      !request ||
      typeof request.requestId !== 'string' ||
      !request.requestId ||
      typeof request.messageId !== 'string' ||
      !request.messageId
    ) {
      return;
    }

    let anchor: HTMLElement | null = null;
    for (const selector of INTERNAL_FEED_SELECTORS) {
      const el = target.querySelector<HTMLElement>(selector);
      if (el && el.isConnected) {
        anchor = el;
        break;
      }
    }

    let response: VirtualLayoutBridgeResponse;
    if (!anchor) {
      response = {
        requestId: request.requestId,
        status: 'unavailable',
        reason: 'anchor-unavailable',
      };
    } else {
      const layout = findMainWorldVirtualLayout(anchor);
      if (!layout) {
        response = {
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'layout-unavailable',
        };
      } else {
        response = resolveVirtualJumpTarget(
          layout,
          request.messageId,
          request.requestId
        );
      }
    }

    target.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
        bubbles: false,
        detail: JSON.stringify(response),
      })
    );
  } catch {
    // Fail closed: never leak exceptions outward into host page
  }
}

/**
 * Installs the MAIN-world production virtual layout bridge listener on document in the capture phase.
 *
 * @returns Cleanup function to remove the listener.
 */
export function installVirtualLayoutBridge(): () => void {
  const listener = (event: Event) => handleVirtualLayoutRequest(event);
  document.addEventListener(
    CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
    listener,
    { capture: true }
  );
  return () => {
    document.removeEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      listener,
      { capture: true }
    );
  };
}

/**
 * Conditionally installs the virtual layout bridge for supported platforms (ChatGPT only).
 *
 * @param platformId The active platform ID.
 * @returns Cleanup function if installed, or null if unsupported.
 */
export function maybeInstallVirtualLayoutBridge(
  platformId: string
): (() => void) | null {
  if (platformId === 'chatgpt') {
    return installVirtualLayoutBridge();
  }
  return null;
}

